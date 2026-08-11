/** Low-confidence retrieval → offer human admin handoff. */

export const HANDOFF_SIMILARITY_THRESHOLD = Number(
  process.env.HANDOFF_SIMILARITY_THRESHOLD || 0.55
);

export const HANDOFF_OFFER =
  "I don't have that information. Would you like me to connect you with an admin?";

const HANDOFF_OFFER_SHORT =
  "Would you like me to connect you with an admin?";

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
      return /connect you with an admin/i.test(m.content);
    }
  }
  return false;
}

/**
 * Append the handoff offer without duplicating phrases the model already used.
 */
export function appendHandoffOffer(answer: string): string {
  const trimmed = (answer || "").trim();
  if (/connect you with an admin/i.test(trimmed)) {
    return trimmed;
  }
  if (/don'?t have (that|this|the) information/i.test(trimmed)) {
    return `${trimmed}\n\n${HANDOFF_OFFER_SHORT}`;
  }
  if (!trimmed) return HANDOFF_OFFER;
  return `${trimmed}\n\n${HANDOFF_OFFER}`;
}

export function handoffConfirmMessage(): string {
  return HANDOFF_CONFIRM;
}
