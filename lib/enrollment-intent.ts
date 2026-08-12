import { detectIntent, extractFacultyFromHistory } from "./intent";
import { appendEnrollCta, ctaMarker, hasCta } from "./cta";

/**
 * Strong “do it for me now” phrases — used only to append an enroll CTA,
 * never to auto-open the form.
 */
const ENROLL_PATTERNS: RegExp[] = [
  /\b(enroll|enrol|enrollment)\b/i,
  /\b(sign\s*me\s*up|sign\s*up|register\s*me)\b/i,
  /\b(i\s+want\s+to\s+(enroll|apply|register|sign\s*up|join))\b/i,
  /\b(can\s+you|could\s+you|please)\s+(enroll|register|sign\s*me\s*up|sign\s*up)\b/i,
  /\b(enroll|register)\s+me\b/i,
  /\b(enroll|apply|register)\s+(me\s+)?(for|to|in)\b/i,
  /\bhelp\s+me\s+(apply|enroll|register|sign\s*up)\b/i,
  /\b(i('?m|\s+am)\s+ready\s+to\s+(apply|enroll|register))\b/i,
  /\bstart\s+(my\s+)?(application|enrollment|applying)\b/i,
  /\bapply\s+(now|for\s+admission)\b/i,
  /\badmit\s+me\b/i,
  /\b(take|put)\s+me\s+(in|into)\b/i,
  /\bhow\s+(do|can|to)\s+i\s+apply\b/i,
  /\bapplication\s+process\b/i,
  /\bwant\s+to\s+(apply|join|enroll)\b/i,
  /\bget\s+me\s+(enrolled|registered|admitted)\b/i,
  // Casual “I’m in” / missing-link follow-ups
  /\bi\s+want\s+in\b/i,
  /\bi'?m\s+in\b/i,
  /\bcount\s+me\s+in\b/i,
  /\blet'?s\s+(do\s+it|apply|enroll|go)\b/i,
  /\bi\s+want\s+(that|this|it)\b/i,
  /\bi\s+don'?t\s+see\s+(the\s+)?(link|button)\b/i,
  /\bwhere\s+(is|are)\s+(the\s+)?(link|button|cta)\b/i,
  /\b(no|missing)\s+(link|button)\b/i,
];

/** Short affirmatives that mean “yes, enroll me” when faculty context exists. */
const ENROLL_AFFIRM_SHORT =
  /^(yeah|yep|yup|yes|sure|ok|okay|alright|please|go ahead|do it|let'?s go|i'?m in|i want in|count me in|that'?s great[.!]?\s*(i want in|i'?m in)?|perfect[.!]?\s*(i want in)?)[.!]*$/i;

/** True when the user is asking about applying / enrolling — offer a CTA. */
export function isEnrollInterest(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  return ENROLL_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(t);
  });
}

/**
 * Like isEnrollInterest, but also catches short “I want in” replies when the
 * conversation already has a faculty / application context.
 */
export function isEnrollInterestWithHistory(
  message: string,
  history: { role: string; content: string }[] = []
): boolean {
  if (isEnrollInterest(message)) return true;

  const t = message.trim();
  if (!t || t.length > 80) return false;
  if (!ENROLL_AFFIRM_SHORT.test(t) && !/\bi\s+want\s+in\b/i.test(t)) {
    return false;
  }

  const faculty = extractFacultyFromHistory(history);
  if (faculty) return true;

  // Recent assistant mentioned applying / Medicine etc.
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== "assistant") continue;
    if (
      /application|enroll|apply|faculty|programme|program|medicine|science|engineering/i.test(
        m.content
      )
    ) {
      return true;
    }
    break;
  }
  return false;
}

/** @deprecated alias — interest only, does not open the panel */
export function isEnrollIntent(message: string): boolean {
  return isEnrollInterest(message);
}

const FOLLOW_UP =
  /\b(it|this|that|the program|the course|there|they|same|how long|how much|what about|tell me more|requirements?|fees?|tuition|duration|campus)\b/i;

export function resolveFacultyFromMessage(
  message: string,
  priorFaculty: string | null
): string | null {
  const intent = detectIntent(message);
  if (intent.faculty) return intent.faculty;
  if (priorFaculty && FOLLOW_UP.test(message)) return priorFaculty;
  return null;
}

export function getFacultyStreakAtEnd(
  userMessages: string[]
): { faculty: string; count: number } | null {
  let faculty: string | null = null;
  let count = 0;

  for (const msg of userMessages) {
    const resolved = resolveFacultyFromMessage(msg, faculty);
    if (resolved) {
      if (faculty === resolved) count += 1;
      else {
        faculty = resolved;
        count = 1;
      }
    } else {
      faculty = null;
      count = 0;
    }
  }

  return faculty ? { faculty, count } : null;
}

export function shouldOfferEnrollmentCta(
  userMessages: string[],
  alreadyOffered: boolean
): { faculty: string } | null {
  if (alreadyOffered) return null;
  const streak = getFacultyStreakAtEnd(userMessages);
  if (streak && streak.count >= 3) return { faculty: streak.faculty };
  return null;
}

/** Shown after the student clicks the enroll CTA. */
export function enrollmentWelcomeMessage(): string {
  return (
    "Great — I'll help you start your SNU application.\n\n" +
    "Please answer the following questions carefully and with **accurate information** " +
    "(your full name, phone, school details, faculty choices, and documents). " +
    "This info is used for your official enrollment, so double-check before submitting."
  );
}

/** Bot confirmation after the student finishes the in-chat application. */
export function enrollmentReceivedConfirmationMessage(opts?: {
  fullName?: string | null;
  phone?: string | null;
}): string {
  const name = (opts?.fullName || "").trim();
  const phone = (opts?.phone || "").trim();
  const greet = name ? `Thanks, **${name}**` : "Thanks";
  const phoneHint = phone
    ? ` Use the phone number **${phone}** (the one on your application) when you check.`
    : " Use the same phone number you entered on your application when you check.";

  return (
    `${greet} — we've received your SNU enrollment application.\n\n` +
    `**Status:** Under review\n` +
    `An admin will verify your documents and details. You'll be contacted if anything else is needed.\n\n` +
    `**How to track your application**\n` +
    `Anytime in this chat, ask to check your enrollment status (for example: “check my enrollment status”).` +
    phoneHint
  );
}

export function enrollmentCtaMessage(faculty?: string | null): string {
  const label = faculty
    ? `Start application for ${faculty}`
    : "Start your application";
  return `\n\n${ctaMarker("enroll", label)}`;
}

/** Append enroll offer to a normal answer (no auto-open). */
export function withEnrollmentOffer(
  answer: string,
  faculty?: string | null
): string {
  if (hasCta(answer, "enroll")) return answer.trim();
  return appendEnrollCta(
    answer,
    faculty ? `Start application for ${faculty}` : undefined
  );
}

export function lastAssistantOfferedEnrollment(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return hasCta(history[i].content, "enroll") || /Ready to enroll/i.test(history[i].content);
    }
    if (history[i].role === "user") break;
  }
  return false;
}
