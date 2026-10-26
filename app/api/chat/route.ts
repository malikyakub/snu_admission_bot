import {
  createConversation,
  getOrCreateConversation,
  clearHandoffOffered,
  markNeedsHuman,
  setWaitingForPhone,
} from "@/lib/conversations";
import { clientIpFromHeaders } from "@/lib/request-ip";
import { embedQuery } from "@/lib/embeddings";
import {
  handoffConfirmMessage,
  isAffirmativeHandoff,
  isHandoffDecline,
  isClarificationFollowUp,
  isLowConfidence,
  lastAssistantOfferedHandoff,
} from "@/lib/handoff";
import {
  detectIntent,
  detectIntentWithHistory,
  splitQuestions,
  type ChatIntent,
} from "@/lib/intent";
import { buildMessages, type ChatHistoryMessage } from "@/lib/prompt";
import { facultiesMentionedInText, formatFeeFactsBlock } from "@/lib/fees";
import {
  extractPhoneNumber,
  formatStudentStatus,
  isBarePhoneMessage,
  isGreeting,
  isStartEnrollmentAffirmative,
  isStatusCheckIntent,
  lastAssistantAskedForPhone,
  lastAssistantAskedForVerification,
  lastAssistantOfferedStartEnrollment,
  lastAssistantStatusNotFound,
  phoneFromHistory,
  shouldExitPhoneWait,
  smallTalkReply,
  startEnrollmentStubMessage,
  statusAskForPhoneMessage,
  statusNotFoundMessage,
  statusVerifyAskMessage,
  statusVerifyFailedMessage,
  verifiesStudent,
} from "@/lib/status";
import {
  enrollmentCtaMessage,
  isEnrollInterestWithHistory,
  resolveFacultyFromMessage,
} from "@/lib/enrollment-intent";
import { ctaMarker, hasCta } from "@/lib/cta";
import {
  findStudentByPhone,
  isValidSomaliMobile,
  linkStudentConversation,
  normalizePhoneDigits,
  type StudentStatus,
} from "@/lib/students";
import {
  isEnrollmentIncomplete,
  nextIncompleteEnrollmentStep,
} from "@/lib/enrollment";
import { searchKbChunks, getSupabase, type KbChunkMatch } from "@/lib/supabase";
import {
  encodeSourcesHeader,
  pruneWeakChunks,
  sourcesUsedInAnswer,
  type ChatSource,
} from "@/lib/sources";
import {
  saveMessageAsync,
  saveTurnAsync,
  saveTurnNow,
  saveUserAndAssistantWhenReady,
} from "@/lib/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
/** Used when the primary model hits daily/minute rate limits. */
const GROQ_FALLBACK_MODEL =
  process.env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant";
const TOP_K = 5;

const EMPTY_INTENT = {
  topic: null,
  faculty: null,
  combineFeesAndFaculty: false,
  combineExamAndPlacement: false,
};

