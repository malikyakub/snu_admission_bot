import { detectIntent } from "./intent";

/** Broad enrollment / application intent — runs before RAG or chat API. */
const ENROLL_PATTERNS: RegExp[] = [
  /\b(enroll|enrol|enrollment)\b/i,
  /\b(sign\s*me\s*up|register\s*me)\b/i,
  /\b(i\s+want\s+to\s+(enroll|apply|register))\b/i,
  /\b(can\s+you|could\s+you|please)\s+(enroll|register|sign\s*me\s*up)\b/i,
  /\b(enroll|register)\s+me\b/i,
  /\b(enroll|apply|register)\s+(me\s+)?(for|to|in)\b/i,
  /\bhelp\s+me\s+(apply|enroll|register)\b/i,
  /\b(i('?m|\s+am)\s+ready\s+to\s+(apply|enroll|register))\b/i,
  /\bstart\s+(my\s+)?(application|enrollment|applying)\b/i,
  /\bapply\s+(now|for\s+admission)\b/i,
  /\badmit\s+me\b/i,
  /\b(take|put)\s+me\s+(in|into)\b/i,
];

export function isEnrollIntent(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  return ENROLL_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(t);
  });
}

/** Short affirmative after an enrollment CTA ("Ready to enroll…?"). */
export function isEnrollAffirmative(message: string): boolean {
  const t = message.trim();
  if (!t || t.length > 60) return false;
  if (
    /^(yes|yeah|yep|yup|sure|ok|okay|let'?s\s+go|go\s+ahead|please|absolutely|definitely|i'?m\s+ready)[!.?]*$/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(yes|yeah|let'?s\s+(do\s+it|enroll|apply|start)|sign\s+me\s+up|enroll\s+me)\b/i.test(
    t
  );
}

const FOLLOW_UP =
  /\b(it|this|that|the program|the course|there|they|same|how long|how much|what about|tell me more|requirements?|fees?|tuition|duration|campus)\b/i;

/** Resolve faculty from message, inheriting prior faculty on short follow-ups. */
export function resolveFacultyFromMessage(
  message: string,
  priorFaculty: string | null
): string | null {
  const intent = detectIntent(message);
  if (intent.faculty) return intent.faculty;
  if (priorFaculty && FOLLOW_UP.test(message)) return priorFaculty;
  return null;
}

/** Count consecutive user questions about the same faculty (oldest → newest). */
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

export function enrollmentWelcomeMessage(): string {
  return (
    "Great — I'll help you start your SNU application.\n\n" +
    "Please answer the following questions carefully and with **accurate information** " +
    "(your full name, phone, school details, faculty choices, and documents). " +
    "This info is used for your official enrollment, so double-check before submitting.\n\n" +
    "The application form will open in a few seconds…"
  );
}

export function enrollmentCtaMessage(faculty: string): string {
  return (
    `\n\n---\n\nReady to enroll in **${faculty}**? ` +
    `Say **yes** or tap the **+** button below to start your application.`
  );
}

export function enrollmentIntentReply(faculty: string | null): string {
  if (faculty) {
    return (
      `I'd be happy to help you apply for **${faculty}**! ` + enrollmentWelcomeMessage()
    );
  }
  return enrollmentWelcomeMessage();
}

/** True if the last assistant message offered enrollment via the 3-question CTA. */
export function lastAssistantOfferedEnrollment(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /Ready to enroll in/i.test(history[i].content);
    }
    if (history[i].role === "user") break;
  }
  return false;
}
