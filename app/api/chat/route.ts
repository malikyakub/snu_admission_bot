import {
  createConversation,
  getOrCreateConversation,
  markHandoffOffered,
  markNeedsHuman,
  setWaitingForPhone,
} from "@/lib/conversations";
import { clientIpFromHeaders } from "@/lib/request-ip";
import { embedQuery } from "@/lib/embeddings";
import {
  appendHandoffOffer,
  handoffConfirmMessage,
  isAffirmativeHandoff,
  isClarificationFollowUp,
  isLowConfidence,
  lastAssistantOfferedHandoff,
} from "@/lib/handoff";
import { detectIntent, detectIntentWithHistory } from "@/lib/intent";
import { buildMessages, type ChatHistoryMessage } from "@/lib/prompt";
import {
  extractPhoneNumber,
  formatStudentStatus,
  isGreeting,
  isStartEnrollmentAffirmative,
  isStatusCheckIntent,
  lastAssistantAskedForPhone,
  lastAssistantOfferedStartEnrollment,
  lastAssistantStatusNotFound,
  shouldExitPhoneWait,
  startEnrollmentStubMessage,
  statusAskForPhoneMessage,
  statusNotFoundMessage,
} from "@/lib/status";
import {
  enrollmentCtaMessage,
  isEnrollInterest,
  resolveFacultyFromMessage,
  withEnrollmentOffer,
} from "@/lib/enrollment-intent";
import { ctaMarker } from "@/lib/cta";
import {
  findStudentByPhone,
  linkStudentConversation,
  normalizePhoneDigits,
} from "@/lib/students";
import {
  isEnrollmentIncomplete,
  nextIncompleteEnrollmentStep,
} from "@/lib/enrollment";
import { searchKbChunks, getSupabase, type KbChunkMatch } from "@/lib/supabase";
import {
  encodeSourcesHeader,
  sourcesFromChunks,
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
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
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

function appendTextToSseStream(
  upstream: ReadableStream<Uint8Array>,
  suffix: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let injected = false;

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
            if (line.startsWith("data: ") && line.slice(6).trim() === "[DONE]") {
              if (!injected) {
                const chunk = {
                  id: "snubot-handoff",
                  object: "chat.completion.chunk",
                  choices: [
                    {
                      index: 0,
                      delta: { content: suffix },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
                );
                injected = true;
              }
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            controller.enqueue(encoder.encode(`${line}\n`));
          }
        }
        if (buffer.length > 0) {
          controller.enqueue(encoder.encode(buffer));
        }
        if (!injected) {
          const chunk = {
            id: "snubot-handoff",
            object: "chat.completion.chunk",
            choices: [
              { index: 0, delta: { content: suffix }, finish_reason: null },
            ],
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
          );
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

function mergeChunksBySimilarity(
  groups: KbChunkMatch[][],
  limit: number
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

/** Tee an SSE stream: forward bytes to the client while accumulating assistant text. */
function tapSseStream(
  upstream: ReadableStream<Uint8Array>
): { stream: ReadableStream<Uint8Array>; textPromise: Promise<string> } {
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

  async function jsonReply(
    conversationId: string | null,
    userMessage: string,
    payload: Record<string, unknown>
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
    if (isGreeting(message)) {
      return jsonReply(conversation?.id ?? null, message, {
        answer:
          "Hey! I'm here to help with SNU admissions — ask me about faculties, requirements, fees, the entrance exam, or check your enrollment status.",
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

    // --- Phone lookup (status check follow-up / retry after not-found) ---
    const phoneInMessage = extractPhoneNumber(message);
    const awaitingPhone =
      (conversation?.waiting_for_phone ?? false) ||
      lastAssistantAskedForPhone(history) ||
      (lastAssistantStatusNotFound(history) && !!phoneInMessage);

    if (awaitingPhone) {
      const phone = phoneInMessage;

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
              err instanceof Error ? err.message : err
            );
          }

          // Enrollment intent: switch immediately (don't wait for a second turn)
          if (
            isEnrollInterest(message) ||
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
              err instanceof Error ? err.message : err
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
                err instanceof Error ? err.message : err
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
            err instanceof Error ? err.message : err
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

    // --- Start status-check flow: ask for phone (no RAG) ---
    if (isStatusCheckIntent(message)) {
      try {
        if (!conversation) {
          conversation = await createConversation({ ipAddress: clientIp });
        }
        await setWaitingForPhone(conversation.id, true);
        conversation = { ...conversation, waiting_for_phone: true };
        conversationError = null;
      } catch (err) {
        conversationError =
          err instanceof Error ? err.message : "failed to set waiting_for_phone";
        console.warn("[/api/chat] waiting_for_phone:", conversationError);
        if (!conversation) {
          try {
            conversation = await createConversation({ ipAddress: clientIp });
          } catch {
            /* history fallback still works for the next turn */
          }
        }
      }

      return jsonReply(conversation?.id ?? null, message, {
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

    // --- Human handoff confirm ---
    const awaitingHandoffConfirm =
      (conversation?.handoff_offered ?? false) ||
      lastAssistantOfferedHandoff(history);

    if (awaitingHandoffConfirm && isAffirmativeHandoff(message)) {
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
    const embedMessage =
      intent.faculty && !detectIntent(message).faculty
        ? `${message} ${intent.faculty} fees tuition`
        : message;
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
        TOP_K + 2
      );
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

      for (const filters of attempts) {
        chunks = await searchKbChunks(embedding, {
          matchCount: TOP_K,
          topic: filters.topic ?? null,
          faculty: filters.faculty ?? null,
        });
        if (chunks.length > 0) break;
      }
    }

    const topSimilarity =
      chunks.length > 0 && typeof chunks[0].similarity === "number"
        ? chunks[0].similarity
        : null;
    const clarificationFollowUp = isClarificationFollowUp(message, history);
    const retrievalLow = isLowConfidence(topSimilarity, chunks.length);
    // Clarifications of a prior answer should be addressed, not refused/handed off
    const lowConfidence = retrievalLow && !clarificationFollowUp;

    const messages = buildMessages(message, chunks, history, {
      lowConfidence: retrievalLow,
      annualFee: intent.annualFee,
      contextFaculty: intent.faculty,
      clarificationFollowUp,
    });

    const groqSignal = AbortSignal.timeout(18_000); // 18 s — below Vercel's 30 s limit
    const groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 1024,
        stream: wantStream,
      }),
      signal: groqSignal,
    });

    if (!groqRes.ok) {
      const detail = await groqRes.text();
      return jsonError(`Groq error (${groqRes.status}): ${detail}`, 502);
    }

    let handoffOfferedThisTurn = false;
    if (lowConfidence && !isEnrollInterest(message)) {
      try {
        if (!conversation) {
          conversation = await createConversation({ ipAddress: clientIp });
        }
        await markHandoffOffered(conversation.id);
        conversation = { ...conversation, handoff_offered: true };
        handoffOfferedThisTurn = true;
        conversationError = null;
      } catch (err) {
        handoffOfferedThisTurn = true;
        conversationError =
          err instanceof Error ? err.message : "failed to mark handoff_offered";
        console.warn("[/api/chat] handoff_offered:", conversationError);
      }
    }

    const conversationId = conversation?.id ?? null;

    if (wantStream && groqRes.body) {
      let suffix = "";
      if (isEnrollInterest(message)) {
        const fac = resolveFacultyFromMessage(message, intent.faculty);
        suffix = enrollmentCtaMessage(fac);
      } else if (lowConfidence) {
        suffix = `\n\n${ctaMarker("handoff", "Connect with an admin")}`;
      }

      const sourceList = sourcesFromChunks(chunks);
      const withSuffix = suffix
        ? appendTextToSseStream(groqRes.body, suffix)
        : groqRes.body;

      const { stream: streamOut, textPromise } = tapSseStream(withSuffix);
      // User then assistant, sequentially after the response (avoids ordering races)
      saveUserAndAssistantWhenReady(conversationId, message, textPromise);

      return new Response(streamOut, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-SNUBot-Intent-Topic": intent.topic ?? "",
          "X-SNUBot-Intent-Faculty": intent.faculty ?? "",
          "X-SNUBot-Chunks": String(chunks.length),
          "X-SNUBot-Low-Confidence": lowConfidence ? "1" : "0",
          "X-SNUBot-Handoff-Offered": handoffOfferedThisTurn ? "1" : "0",
          "X-SNUBot-Sources": encodeSourcesHeader(sourceList),
          ...(conversationId
            ? { "X-SNUBot-Conversation-Id": conversationId }
            : {}),
        },
      });
    }

    const completion = (await groqRes.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    let answer = completion.choices?.[0]?.message?.content ?? "";
    if (isEnrollInterest(message)) {
      const fac = resolveFacultyFromMessage(message, intent.faculty);
      answer = withEnrollmentOffer(answer, fac);
    } else if (lowConfidence) {
      answer = appendHandoffOffer(answer);
    }

    const sourceList = sourcesFromChunks(chunks);

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