type ChatBody = {
  message?: string;
  query?: string;
  history?: ChatHistoryMessage[];
  conversation_id?: string;
  stream?: boolean;
  /** Re-answer an existing student message (e.g. after admin hand-back). */
  skip_user_save?: boolean;
};

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Append text to an SSE stream once the model finishes; `suffixFor` sees the full answer. */
function appendTextToSseStream(
  upstream: ReadableStream<Uint8Array>,
  suffixFor: (text: string) => string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let injected = false;

  function inject(controller: ReadableStreamDefaultController<Uint8Array>) {
    injected = true;
    const suffix = suffixFor(text);
    if (!suffix) return;
    const chunk = {
      id: "snubot-suffix",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: suffix }, finish_reason: null }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
  }

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";

          for (const line of parts) {
            if (line.startsWith("data: ")) {
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") {
                if (!injected) inject(controller);
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                continue;
              }
              try {
                const d = JSON.parse(payload) as {
                  choices?: { delta?: { content?: string } }[];
                };
                text += d.choices?.[0]?.delta?.content ?? "";
              } catch {
                /* not a JSON chunk */
              }
            }
            controller.enqueue(encoder.encode(`${line}\n`));
          }
        }
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(buffer));
        }
        if (!injected) {
          inject(controller);
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

function appendSourcesEventAfterStream(
  upstream: ReadableStream<Uint8Array>,
  sourcesPromise: Promise<ChatSource[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
        try {
          const sources = await sourcesPromise;
          const payload = JSON.stringify({ snubot_sources: sources });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (err) {
          console.warn(
            "[/api/chat] sources event:",
            err instanceof Error ? err.message : err,
          );
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

function mergeChunksBySimilarity(
  groups: KbChunkMatch[][],
  limit: number,
): KbChunkMatch[] {
  const byId = new Map<string, KbChunkMatch>();
  for (const group of groups) {
    for (const chunk of group) {
      const prev = byId.get(chunk.id);
      if (!prev || (chunk.similarity ?? 0) > (prev.similarity ?? 0)) {
        byId.set(chunk.id, chunk);
      }
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, limit);
}

async function groqChatCompletions(opts: {
  messages: ChatHistoryMessage[];
  stream: boolean;
  signal: AbortSignal;
}): Promise<Response> {
  const bodyFor = (model: string) =>
    JSON.stringify({
      model,
      messages: opts.messages,
      temperature: 0.2,
      max_tokens: 1024,
      stream: opts.stream,
    });

  const headers = {
    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  };

  let res = await fetch(GROQ_URL, {
    method: "POST",
    headers,
    body: bodyFor(GROQ_MODEL),
    signal: opts.signal,
  });

  if (res.ok || res.status !== 429 || GROQ_FALLBACK_MODEL === GROQ_MODEL) {
    return res;
  }

  const primaryDetail = await res.text().catch(() => "");
  console.warn(
    `[/api/chat] ${GROQ_MODEL} rate-limited; retrying with ${GROQ_FALLBACK_MODEL}`,
  );

  res = await fetch(GROQ_URL, {
    method: "POST",
    headers,
    body: bodyFor(GROQ_FALLBACK_MODEL),
    signal: opts.signal,
  });

  if (!res.ok && res.status === 429) {
    // Prefer a clean client message over dumping Groq JSON
    return new Response(
      JSON.stringify({
        error:
          "The AI service is temporarily rate-limited. Please wait a minute and try again.",
        code: "rate_limit_exceeded",
        detail: primaryDetail.slice(0, 400),
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  return res;
}

/** Tee an SSE stream: forward bytes to the client while accumulating assistant text. */
function tapSseStream(upstream: ReadableStream<Uint8Array>): {
  stream: ReadableStream<Uint8Array>;
  textPromise: Promise<string>;
} {
  const decoder = new TextDecoder();
  let resolveText!: (t: string) => void;
  const textPromise = new Promise<string>((r) => {
    resolveText = r;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      let assistantText = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? "";
          for (const line of parts) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const d = JSON.parse(payload)?.choices?.[0]?.delta?.content;
              if (typeof d === "string" && d) assistantText += d;
            } catch {
              /* skip malformed */
            }
          }
        }
      } catch (err) {
        controller.error(err);
        resolveText(assistantText);
        return;
      }
      controller.close();
      resolveText(assistantText);
    },
  });

  return { stream, textPromise };
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return jsonError("Invalid JSON body");
  }

  const message = (body.message ?? body.query ?? "").trim();
  if (!message) {
    return jsonError('Missing "message" (or "query") string');
  }

  if (!process.env.GROQ_API_KEY) {
    return jsonError("GROQ_API_KEY is not configured", 500);
  }

  const history = body.history ?? [];
  const skipUserSave = body.skip_user_save === true;
  // Hand-back resume must wait for a full JSON answer (no SSE).
  const wantStream = skipUserSave ? false : body.stream !== false;
  const clientIp = clientIpFromHeaders(req.headers);
  const enrollInterest = isEnrollInterestWithHistory(message, history);

  async function jsonReply(
    conversationId: string | null,
    userMessage: string,
    payload: Record<string, unknown>,
  ) {
    const answer = typeof payload.answer === "string" ? payload.answer : "";
    if (skipUserSave) {
      const saved = await saveTurnNow(conversationId, userMessage, answer, {
        skipUserSave: true,
      });
      return Response.json({ ...payload, message: saved });
    }
    saveTurnAsync(conversationId, userMessage, answer);
    return Response.json(payload);
  }

  try {
    let conversation = null as Awaited<
      ReturnType<typeof getOrCreateConversation>
    > | null;
    let conversationError: string | null = null;

    try {
      conversation = body.conversation_id
        ? await getOrCreateConversation(body.conversation_id, {
            ipAddress: clientIp,
          })
        : null;
    } catch (err) {
      conversationError =
        err instanceof Error ? err.message : "conversations unavailable";
      console.warn("[/api/chat] conversation load:", conversationError);
    }

    // --- Strict handoff: bot stays silent while an admin owns the thread ---
    if (conversation?.needs_human) {
      if (!skipUserSave) {
        saveMessageAsync(conversation.id, "user", message);
      }
      return Response.json({
        answer: "",
        conversation_id: conversation.id,
        needs_human: true,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: EMPTY_INTENT,
        sources: [],
        flow: "human_handoff",
        silent: true,
      });
    }

    // --- Greeting / small-talk shortcut (before RAG) ---
    // Skip when this turn is accepting a pending admin-handoff offer ("yes"/"sure").
    {
      const awaitingHandoffConfirm =
        (conversation?.handoff_offered ?? false) ||
        lastAssistantOfferedHandoff(history);
      const handoffYes =
        awaitingHandoffConfirm && isAffirmativeHandoff(message);
      if (isGreeting(message) && !handoffYes) {
        if (awaitingHandoffConfirm && isHandoffDecline(message)) {
          try {
            if (conversation?.id) {
              await clearHandoffOffered(conversation.id);
              conversation = { ...conversation, handoff_offered: false };
            }
          } catch (err) {
            console.warn(
              "[/api/chat] clear handoff_offered (small-talk):",
              err instanceof Error ? err.message : err,
            );
          }
        }
        return jsonReply(conversation?.id ?? null, message, {
          answer: smallTalkReply(message),
          conversation_id: conversation?.id ?? null,
          needs_human: false,
          handoff_offered: false,
          low_confidence: false,
          top_similarity: null,
          intent: { ...EMPTY_INTENT, topic: "greeting" },
          sources: [],
          flow: "greeting",
        });
      }
    }

    // Enrollment is offered via CTA after a normal answer — never auto-open here.

    // --- Enrollment start after status-not-found offer (yes / CTA follow-up text) ---
    if (
      lastAssistantOfferedStartEnrollment(history) &&
      isStartEnrollmentAffirmative(message)
    ) {
      return jsonReply(conversation?.id ?? null, message, {
        answer: startEnrollmentStubMessage(),
        conversation_id: conversation?.id ?? null,
        needs_human: false,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: { ...EMPTY_INTENT, topic: "enrollment_start" },
        sources: [],
        flow: "enrollment_offer",
        // Client opens only when user clicks the CTA — not automatically
        open_enrollment: false,
      });
    }

    /** Link this chat to the verified student's row and reply with their status. */
    async function revealStatus(student: StudentStatus) {
      try {
        if (conversation) {
          await setWaitingForPhone(conversation.id, false);
          conversation = { ...conversation, waiting_for_phone: false };
        }
      } catch (err) {
        console.warn(
          "[/api/chat] clear waiting_for_phone:",
          err instanceof Error ? err.message : err,
        );
      }

      // Link this chat so the enrollment panel can resume the same row
      if (conversation?.id) {
        try {
          await linkStudentConversation(student.phone, conversation.id);
          const resume =
            nextIncompleteEnrollmentStep(student) ??
            student.enrollment_step ??
            1;
          if (isEnrollmentIncomplete(student) && resume) {
            await getSupabase()
              .from("students")
              .update({ enrollment_step: resume })
              .eq("phone", student.phone);
          }
        } catch (err) {
          console.warn(
            "[/api/chat] link student conversation:",
            err instanceof Error ? err.message : err,
          );
        }
      }

      return jsonReply(conversation?.id ?? null, message, {
        answer: formatStudentStatus(student),
        conversation_id: conversation?.id ?? null,
        needs_human: false,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: { ...EMPTY_INTENT, topic: "status_check" },
        sources: [],
        flow: "status_found",
        resume_enrollment: isEnrollmentIncomplete(student),
        student: {
          phone: student.phone,
          enrollment_status: student.enrollment_status,
          current_step: student.current_step,
          enrollment_step: nextIncompleteEnrollmentStep(student),
        },
      });
    }

    const phoneInMessage = extractPhoneNumber(message);

    // --- Identity check: mother's name or exam roll number before revealing status ---
    const leavingVerification =
      message.includes("?") ||
      (shouldExitPhoneWait(message) && message.length > 60);
    if (lastAssistantAskedForVerification(history) && !leavingVerification) {
      const verifyPhone = phoneFromHistory(history);
      try {
        const student = verifyPhone ? await findStudentByPhone(verifyPhone) : null;
        if (student && verifiesStudent(message, student)) {
          return revealStatus(student);
        }
        // A new phone number falls through to a fresh lookup below
        if (student && !phoneInMessage) {
          const { answer, exhausted } = statusVerifyFailedMessage(history);
          return jsonReply(conversation?.id ?? null, message, {
            answer,
            conversation_id: conversation?.id ?? null,
            needs_human: false,
            handoff_offered: exhausted,
            low_confidence: false,
            top_similarity: null,
            intent: { ...EMPTY_INTENT, topic: "status_check" },
            sources: [],
            flow: exhausted ? "status_verify_locked" : "status_verify_retry",
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lookup failed";
        console.error("[/api/chat] student verify:", msg);
        return jsonError(`Student lookup failed: ${msg}`, 500);
      }
    }

    // --- Phone lookup (status check follow-up / retry after not-found) ---
    // "check my status" right after sending a bare number reuses that number
    const priorPhone =
      !phoneInMessage && isStatusCheckIntent(message)
        ? phoneFromHistory(history.slice(-2))
        : null;
    const awaitingPhone =
      (conversation?.waiting_for_phone ?? false) ||
      lastAssistantAskedForPhone(history) ||
      (lastAssistantStatusNotFound(history) && !!phoneInMessage) ||
      !!priorPhone;

    if (awaitingPhone) {
      const phone = phoneInMessage ?? priorPhone;

      // No phone — allow leaving status-check for enrollment / new questions
      if (!phone) {
        if (shouldExitPhoneWait(message)) {
          try {
            if (conversation) {
              await setWaitingForPhone(conversation.id, false);
              conversation = { ...conversation, waiting_for_phone: false };
            }
          } catch (err) {
            console.warn(
              "[/api/chat] clear waiting_for_phone (topic change):",
              err instanceof Error ? err.message : err,
            );
          }

          // Enrollment intent: switch immediately (don't wait for a second turn)
          if (enrollInterest || isStartEnrollmentAffirmative(message)) {
            return jsonReply(conversation?.id ?? null, message, {
              answer: startEnrollmentStubMessage(),
              conversation_id: conversation?.id ?? null,
              needs_human: false,
              handoff_offered: false,
              low_confidence: false,
              top_similarity: null,
              intent: { ...EMPTY_INTENT, topic: "enrollment_start" },
              sources: [],
              flow: "enrollment_offer",
              open_enrollment: false,
              exited_phone_wait: true,
            });
          }
          // Fall through to RAG / other handlers for KB questions
        } else {
          return jsonReply(conversation?.id ?? null, message, {
            answer:
              "I still need the phone number from your application. You can send it as `61…` or `+252 61…` — spaces are fine.",
            conversation_id: conversation?.id ?? null,
            needs_human: false,
            handoff_offered: false,
            low_confidence: false,
            top_similarity: null,
            intent: { ...EMPTY_INTENT, topic: "status_check" },
            sources: [],
            flow: "waiting_for_phone",
          });
        }
      } else {
        if (!conversation) {
          try {
            conversation = await createConversation({ ipAddress: clientIp });
          } catch (err) {
            conversationError =
              err instanceof Error ? err.message : "create conversation failed";
          }
        }

        try {
          const student = await findStudentByPhone(phone);
          if (student) {
            // Stop waiting only when we found a match
            try {
              if (conversation) {
                await setWaitingForPhone(conversation.id, false);
                conversation = { ...conversation, waiting_for_phone: false };
              }
            } catch (err) {
              console.warn(
                "[/api/chat] clear waiting_for_phone:",
                err instanceof Error ? err.message : err,
              );
            }

            // Don't reveal name/status until the student confirms one detail
            return jsonReply(conversation?.id ?? null, message, {
              answer: statusVerifyAskMessage(),
              conversation_id: conversation?.id ?? null,
              needs_human: false,
              handoff_offered: false,
              low_confidence: false,
              top_similarity: null,
              intent: { ...EMPTY_INTENT, topic: "status_check" },
              sources: [],
              flow: "status_verify",
            });
          }

          // Not found — clear wait so a topic change isn't trapped; phone retry
          // still works via lastAssistantStatusNotFound + extractPhoneNumber.
          try {
            if (conversation) {
              await setWaitingForPhone(conversation.id, false);
              conversation = { ...conversation, waiting_for_phone: false };
            }
          } catch (err) {
            console.warn(
              "[/api/chat] clear waiting_for_phone after not-found:",
              err instanceof Error ? err.message : err,
            );
          }

          return jsonReply(conversation?.id ?? null, message, {
            answer: statusNotFoundMessage(),
            conversation_id: conversation?.id ?? null,
            needs_human: false,
            handoff_offered: false,
            low_confidence: false,
            top_similarity: null,
            intent: { ...EMPTY_INTENT, topic: "status_check" },
            sources: [],
            flow: "status_not_found",
            looked_up: normalizePhoneDigits(phone),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "lookup failed";
          console.error("[/api/chat] student lookup:", msg);
          return jsonError(`Student lookup failed: ${msg}`, 500);
        }
      }
    }

    // --- Start status-check flow: ask for phone ---
    // Other questions in the same message are still answered (RAG), with the
    // phone ask appended after the answer.
    const subQuestions = splitQuestions(message);
    const nonStatusParts = subQuestions.filter((q) => !isStatusCheckIntent(q));
    let statusAskPending = false;
    if (isStatusCheckIntent(message)) {
      statusAskPending = subQuestions.length > 1 && nonStatusParts.length > 0;
      try {
        if (!conversation) {
          conversation = await createConversation({ ipAddress: clientIp });
        }
        await setWaitingForPhone(conversation.id, true);
        conversation = { ...conversation, waiting_for_phone: true };
        conversationError = null;
      } catch (err) {
        conversationError =
          err instanceof Error
            ? err.message
            : "failed to set waiting_for_phone";
        console.warn("[/api/chat] waiting_for_phone:", conversationError);
        if (!conversation) {
          try {
            conversation = await createConversation({ ipAddress: clientIp });
          } catch {
            /* history fallback still works for the next turn */
          }
        }
      }

      if (!statusAskPending) return jsonReply(conversation?.id ?? null, message, {
        answer: statusAskForPhoneMessage(),
        conversation_id: conversation?.id ?? null,
        needs_human: false,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: { ...EMPTY_INTENT, topic: "status_check" },
        sources: [],
        flow: "ask_phone",
        ...(conversationError
          ? {
              warning:
                "Could not persist waiting_for_phone. Run supabase/schema.sql.",
              conversation_error: conversationError,
            }
          : {}),
      });
    }

    // --- Human handoff confirm / decline ---
    const awaitingHandoffConfirm =
      (conversation?.handoff_offered ?? false) ||
      lastAssistantOfferedHandoff(history);

    if (awaitingHandoffConfirm && isHandoffDecline(message)) {
      try {
        if (conversation?.id) {
          await clearHandoffOffered(conversation.id);
          conversation = { ...conversation, handoff_offered: false };
        }
      } catch (err) {
        console.warn(
          "[/api/chat] clear handoff_offered:",
          err instanceof Error ? err.message : err,
        );
      }
      // Pure ack/decline ("no need", "nevermind") — don't fall into RAG handoff loop
      if (isGreeting(message)) {
        return jsonReply(conversation?.id ?? null, message, {
          answer: smallTalkReply(message),
          conversation_id: conversation?.id ?? null,
          needs_human: false,
          handoff_offered: false,
          low_confidence: false,
          top_similarity: null,
          intent: { ...EMPTY_INTENT, topic: "greeting" },
          sources: [],
          flow: "greeting",
        });
      }
      // Fall through — student moved on with a real follow-up question.
    } else if (enrollInterest) {
      // "I want in" — the model answers (e.g. checks their faculty choices)
      // and adds the enroll button; see enrollNote in buildMessages.
      try {
        if (conversation?.handoff_offered) {
          await clearHandoffOffered(conversation.id);
          conversation = { ...conversation, handoff_offered: false };
        }
      } catch {
        /* non-fatal */
      }
    } else if (awaitingHandoffConfirm && isAffirmativeHandoff(message)) {
      let persisted = false;
      try {
        if (!conversation) {
          conversation = await createConversation({ ipAddress: clientIp });
        }
        await markNeedsHuman(conversation.id);
        conversation = {
          ...conversation,
          needs_human: true,
          handoff_offered: false,
        };
        persisted = true;
        conversationError = null;
      } catch (err) {
        conversationError =
          err instanceof Error ? err.message : "failed to set needs_human";
        console.warn("[/api/chat] needs_human:", conversationError);
      }

      return jsonReply(conversation?.id ?? null, message, {
        answer: handoffConfirmMessage(),
        conversation_id: conversation?.id ?? null,
        needs_human: persisted,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: EMPTY_INTENT,
        sources: [],
        ...(conversationError
          ? {
              warning:
                "Could not persist needs_human. Run supabase/schema.sql in Supabase, then retry.",
              conversation_error: conversationError,
            }
          : {}),
      });
    }

    // --- RAG path ---
    const intent = detectIntentWithHistory(message, history);

    /** Embed + search the KB for one question; returns pruned chunks, best first. */
    async function retrieveFor(
      text: string,
      intent: ChatIntent,
    ): Promise<KbChunkMatch[]> {
      const embedMessage =
        intent.topic === "foundation_year"
          ? `${text} Foundation Programme EAP mandatory foundation year`
          : intent.faculty && !detectIntent(text).faculty
            ? `${text} ${intent.faculty} fees tuition`
            : text;
      const embedding = await embedQuery(embedMessage);

      let chunks: KbChunkMatch[] = [];

      if (intent.combineFeesAndFaculty && intent.faculty) {
        const [feeChunks, facultyChunks] = await Promise.all([
          searchKbChunks(embedding, { matchCount: TOP_K, topic: "fees" }),
          searchKbChunks(embedding, {
            matchCount: 3,
            faculty: intent.faculty,
          }),
        ]);
        chunks = mergeChunksBySimilarity([feeChunks, facultyChunks], TOP_K + 2);
        if (chunks.length === 0) {
          chunks = await searchKbChunks(embedding, { matchCount: TOP_K });
        }
      } else if (intent.combineExamAndPlacement) {
        const [placementChunks, examChunks] = await Promise.all([
          searchKbChunks(embedding, {
            matchCount: TOP_K,
            topic: "placement_results",
          }),
          searchKbChunks(embedding, {
            matchCount: 2,
            topic: "admission_exam",
          }),
        ]);
        chunks = mergeChunksBySimilarity(
          [placementChunks, examChunks],
          TOP_K + 2,
        );
        if (chunks.length === 0) {
          chunks = await searchKbChunks(embedding, { matchCount: TOP_K });
        }
      } else if (intent.topic === "foundation_year") {
        // Foundation/EAP facts live in fees + tiers chunks — don't fall through to
        // unrelated faculty program pages via broad semantic search.
        const [feeChunks, tierChunks] = await Promise.all([
          searchKbChunks(embedding, { matchCount: TOP_K, topic: "fees" }),
          searchKbChunks(embedding, {
            matchCount: 3,
            topic: "faculty_tiers",
          }),
        ]);
        chunks = mergeChunksBySimilarity([feeChunks, tierChunks], TOP_K);
        if (chunks.length === 0) {
          chunks = await searchKbChunks(embedding, { matchCount: TOP_K });
        }
      } else {
        const attempts: { topic?: string | null; faculty?: string | null }[] = [];
        if (intent.topic && intent.faculty) {
          attempts.push({ topic: intent.topic, faculty: intent.faculty });
        }
        if (intent.faculty) attempts.push({ faculty: intent.faculty });
        if (intent.topic) attempts.push({ topic: intent.topic });
        attempts.push({});

        let best: KbChunkMatch[] = [];
        let bestSim = -1;
        for (const filters of attempts) {
          const found = await searchKbChunks(embedding, {
            matchCount: TOP_K,
            topic: filters.topic ?? null,
            faculty: filters.faculty ?? null,
          });
          if (found.length === 0) continue;
          const top = found[0]?.similarity ?? 0;
          if (top > bestSim) {
            best = found;
            bestSim = top;
          }
          // Strong filtered hit — no need to keep searching looser filters
          if (top >= 0.55 && (filters.topic != null || filters.faculty != null)) {
            break;
          }
        }
        chunks = best;
      }

      // Drop weak hitchhikers from broad search. Citations stay stricter
      // (confidence + answer reflection) so low-sim context won't be cited.
      chunks = pruneWeakChunks(chunks, { maxGap: 0.1, minSimilarity: 0.38 });
      return chunks;
    }

    // A bare phone number (no status flow running) needs no KB lookup
    const phoneOnly =
      !statusAskPending && isBarePhoneMessage(message)
        ? { valid: isValidSomaliMobile(message) }
        : null;

    // Stacked questions: retrieve for each part separately, then merge so
    // every part has its own context. Status-check parts are handled above.
    const retrievalParts = statusAskPending ? nonStatusParts : subQuestions;
    let chunks: KbChunkMatch[] = [];
    let partTops: (number | null)[] = [];
    if (phoneOnly) {
      // no retrieval
    } else if (retrievalParts.length > 1) {
      const perPart = await Promise.all(
        retrievalParts.map((part) => {
          const partIntent = detectIntentWithHistory(part, history);
          // "how long is the program?" inherits the faculty named elsewhere
          return retrieveFor(
            part,
            partIntent.faculty || !intent.faculty
              ? partIntent
              : { ...partIntent, faculty: intent.faculty },
          );
        }),
      );
      chunks = mergeChunksBySimilarity(
        perPart.map((found) => found.slice(0, 4)),
        10,
      );
      partTops = perPart.map((found) => found[0]?.similarity ?? null);
    } else {
      chunks = await retrieveFor(
        statusAskPending ? retrievalParts[0] : message,
        intent,
      );
      partTops = [chunks[0]?.similarity ?? null];
    }

    const topSimilarity =
      chunks.length > 0 && typeof chunks[0].similarity === "number"
        ? chunks[0].similarity
        : null;
    const clarificationFollowUp = isClarificationFollowUp(message, history);
    // Low when any part of the message found nothing solid
    const retrievalLow =
      !phoneOnly && partTops.some((top) => isLowConfidence(top, top == null ? 0 : 1));
    // Clarifications of a prior answer should be addressed, not refused/handed off.
    // Evaluated fresh every turn from THIS message's retrieval — never sticky.
    const lowConfidence = retrievalLow && !clarificationFollowUp;

    let feeFactsBlock: string | null = null;
    if (intent.fullProgramCost || intent.annualFee || intent.topic === "fees") {
      const mentioned = facultiesMentionedInText(message);
      const faculties =
        mentioned.length > 0
          ? mentioned
          : intent.faculty
            ? [intent.faculty]
            : null;
      const comparison =
        /\b(cheaper|cheap|cheapest|expensive|more expensive|affordable|vs\.?|versus|compared?)\b/i.test(
          message,
        );
      // Comparisons / open fee questions get the full rate table; otherwise focus.
      feeFactsBlock = formatFeeFactsBlock(
        comparison || !faculties || faculties.length === 0 ? null : faculties,
        { annualFee: intent.annualFee },
      );
    }

    // Status part is answered by the phone ask appended after the reply, so
    // the model only sees the other question(s)
    const modelMessage = statusAskPending ? nonStatusParts.join(" ") : message;
    const messages = buildMessages(modelMessage, chunks, history, {
      lowConfidence: retrievalLow,
      annualFee: intent.annualFee,
      contextFaculty: intent.faculty,
      clarificationFollowUp,
      feeFactsBlock,
      enrollInterest,
      subQuestions: retrievalParts,
      phoneNumber: phoneOnly,
      statusCheckFollows: statusAskPending,
    });

    const groqSignal = AbortSignal.timeout(18_000); // 18 s — below Vercel's 30 s limit
    const groqRes = await groqChatCompletions({
      messages,
      stream: wantStream,
      signal: groqSignal,
    });

    if (!groqRes.ok) {
      if (groqRes.status === 429) {
        const payload = (await groqRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        return jsonError(
          payload?.error ||
            "The AI service is temporarily rate-limited. Please wait a minute and try again.",
          429,
        );
      }
      const detail = await groqRes.text();
      return jsonError(`Groq error (${groqRes.status}): ${detail}`, 502);
    }

    // The model adds the admin button itself when it applies; a pending offer
    // is then detected from history (lastAssistantOfferedHandoff).
    const handoffOfferedThisTurn = false;
    if (conversation?.handoff_offered) {
      // Clear any stale offer so it cannot stick
      try {
        await clearHandoffOffered(conversation.id);
        conversation = { ...conversation, handoff_offered: false };
      } catch (err) {
        console.warn(
          "[/api/chat] clear handoff_offered:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    const conversationId = conversation?.id ?? null;

    /**
     * Text appended after the model's answer. The model adds its own button
     * markers when they apply (see prompt); the enroll button is a fallback for
     * an explicit "I want to apply", and is never duplicated.
     */
    function suffixFor(text: string): string {
      let suffix = "";
      if (statusAskPending) suffix += `\n\n${statusAskForPhoneMessage()}`;
      if (enrollInterest && !hasCta(text, "enroll")) {
        // Name a faculty on the button only when the student named exactly one
        const single = facultiesMentionedInText(message).length <= 1;
        suffix += enrollmentCtaMessage(
          single ? resolveFacultyFromMessage(message, intent.faculty) : null,
        );
      }
      return suffix;
    }

    if (wantStream && groqRes.body) {
      const withSuffix = appendTextToSseStream(groqRes.body, suffixFor);

      const { stream: streamOut, textPromise } = tapSseStream(withSuffix);
      const cleanedPromise = textPromise.then((text) => text.trim());
      const sourcesPromise = cleanedPromise.then((text) =>
        sourcesUsedInAnswer(chunks, text),
      );
      // User then assistant, sequentially after the response (avoids ordering races)
      saveUserAndAssistantWhenReady(conversationId, message, cleanedPromise);

      const streamWithSources = appendSourcesEventAfterStream(
        streamOut,
        sourcesPromise,
      );

      return new Response(streamWithSources, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-SNUBot-Intent-Topic": intent.topic ?? "",
          "X-SNUBot-Intent-Faculty": intent.faculty ?? "",
          "X-SNUBot-Chunks": String(chunks.length),
          "X-SNUBot-Low-Confidence": lowConfidence ? "1" : "0",
          "X-SNUBot-Handoff-Offered": handoffOfferedThisTurn ? "1" : "0",
          // Prefer trailing snubot_sources SSE event (answer-grounded). Header may be empty.
          "X-SNUBot-Sources": encodeSourcesHeader([]),
          ...(conversationId
            ? { "X-SNUBot-Conversation-Id": conversationId }
            : {}),
        },
      });
    }

    const completion = (await groqRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = (completion.choices?.[0]?.message?.content ?? "").trim();
    const answer = `${raw}${suffixFor(raw)}`.trim();

    const sourceList = sourcesUsedInAnswer(chunks, answer);

    if (skipUserSave) {
      const saved = await saveTurnNow(conversationId, message, answer, {
        skipUserSave: true,
      });
      return Response.json({
        answer,
        conversation_id: conversationId,
        needs_human: conversation?.needs_human ?? false,
        handoff_offered: handoffOfferedThisTurn,
        low_confidence: lowConfidence,
        top_similarity: topSimilarity,
        intent,
        sources: sourceList,
        message: saved,
        chunks: chunks.map((c) => ({
          id: c.id,
          topic: c.topic,
          faculty: c.faculty,
          confidence: c.confidence,
          source_url: c.source_url,
          similarity: c.similarity,
        })),
        ...(conversationError
          ? {
              warning:
                "Could not persist conversation handoff state. Run supabase/schema.sql in Supabase.",
              conversation_error: conversationError,
            }
          : {}),
      });
    }

    saveTurnAsync(conversationId, message, answer);

    return Response.json({
      answer,
      conversation_id: conversationId,
      needs_human: conversation?.needs_human ?? false,
      handoff_offered: handoffOfferedThisTurn,
      low_confidence: lowConfidence,
      top_similarity: topSimilarity,
      intent,
      sources: sourceList,
      chunks: chunks.map((c) => ({
        id: c.id,
        topic: c.topic,
        faculty: c.faculty,
        confidence: c.confidence,
        source_url: c.source_url,
        similarity: c.similarity,
      })),
      ...(conversationError
        ? {
            warning:
              "Could not persist conversation handoff state. Run supabase/schema.sql in Supabase.",
            conversation_error: conversationError,
          }
        : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/chat]", msg);
    return jsonError(msg, 500);
  }
}
