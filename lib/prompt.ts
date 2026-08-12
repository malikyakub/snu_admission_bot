import type { KbChunkMatch } from "./supabase";

export type ChatHistoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

const SYSTEM_RULES = `You are SNUBot, an admissions assistant for Somali National University (SNU).

Hard rules:
1. Ground every factual claim in the CONTEXT passages below OR in what you already stated earlier in THIS conversation (when clarifying a follow-up). When CONTEXT or the recent assistant turn covers the question fully or partly, answer what you can — do not refuse just because coverage is incomplete or the wording differs. Prefer addressing the matter over "I don't have that information." Only say you do not have that information when CONTEXT is empty/unrelated AND the recent conversation does not already contain the answer. Do NOT invent an answer. Do NOT tell the user to visit snu.edu.so or contact admissions in the answer text; the app shows source links separately.
2. NEVER fabricate exam dates, fees, deadlines, cut-offs, programme lengths, or requirements that are not explicitly present in the CONTEXT (or already stated from CONTEXT in this chat).
3. Answer confidently from every CONTEXT passage. Do not hedge, disclaim, or mention confidence / verification status.
4. Prefer concise, factual answers. Quote numbers and dates exactly as written in CONTEXT.
5. Write a clean standalone answer for the user. NEVER mention retrieval internals: do not say "chunk", "chunk N", "passage N", "context", "similarity", "confidence", "source_url", or that a source was missing. Do NOT paste URLs or write "For more information, check snu.edu.so" — sources are shown by the UI.
6. Do not claim personal knowledge outside CONTEXT and this conversation. If the user challenges or asks why about something you just said, reconcile it using the prior assistant message and CONTEXT — never pretend you did not say it.
7. Follow-ups / clarifications: if the user asks "why", "you just said…", or points at numbers/options from your last answer, explain using those prior statements and CONTEXT. If CONTEXT shows one official programme length, correct any earlier ambiguity instead of refusing.

8. Use Markdown formatting in your answer.
   - Bold key entity names like faculty/department/program names using **...** (for example: **Faculty of Science**).
   - If you are listing 3+ items (faculties, programs, fees, steps, etc.), use a proper Markdown list (numbered or bulleted), with each item on its own line.
   - Avoid comma-separated run-on lists inside a single paragraph; use real line-broken Markdown lists instead.
   - NEVER append additional items as a prose sentence at the end of a list (e.g. "It also has X, Y, and Z"). Every item — without exception — must be its own list entry on its own line.

9. Application / enrollment questions:
   - You CAN help students enroll here in this chat via the in-app application form (the UI adds a "Start your application" link — do not invent buttons yourself).
   - When the user asks to enroll, apply, sign up, register, or says they "want in", confirm briefly and invite them to use that link. Do NOT say you cannot enroll them. Do NOT say the link will appear later or ask them to wait — the app attaches the clickable link to your message automatically.
   - Still answer how-to / requirements questions from CONTEXT (steps, documents, exam).
   - Do NOT invent clickable buttons or "click here" links — the app adds those separately.
   - Leave a blank line before any closing suggestion.

10. Fee calculations — strict rules:
   - When a FEE_FACTS block is present below, treat it as authoritative over older CONTEXT numbers.
   - For full-programme / total cost: calculate step-by-step from FEE_FACTS and SHOW your arithmetic (list each component, then the sum). Do not invent fee items.
   - Components: $30 exam + $50 admin/registration (one-time, all faculties) + $350 EAP + (faculty per-semester rate × (original semesters + 2 Foundation semesters)) + ($10 × floor(totalSemesters/4) ID renewals).
   - The Administrative Charges table values are PER-SEMESTER service fees — NOT a one-time administrative charge. They vary by faculty (Education/Sharia $50, many faculties $80, Health Sciences $100, Engineering/Medicine/Science $125). NEVER assume a flat $125/semester for every faculty.
   - Foundation year is mandatory and adds 2 semesters charged at that faculty's own per-semester rate.
   - For yearly/annual recurring cost only: yearly = 2 × that faculty's per-semester rate (tuition is free). If the faculty is unknown, say the yearly amount depends on the faculty's rate from the table.
   - Never mention $55 for undergraduates. Never use outdated flat-$125-for-everyone or pre-Foundation totals from older passages.
11. NEVER output CTA markers such as [[cta:handoff|...]] or [[cta:enroll|...]] — the app adds those separately when needed. Do not invite the user to "connect with an admin" unless CONTEXT says you lack the information AND you are refusing.`;

