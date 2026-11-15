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

/** Immediate connect reply when the student explicitly asks for a human. */
export const HANDOFF_CONNECTING_NOW = "Sure, connecting you now.";

const OFF_TOPIC_STEER =
  "I can only help with SNU admissions — faculties, requirements, fees, the entrance exam, or checking an application. If you'd like, I can connect you with a human admin.";

export function isLowConfidence(
  topSimilarity: number | null | undefined,
  chunkCount: number
): boolean {
  if (chunkCount === 0 || topSimilarity == null) return true;
  return topSimilarity < HANDOFF_SIMILARITY_THRESHOLD;
}

/**
 * Student explicitly asks for a human / real person / admin
 * (immediate connect — not a soft offer).
 */
export function isExplicitHumanRequest(message: string): boolean {
  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!t) return false;

  return (
    /\b(talk|speak|connect|chat)\b.{0,40}\b(real\s+)?(person|human|admin|operator|agent)\b/i.test(
      t,
    ) ||
    /\b(real\s+person|human\s+admin|live\s+(agent|person|human)|customer\s+service)\b/i.test(
      t,
    ) ||
    /\b(get\s+me\s+(an?\s+)?(admin|human|person)|transfer\s+me|hand\s*me\s*off)\b/i.test(
      t,
    )
  );
}

/** Admissions / SNU-related question (vs fully off-topic). */
export function isAdmissionsOnTopic(
  message: string,
  intent: { topic?: string | null; faculty?: string | null },
): boolean {
  if (intent.topic || intent.faculty) return true;
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  return /\b(snu|somali national|admission|facult|enrol|enroll|exam|tuition|fee|campus|appl(y|ication)|student|programme|program|foundation|eap|tier|scholarship|imtixaan)\b/i.test(
    t,
  );
}

/**
 * Clearly unrelated to SNU admissions (English consumer / general chit-chat).
 * Used to short-circuit before RAG; ambiguous or non-English messages are not
 * treated as off-topic here so they can still hit retrieval.
 *
 * Clear off-topic patterns win even if a weak keyword (e.g. bare "phone")
 * also matched an admissions intent topic.
 */
export function isClearlyOffTopic(
  message: string,
  intent: { topic?: string | null; faculty?: string | null },
): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return false;

  const clearlyUnrelated =
    /\b(bitcoin|cryptocurrency|world cup|best phone|iphone|samsung|android(?:\s+phone)?|netflix|weather|joke|recipe)\b/i.test(
      t,
    ) ||
    /\b(buy|purchase)\b.{0,30}\b(phone|laptop|car|stock)\b/i.test(t) ||
    /\bphone\b.{0,24}\b(buy|purchase)\b/i.test(t) ||
    /\bwho won\b/i.test(t) ||
    /\b(best|cheapest)\b.{0,20}\b(phone|laptop|car)\b.{0,20}\b(buy|right now|today)\b/i.test(
      t,
    );

  if (clearlyUnrelated) return true;
  if (isAdmissionsOnTopic(message, intent)) return false;

  // General-knowledge questions (e.g. "What is the capital of France?")
  return (
    /\b(capital(\s+city)?|president|prime minister|population|currency|flag)\s+of\b/i.test(
      t,
    ) || /^\s*what(?:'s| is)\s+\d+\s*[-+*x×÷/]\s*\d+/i.test(t)
  );
}

export function offTopicSteerMessage(): string {
  return OFF_TOPIC_STEER;
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

/** Short confirm used for explicit "talk to a real person" requests. */
export function handoffConnectingNowMessage(): string {
  return HANDOFF_CONNECTING_NOW;
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
