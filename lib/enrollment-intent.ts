import { detectIntent, extractFacultyFromHistory } from "./intent";
import {
  appendEnrollCta,
  ctaMarker,
  hasCta,
  hasEnrollmentResumeCtas,
} from "./cta";
import {
  summarizeSavedEnrollment,
  type EnrollmentData,
} from "./enrollment";

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
  // Naming the faculties they want ("I want Medicine as my first choice")
  /\bas\s+my\s+((first|second|third|1st|2nd|3rd)\s+)?(faculty\s+)?choices?\b/i,
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

/** First token of a full name (for warm, short confirmations). */
export function enrollmentFirstName(fullName?: string | null): string {
  const first = (fullName || "").trim().split(/\s+/)[0] || "";
  return first;
}

export type EnrollmentPaymentState =
  | "receipt_uploaded"
  | "office_delivery"
  | "pending";

export function enrollmentPaymentState(
  data: Partial<EnrollmentData>
): EnrollmentPaymentState {
  if ((data.doc_payment_url || "").trim()) return "receipt_uploaded";
  if (String(data.payment_method || "").trim().toLowerCase() === "office_delivery") {
    return "office_delivery";
  }
  return "pending";
}

/** Plain fallback if the model confirmation call fails. */
export function enrollmentReceivedConfirmationMessage(opts?: {
  fullName?: string | null;
  phone?: string | null;
  paymentState?: EnrollmentPaymentState;
}): string {
  const first = enrollmentFirstName(opts?.fullName);
  const greet = first ? `Thanks, ${first}` : "Thanks";
  const payment =
    opts?.paymentState === "office_delivery"
      ? " Remember to bring your bank receipt to the SNU office when you can."
      : opts?.paymentState === "pending"
        ? " You can upload your bank receipt later or bring it to the office."
        : "";
  return (
    `${greet} — we've received your SNU application and it's under review. ` +
    `An admin will verify your documents and contact you if anything is missing. ` +
    `To check status later, just ask me and give the number you applied with.` +
    payment
  );
}

/** Ask for phone to resume when this browser has no linked draft. */
export function enrollmentResumeAskPhoneMessage(): string {
  return (
    "Sure — I can pick up your in-progress application. " +
    "Reply with the phone number you used when you applied. " +
    "I won't share any saved details until that number matches."
  );
}

export function lastAssistantAskedForEnrollmentResumePhone(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /phone number you used when you applied/i.test(history[i].content);
    }
    if (history[i].role === "user") break;
  }
  return false;
}

/**
 * Neutral miss reply for phone resume — same text whether the number is
 * unknown, already submitted, or otherwise not resumable (no enumeration).
 */
export function enrollmentResumePhoneMissMessage(): string {
  return (
    "I couldn't match an in-progress application to resume. " +
    "You can try again later, or start a new application.\n\n" +
    `${ctaMarker("enroll", "Start your application")}`
  );
}

/** @deprecated alias — use enrollmentResumePhoneMissMessage */
export function enrollmentResumePhoneNotFoundMessage(): string {
  return enrollmentResumePhoneMissMessage();
}

export function enrollmentResumePhoneRateLimitedMessage(): string {
  return (
    "Please wait a bit before trying again. " +
    "You can also start a new application anytime.\n\n" +
    `${ctaMarker("enroll", "Start your application")}`
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

/** Student wants to resume a saved application. */
export function isContinueEnrollmentIntent(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\bcontinue\s+(my\s+)?(enrollment|application|enrolment|applying)\b/i.test(
      t
    ) ||
    /\bresume\s+(my\s+)?(enrollment|application|enrolment)\b/i.test(t) ||
    /^(continue|resume)[.!]*$/i.test(t)
  );
}

/** Student wants to wipe and restart enrollment. */
export function isStartOverEnrollmentIntent(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /\bstart\s+over\b/i.test(t) ||
    /\brestart\s+(my\s+)?(enrollment|application|enrolment)\b/i.test(t) ||
    /\bstart\s+(a\s+)?new\s+(enrollment|application)\b/i.test(t)
  );
}

/** Affirmative after a start-over confirmation prompt. */
export function isConfirmStartOver(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!t || t.length > 40) return false;
  return /^(y|yes|yeah|yep|yup|sure|ok|okay|confirm|do it|start over|please)[.!]*$/i.test(
    t
  );
}

