/** Greeting / small-talk detector — runs before RAG to avoid low-confidence handoff. */

import { ctaMarker } from "./cta";
import {
  isEnrollmentIncomplete,
  nextIncompleteEnrollmentStep,
  type EnrollmentData,
} from "./enrollment";
import { isEnrollInterest } from "./enrollment-intent";
import { normalizePhoneDigits } from "./students";

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
  if (t.length > 40) return false;
  // Don't treat phone replies as greetings
  if (extractPhoneNumber(t)) return false;
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
  "I couldn't find an application under that phone number.\n\n" +
  "You can send another number if you used a different one, or start a new application.\n\n" +
  `[[cta:enroll|Start a new application]]`;

const TOPIC_CHANGE_PATTERNS: RegExp[] = [
  /\b(never\s*mind|forget\s*(it|that)|cancel|skip|stop|something\s+else|different\s+(question|topic))\b/i,
  /\b(what|how|when|where|which|who)\b.+\b(about|is|are|do|does|can|should)\b/i,
  /\b(tell\s+me|explain|describe|list|show\s+me)\b/i,
  /\b(options?|facult(y|ies)|programmes?|programs?|fees?|tuition|requirements?|documents?|exam|admission|campus|course)\b/i,
  /\b(let'?s|we('?ll|\s+will)|i\s+want\s+to|i'?d\s+like\s+to)\b.+\b(enroll|enrol|apply|application|start)\b/i,
];

export function isStatusCheckIntent(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  return STATUS_CHECK_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(t);
  });
}

/**
 * Extract a phone-like token from free text.
 * Handles: 613673734, +252613673734, 252613673734, +252 613673734, "what about +252…"
 */
export function extractPhoneNumber(message: string): string | null {
  const t = message.normalize("NFKC").trim();
  if (!t) return null;

  // Prefer explicit international / long digit runs in the text
  const match = t.match(/(?:\+|00)?[\d][\d\s\-().]{6,}\d/);
  if (match) {
    const digits = normalizePhoneDigits(match[0]);
    if (digits.length >= 9 && digits.length <= 15) {
      return match[0].trim();
    }
  }

  // Whole message is mostly a number
  const digitsOnly = t.replace(/\D/g, "");
  if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
    const nonDigitRatio =
      (t.length - digitsOnly.length) / Math.max(t.length, 1);
    if (nonDigitRatio <= 0.5) return t.trim();
  }

  return null;
}

/**
 * True when the student is leaving the status-check phone wait
 * (new enrollment, KB question, cancel, etc.) — not sending a phone.
 */
export function shouldExitPhoneWait(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (extractPhoneNumber(t)) return false;
  if (isStatusCheckIntent(t)) return false;

  if (isEnrollInterest(t)) return true;
  if (isStartEnrollmentAffirmative(t)) return true;

  if (
    TOPIC_CHANGE_PATTERNS.some((p) => {
      p.lastIndex = 0;
      return p.test(t);
    })
  ) {
    return true;
  }

  // Longer free-form that isn't phone-shaped
  if (t.length >= 28 && !/^[\d\s+\-().]+$/.test(t)) return true;

  return false;
}

/** Only the initial "please reply with the phone number" ask — not the not-found offer. */
export function lastAssistantAskedForPhone(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      const c = history[i].content;
      if (/couldn't find an application under that phone number/i.test(c)) {
        return false;
      }
      return /phone number you used on your application/i.test(c);
    }
  }
  return false;
}

export function lastAssistantStatusNotFound(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /couldn't find an application under that phone number/i.test(
        history[i].content
      );
    }
    if (history[i].role === "user") break;
  }
  return false;
}

export function statusAskForPhoneMessage(): string {
  return ASK_FOR_PHONE;
}

/** Human-readable enrollment status for chat replies. */
export function formatEnrollmentStatusLabel(
  raw: string | null | undefined
): string {
  const key = (raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!key) return "In progress";

  const labels: Record<string, string> = {
    pending_review: "Under review",
    under_review: "Under review",
    in_review: "Under review",
    in_progress: "In progress",
    draft: "In progress",
    started: "In progress",
    incomplete: "In progress",
    submitted: "Submitted",
    approved: "Approved",
    accepted: "Accepted",
    rejected: "Rejected",
    declined: "Declined",
    waitlisted: "Waitlisted",
    enrolled: "Enrolled",
    registered: "Registered",
    withdrawn: "Withdrawn",
    cancelled: "Cancelled",
    canceled: "Cancelled",
  };

  if (labels[key]) return labels[key];

  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatStudentStatus(
  student: {
    full_name: string | null;
    enrollment_status: string | null;
    current_step: string | null;
    phone: string;
    enrollment_step?: number | null;
  } & Partial<EnrollmentData>
): string {
  const name = student.full_name?.trim() || "there";
  const status = formatEnrollmentStatusLabel(student.enrollment_status);
  const incomplete = isEnrollmentIncomplete(student);
  const resumeStep =
    nextIncompleteEnrollmentStep(student) ??
    (student.enrollment_step && student.enrollment_step > 0
      ? student.enrollment_step
      : null);

  if (incomplete && resumeStep) {
    return (
      `Hi ${name}, I found your application (status: **${status}**).\n\n` +
      `Some details are still missing — you can continue from step ${resumeStep}.\n\n` +
      ctaMarker("enroll", "Continue your application")
    );
  }

  const statusLine = `Hi ${name}, your enrollment status is currently **${status}**.`;
  const step = student.current_step?.trim();
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
  if (extractPhoneNumber(t)) return false;
  if (
    /^(y|yes|yeah|yep|yup|sure|ok|okay|please|alright|go ahead|do it|start)([.!?\s]|$)/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(start|begin|let'?s|we('?ll)?)\s+(\w+\s+){0,3}(the\s+)?(enrollment|enrolling|application|applying)\b/i.test(
      t
    )
  ) {
    return true;
  }
  if (/\b(let'?s|we('?ll|\s+will))\s+(enroll|apply|sign\s*up)\b/i.test(t)) {
    return true;
  }
  return /\b(start (the )?enrollment|begin (the )?enrollment|enroll( me)?|sign ?up|continue (my |the )?application)\b/i.test(
    t
  );
}

export function lastAssistantOfferedStartEnrollment(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return (
        /\[\[cta:enroll/i.test(history[i].content) ||
        /start the enrollment process/i.test(history[i].content) ||
        /start a new application/i.test(history[i].content) ||
        /couldn't find an application under that phone number/i.test(
          history[i].content
        )
      );
    }
    if (history[i].role === "user") break;
  }
  return false;
}

export function startEnrollmentStubMessage(): string {
  return (
    "You can start your application right here.\n\n" +
    ctaMarker("enroll", "Start your application")
  );
}
