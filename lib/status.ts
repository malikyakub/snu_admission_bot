/** Greeting / small-talk detector — runs before RAG to avoid low-confidence handoff. */

const GREETING_PATTERNS: RegExp[] = [
  /^(hey|hi|hello|hiya|howdy|hola|salaam|salam|yo|sup|what'?s up|wassup)[!.,?]*$/i,
  /^(good\s?(morning|afternoon|evening|night|day))[!.,?]*$/i,
  /^(thanks?|thank\s?you|thx|ty|cheers|appreciated?)[!.,?]*$/i,
  /^(ok|okay|k|cool|got\s?it|noted|sure|alright|sounds good|great|nice|perfect|wonderful|awesome)[!.,?]*$/i,
  /^(bye|goodbye|see\s?ya|later|take\s?care|cya)[!.,?]*$/i,
  /^(yes|no|yep|nope|yup|nah)[!.,?]*$/i,
  /^(lol|haha|hehe|😊|👍|🙏)[!.,?]*$/i,
];

export function isGreeting(message: string): boolean {
  const t = message.normalize("NFKC").trim();
  // Only test short messages (≤ 40 chars) to avoid false-positives on real questions
  if (t.length > 40) return false;
  return GREETING_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(t);
  });
}

/** Enrollment / application status check via phone number (not RAG). */

const STATUS_CHECK_PATTERNS: RegExp[] = [
  /\bcheck (my |the )?(application |enrollment )?status\b/i,
  /\btrack (my )?(application|enrollment|status)\b/i,
  /\b(application|enrollment) status\b/i,
  /\bmy (application|enrollment) status\b/i,
  /\bstatus of my (application|enrollment)\b/i,
  /\bwhere is my (application|enrollment)\b/i,
  /\benrollment status\b/i,
];

const ASK_FOR_PHONE =
  "Sure — I can look up your enrollment status. Please reply with the phone number you used on your application.";

const START_ENROLLMENT_OFFER =
  "I couldn't find an application under that phone number. Would you like to start the enrollment process?";

export function isStatusCheckIntent(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  return STATUS_CHECK_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(t);
  });
}

/** Extract a phone-like token from the message, or null if none. */
export function extractPhoneNumber(message: string): string | null {
  const t = message.normalize("NFKC").trim();
  // Prefer an explicit number-shaped token (allow spaces/dashes/parens).
  const match = t.match(
    /(?:\+|00)?[\d][\d\s\-().]{6,}\d/
  );
  if (match) {
    const digits = match[0].replace(/\D/g, "");
    if (digits.length >= 7) return match[0].trim();
  }

  // Whole message is mostly digits (common after we asked for the number).
  const digitsOnly = t.replace(/\D/g, "");
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    const nonDigitRatio = (t.length - digitsOnly.length) / Math.max(t.length, 1);
    if (nonDigitRatio <= 0.35) return t;
  }

  return null;
}

export function lastAssistantAskedForPhone(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /phone number you used on your application/i.test(
        history[i].content
      );
    }
  }
  return false;
}

export function statusAskForPhoneMessage(): string {
  return ASK_FOR_PHONE;
}

export function formatStudentStatus(student: {
  full_name: string | null;
  enrollment_status: string | null;
  current_step: string | null;
  phone: string;
}): string {
  const name = student.full_name?.trim() || "there";
  const status = student.enrollment_status?.trim() || "unknown";
  const step = student.current_step?.trim();

  const statusLine = `Hi ${name}, your enrollment status is currently "${status}".`;
  if (step) {
    return `${statusLine} You're on this step: ${step}.`;
  }
  return statusLine;
}

export function statusNotFoundMessage(): string {
  return START_ENROLLMENT_OFFER;
}

/** Detect yes to "start enrollment" after a not-found status lookup. */
export function isStartEnrollmentAffirmative(message: string): boolean {
  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!t) return false;
  if (
    /^(y|yes|yeah|yep|yup|sure|ok|okay|please|alright|go ahead|do it|start)([.!?\s]|$)/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(start (the )?enrollment|begin (the )?enrollment|enroll( me)?|sign ?up)\b/i.test(
    t
  );
}

export function lastAssistantOfferedStartEnrollment(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /start the enrollment process/i.test(history[i].content);
    }
  }
  return false;
}

export function startEnrollmentStubMessage(): string {
  return (
    "Great — enrollment signup through this chat isn't fully available yet. " +
    "For now, please continue on the official portal: https://student.snu.edu.so/admission/home"
  );
}
