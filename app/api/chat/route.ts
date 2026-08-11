import {
  createConversation,
  getOrCreateConversation,
  markHandoffOffered,
  markNeedsHuman,
  setWaitingForPhone,
} from "@/lib/conversations";
import { embedQuery } from "@/lib/embeddings";
import {
  appendHandoffOffer,
  handoffConfirmMessage,
  isAffirmativeHandoff,
  isLowConfidence,
  lastAssistantOfferedHandoff,
} from "@/lib/handoff";
import { detectIntent } from "@/lib/intent";
import { buildMessages, type ChatHistoryMessage } from "@/lib/prompt";
import {
  extractPhoneNumber,
  formatStudentStatus,
  isStartEnrollmentAffirmative,
  isStatusCheckIntent,
  lastAssistantAskedForPhone,
  lastAssistantOfferedStartEnrollment,
  startEnrollmentStubMessage,
  statusAskForPhoneMessage,
  statusNotFoundMessage,
} from "@/lib/status";
import { findStudentByPhone } from "@/lib/students";
import { searchKbChunks, type KbChunkMatch } from "@/lib/supabase";

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
  const wantStream = body.stream !== false;

  try {
    let conversation = null as Awaited<
      ReturnType<typeof getOrCreateConversation>
    > | null;
    let conversationError: string | null = null;

    try {
      conversation = body.conversation_id
        ? await getOrCreateConversation(body.conversation_id)
        : null;
    } catch (err) {
      conversationError =
        err instanceof Error ? err.message : "conversations unavailable";
      console.warn("[/api/chat] conversation load:", conversationError);
    }

    // --- Enrollment start stub (after "not found" offer) ---
    if (
      lastAssistantOfferedStartEnrollment(history) &&
      isStartEnrollmentAffirmative(message)
    ) {
      return Response.json({
        answer: startEnrollmentStubMessage(),
        conversation_id: conversation?.id ?? null,
        needs_human: false,
        handoff_offered: false,
        low_confidence: false,
        top_similarity: null,
        intent: { ...EMPTY_INTENT, topic: "enrollment_start" },
        sources: [],
        flow: "enrollment_start_stub",
      });
    }

    // --- Phone lookup (status check follow-up) ---
    const awaitingPhone =
      (conversation?.waiting_for_phone ?? false) ||
      lastAssistantAskedForPhone(history);

    if (awaitingPhone) {
      const phone = extractPhoneNumber(message);
      if (!phone) {
        return Response.json({
          answer:
            "I still need the phone number from your application to look up your status. Please send it as digits (with country code if you have it).",
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

      if (!conversation) {
        try {
          conversation = await createConversation();
        } catch (err) {
          conversationError =
            err instanceof Error ? err.message : "create conversation failed";
        }
      }

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

      try {
        const student = await findStudentByPhone(phone);
        if (student) {
          return Response.json({
            answer: formatStudentStatus(student),
            conversation_id: conversation?.id ?? null,
            needs_human: false,
            handoff_offered: false,
            low_confidence: false,
            top_similarity: null,
            intent: { ...EMPTY_INTENT, topic: "status_check" },
            sources: [],
            flow: "status_found",
            student: {
              phone: student.phone,
              enrollment_status: student.enrollment_status,
              current_step: student.current_step,
            },
          });
        }

        // Not found — offer enrollment start only (no human handoff).
        return Response.json({
          answer: statusNotFoundMessage(),
          conversation_id: conversation?.id ?? null,
          needs_human: false,
          handoff_offered: false,
          low_confidence: false,
          top_similarity: null,
          intent: { ...EMPTY_INTENT, topic: "status_check" },
          sources: [],
          flow: "status_not_found",
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "lookup failed";
        console.error("[/api/chat] student lookup:", msg);
        return jsonError(`Student lookup failed: ${msg}`, 500);
      }
    }

    // --- Start status-check flow: ask for phone (no RAG) ---
    if (isStatusCheckIntent(message)) {
      try {
        if (!conversation) {
          conversation = await createConversation();
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
            conversation = await createConversation();
          } catch {
            /* history fallback still works for the next turn */
          }
        }
      }

      return Response.json({
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
                "Could not persist waiting_for_phone. Run supabase/conversations_waiting_for_phone.sql.",
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
          conversation = await createConversation();
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

      return Response.json({
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
                "Could not persist needs_human. Run supabase/conversations.sql in Supabase, then retry.",
              conversation_error: conversationError,
            }
          : {}),
      });
    }

    // --- RAG path ---
    const embedding = await embedQuery(message);
    const intent = detectIntent(message);

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
    const lowConfidence = isLowConfidence(topSimilarity, chunks.length);

    const messages = buildMessages(message, chunks, history, {
      lowConfidence,
    });

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
    });

    if (!groqRes.ok) {
      const detail = await groqRes.text();
      return jsonError(`Groq error (${groqRes.status}): ${detail}`, 502);
    }

    let handoffOfferedThisTurn = false;
    if (lowConfidence) {
      try {
        if (!conversation) {
          conversation = await createConversation();
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
      const streamOut = lowConfidence
        ? appendTextToSseStream(
            groqRes.body,
            "\n\nWould you like me to connect you with an admin?"
          )
        : groqRes.body;

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
    if (lowConfidence) {
      answer = appendHandoffOffer(answer);
    }

    return Response.json({
      answer,
      conversation_id: conversationId,
      needs_human: conversation?.needs_human ?? false,
      handoff_offered: handoffOfferedThisTurn,
      low_confidence: lowConfidence,
      top_similarity: topSimilarity,
      intent,
      sources: chunks.map((c) => ({
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
              "Could not persist conversation handoff state. Run supabase/conversations.sql in Supabase.",
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
