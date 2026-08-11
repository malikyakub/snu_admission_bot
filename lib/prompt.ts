import type { KbChunkMatch } from "./supabase";

export type ChatHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const SYSTEM_RULES = `You are SNUBot, an admissions assistant for Somali National University (SNU).

Hard rules:
1. Answer ONLY using the CONTEXT passages below. If the context does not cover the question, say you do not have that information in the knowledge base and suggest checking snu.edu.so or contacting admissions — do not invent an answer.
2. NEVER fabricate exam dates, fees, deadlines, cut-offs, or requirements that are not explicitly present in the CONTEXT.
3. Answer confidently from every CONTEXT passage. Do not hedge, disclaim, or mention confidence / verification status.
4. Prefer concise, factual answers. Quote numbers and dates exactly as written in CONTEXT.
5. Write a clean standalone answer for the user. NEVER mention retrieval internals: do not say "chunk", "chunk N", "passage N", "context", "similarity", "confidence", "source_url", or that a source was missing. If a real https URL appears in CONTEXT you may optionally cite it; otherwise say nothing about sources.
6. Do not claim personal knowledge outside CONTEXT.`;

export function buildMessages(
  userMessage: string,
  chunks: KbChunkMatch[],
  history: ChatHistoryMessage[] = [],
  options: { lowConfidence?: boolean } = {}
): ChatHistoryMessage[] {
  const contextBlock =
    chunks.length === 0
      ? "(No relevant knowledge-base passages were retrieved.)"
      : chunks
          .map((c) => {
            const meta = [
              c.topic ? `topic=${c.topic}` : null,
              c.faculty ? `faculty=${c.faculty}` : null,
            ]
              .filter(Boolean)
              .join(" | ");
            return meta ? `[${meta}]\n${c.content}` : c.content;
          })
          .join("\n\n---\n\n");

  const lowConfidenceNote = options.lowConfidence
    ? `\n\nNOTE: Retrieved context is weak or empty for this question. Clearly say you do not have that information. Do NOT invent an answer. Do not mention admins or handoff — that offer is added separately.`
    : "";

  const system: ChatHistoryMessage = {
    role: "system",
    content: `${SYSTEM_RULES}

CONTEXT:
${contextBlock}${lowConfidenceNote}`.trim(),
  };

  const recent = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));

  return [system, ...recent, { role: "user", content: userMessage }];
}
