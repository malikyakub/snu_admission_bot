/** Low-confidence retrieval → offer human admin handoff. */

import { appendHandoffCta, hasCta, stripHandoffCta } from "./cta";

export { stripHandoffCta };

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
  if (isHandoffDecline(t)) return false;

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

/** Student declined the "Connect with an admin" offer. */
export function isHandoffDecline(message: string): boolean {
  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!t) return false;

  if (
    /^(n|no|nope|nah|no thanks|no thank you|not now|never mind|nevermind)([.!?\s]|$)/i.test(
      t
    )
  ) {
    return true;
  }

  return /\b(no need|no thanks|no thank you|not necessary|don'?t (need|want|bother)|do not (need|want)|skip (it|that|the admin)|never mind|nevermind)\b/i.test(
    t
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

/** When an admin hands the thread back and the student did not leave a pending question. */
export function handoffWelcomeBackMessage(): string {
  return "Welcome back — I'm here to help again. What would you like to know about SNU admissions?";
}

/**
 * True when the user is clarifying / challenging a previous assistant answer
 * (e.g. "why…", "you just provided it") rather than starting a new topic.
 */
export function isClarificationFollowUp(
  message: string,
  history: { role: string; content: string }[]
): boolean {
  let hasSubstantivePrior = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    const prior = m.content.replace(/\[\[cta:[^\]]+\]\]/gi, "").trim();
    if (
      prior.length >= 40 &&
      !/^i (do )?not have that information\.?$/i.test(prior)
    ) {
      hasSubstantivePrior = true;
      break;
    }
  }
  if (!hasSubstantivePrior) return false;

  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 220) return false;

  return (
    /^(why|how come|really|are you sure|wait|huh)\b/i.test(t) ||
    /\b(why (would|do|does|is|are)|how come|you just|but you|earlier you|you (said|provided|mentioned|gave|listed)|both (4|6|four|six)|contradict|explain (that|this|it)|that (can'?t|doesn'?t))\b/i.test(
      t
    )
  );
}