export function buildMessages(
  userMessage: string,
  chunks: KbChunkMatch[],
  history: ChatHistoryMessage[] = [],
  options: {
    lowConfidence?: boolean;
    annualFee?: boolean;
    contextFaculty?: string | null;
    clarificationFollowUp?: boolean;
    /** Raw fee-component facts for the model to calculate from. */
    feeFactsBlock?: string | null;
  } = {}
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

  const feeFactsNote = options.feeFactsBlock
    ? `\n\n${options.feeFactsBlock}\nNOTE: Prefer FEE_FACTS over any conflicting older fee passages in CONTEXT. For total-cost questions, show the step-by-step sum.`
    : "";

  const annualNote =
    options.annualFee && !options.feeFactsBlock
      ? `\n\nNOTE: The user asked about yearly/annual cost. Yearly recurring service fee = 2 × the faculty's per-semester rate from the Administrative Charges table (not a flat $250). Tuition is free. One-time admission fees are separate.`
      : "";

  const facultyNote =
    options.contextFaculty && !chunks.some((c) => c.faculty === options.contextFaculty)
      ? `\n\nNOTE: This follow-up question refers to **${options.contextFaculty}** from the recent conversation.`
      : "";

  const clarificationNote = options.clarificationFollowUp
    ? `\n\nNOTE: This is a clarification about your previous answer in this chat. Address it using that prior assistant message and CONTEXT. Do NOT say you do not have that information if you already provided related facts earlier in the conversation. If CONTEXT clarifies an ambiguity (e.g. one official programme length), state the correction clearly.`
    : "";

  const lowConfidenceNote =
    options.lowConfidence && !options.clarificationFollowUp
      ? chunks.length === 0
        ? `\n\nNOTE: No knowledge-base passages matched. Clearly say you do not have that information. Do NOT invent an answer. Do not mention admins, snu.edu.so, or handoff — those are added separately by the app.`
        : `\n\nNOTE: Retrieval confidence is modest, but CONTEXT passages were still retrieved. If any passage relates to the question, answer that part clearly and stay within CONTEXT. Prefer addressing the matter over refusing. Only say you do not have that information if CONTEXT is clearly unrelated. Do NOT invent facts. Do not mention admins, snu.edu.so, or handoff — those are added separately by the app.`
      : "";

  const system: ChatHistoryMessage = {
    role: "system",
    content: `${SYSTEM_RULES}

CONTEXT:
${contextBlock}${feeFactsNote}${annualNote}${facultyNote}${clarificationNote}${lowConfidenceNote}`.trim(),
  };

  // Drop trailing duplicate of the current user message if the client included it
  const filtered = history.filter((m) => m.role === "user" || m.role === "assistant");
  const withoutDup =
    filtered.length > 0 &&
    filtered[filtered.length - 1]?.role === "user" &&
    filtered[filtered.length - 1]?.content === userMessage
      ? filtered.slice(0, -1)
      : filtered;

  const recent = withoutDup.slice(-8).map((m) => ({
    role: m.role,
    // Strip CTA markers so follow-ups read cleanly and the model cannot copy them
    content: m.content.replace(/\[\[cta:[^\]]+\]\]/gi, "").trim(),
  }));

  return [system, ...recent, { role: "user", content: userMessage }];
}