/** Student cancels / pauses mid-enrollment (panel close or "stop"). */
export function isCancelEnrollmentIntent(message: string): boolean {
  const t = message.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return false;
  return (
    /^(stop|cancel|close|quit|exit|never\s*mind|nevermind|not now|later)[.!]*$/i.test(
      t
    ) ||
    /\b(stop|cancel)\s+(the\s+)?(enrollment|application|form)\b/i.test(t) ||
    /\bi('?ll)?\s+(finish|continue)\s+later\b/i.test(t)
  );
}

export function lastAssistantOfferedEnrollmentResume(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return hasEnrollmentResumeCtas(history[i].content);
    }
    if (history[i].role === "user") break;
  }
  return false;
}

export function lastAssistantAskedStartOverConfirm(
  history: { role: string; content: string }[]
): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "assistant") {
      return /start over|erase|clear (your|the) (saved )?application|wipe/i.test(
        history[i].content
      );
    }
    if (history[i].role === "user") break;
  }
  return false;
}

/** Deterministic pause copy when the student closes the form mid-way. */
export function enrollmentPausedMessage(data: EnrollmentData): string {
  const { nextStep, nextLabel, paymentPending } = summarizeSavedEnrollment(data);
  const paymentHint = paymentPending
    ? " When you're ready, you can finish payment with a bank receipt upload or by bringing it to the office."
    : "";
  return (
    `No problem — your progress is saved.\n\n` +
    `Say **continue my enrollment** anytime and we'll pick up at **step ${nextStep}** (${nextLabel}).` +
    paymentHint
  );
}

export type EnrollmentResumeAckMode = "full" | "minimal";

/** Fallback resume text if the model is unavailable. */
export function enrollmentResumeFallbackMessage(
  data: EnrollmentData,
  mode: EnrollmentResumeAckMode = "full"
): string {
  const { nextStep, nextLabel, paymentPending } = summarizeSavedEnrollment(data);
  const first = enrollmentFirstName(data.full_name);
  if (mode === "minimal") {
    const greet = first ? `Welcome back, ${first}` : "Welcome back";
    return (
      `${greet}. We can continue at step ${nextStep} (${nextLabel}).\n\n` +
      `${ctaMarker("continue_enroll", "Continue")}\n` +
      `${ctaMarker("start_over", "Start over")}`
    );
  }
  const payment = paymentPending
    ? " Payment can wait — upload a bank receipt later or deliver it to the office."
    : "";
  return (
    `Welcome back — we can pick up where you left off. ` +
    `Next up is step ${nextStep} (${nextLabel}).${payment}\n\n` +
    `${ctaMarker("continue_enroll", "Continue")}\n` +
    `${ctaMarker("start_over", "Start over")}`
  );
}

/** Compact facts block for the model when drafting a resume acknowledgement. */
export function enrollmentResumeContextBlock(
  data: EnrollmentData,
  mode: EnrollmentResumeAckMode = "full"
): string {
  const { nextStep, nextLabel, paymentPending } = summarizeSavedEnrollment(data);
  const first = enrollmentFirstName(data.full_name);
  if (mode === "minimal") {
    return [
      `mode=minimal`,
      `first_name=${first || "(unknown)"}`,
      `next_step=${nextStep}`,
      `next_step_label=${nextLabel}`,
      `note=After phone match, reveal ONLY first name + next step. Never ID, address, guardian, phone, or other PII.`,
    ].join("\n");
  }
  return [
    `mode=full`,
    `next_step=${nextStep}`,
    `next_step_label=${nextLabel}`,
    `payment_pending=${paymentPending ? "yes" : "no"}`,
    paymentPending
      ? "payment_note=Student can finish later with bank receipt upload or office delivery."
      : null,
    `note=Do not invent or echo ID, address, guardian, or phone values.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function enrollmentStartOverConfirmMessage(): string {
  return (
    "Starting over will clear the answers saved so far for this application. " +
    "Reply **yes** to confirm, or **Continue** to keep your progress.\n\n" +
    `${ctaMarker("continue_enroll", "Continue")}`
  );
}

export function enrollmentStartOverDoneMessage(): string {
  return (
    "Okay — that draft is cleared. You can start a fresh application whenever you're ready.\n\n" +
    `${ctaMarker("enroll", "Start your application")}`
  );
}
