/** Low-confidence retrieval → offer human admin handoff. */

import { appendHandoffCta, hasCta } from "./cta";

export const HANDOFF_SIMILARITY_THRESHOLD = Number(
  process.env.HANDOFF_SIMILARITY_THRESHOLD || 0.55
);

export const HANDOFF_OFFER =
  "I don't have that information.\n\n[[cta:handoff|Connect with an admin]]";

const HANDOFF_CONFIRM =
  "I've connected you with an admin. Someone from the team will follow up with you shortly.";

export function isLowConfidence(
  topSimilarity: number | null | undefined,
  chunkCount: number
): boolean {
  if (chunkCount === 0 || topSimilarity == null) return true;
  return topSimilarity < HANDOFF_SIMILARITY_THRESHOLD;
}

/** Basic yes / connect-me matching for the turn after a handoff offer. */
export function isAffirmativeHandoff(message: string): boolean {
  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!t) return false;

  if (
    /^(y|yes|yeah|yep|yup|sure|ok|okay|please|alright|all right|of course|go ahead|do it)([.!?\s]|$)/i.test(
      t
    )
  ) {
    return true;
  }

  return (
    /\b(yes\s+please|sure\s+please|connect me|connect us|please connect|talk to (an? )?(admin|human|person|operator|someone)|speak (to|with) (an? )?(admin|human|person|operator)|get me (an? )?(admin|human)|yes[, ]+connect)\b/i.test(
      t
    )
  );
}

export function lastAssistantOfferedHandoff(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === "assistant") {
      return (
        hasCta(m.content, "handoff") ||
        /connect you with an admin|Connect with an admin/i.test(m.content)
      );
    }
  }
  return false;
}

/**
 * Append the handoff offer as a clickable CTA (no duplicate).
 */
export function appendHandoffOffer(answer: string): string {
  return appendHandoffCta(answer, "Connect with an admin");
}

export function handoffConfirmMessage(): string {
  return HANDOFF_CONFIRM;
}
