import { ctaMarker } from "./cta";
import {
  enrollmentFirstName,
  enrollmentPaymentState,
  enrollmentReceivedConfirmationMessage,
  enrollmentResumeContextBlock,
  enrollmentResumeFallbackMessage,
  type EnrollmentResumeAckMode,
} from "./enrollment-intent";
import type { EnrollmentData } from "./enrollment";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
const GROQ_FALLBACK_MODEL =
  process.env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant";

async function groqShortCompletion(
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  async function once(model: string): Promise<string | null> {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens ?? 220,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
    } | null;
    return json?.choices?.[0]?.message?.content?.trim() || null;
  }

  try {
    let text = await once(GROQ_MODEL);
    if (!text && GROQ_FALLBACK_MODEL !== GROQ_MODEL) {
      text = await once(GROQ_FALLBACK_MODEL);
    }
    return text;
  } catch {
    return null;
  }
}

function stripModelChrome(text: string): string {
  return text
    .replace(/\[\[cta:[^\]]+\]\]/gi, "")
    .replace(/\[\[open_enrollment\]\]/gi, "")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * Short, natural resume acknowledgement (model-written).
 * Always appends Continue / Start over CTAs. Falls back if Groq is down.
 * `minimal` (phone match): first name + next step only — no other PII.
 */
export async function generateEnrollmentResumeAcknowledgement(
  data: EnrollmentData,
  mode: EnrollmentResumeAckMode = "full"
): Promise<string> {
  const fallback = enrollmentResumeFallbackMessage(data, mode);
  const context = enrollmentResumeContextBlock(data, mode);
  const system =
    mode === "minimal"
      ? "You are SNUBot helping a student resume after verifying their phone. " +
        "Write 1–2 short sentences. Use first_name if provided (never the full name). " +
        "Say only that you can continue at next_step + next_step_label. " +
        "Do NOT mention ID, address, guardian, school, phone, documents, faculties, or any other saved fields. " +
        "No blame, no bullet lists, no headers, no bold labels, no CTA markers. Vary the wording."
      : "You are SNUBot helping a student resume an interrupted SNU enrollment form. " +
        "Write 1–3 short sentences: warmly acknowledge they left mid-application (no blame, no error tone), " +
        "and name the next step number + label. " +
        "If payment_pending=yes, briefly note they can finish payment later with a bank receipt or office delivery. " +
        "Do NOT invent details, timelines, phone numbers, ID, address, or guardian details. " +
        "Do NOT use bullet lists, headers, or bold labels. Do NOT include CTA markers. Vary the wording.";

  const text = await groqShortCompletion(
    system,
    `Draft the resume acknowledgement from this context:\n${context}`,
    { temperature: 0.7, maxTokens: 160 }
  );

  const cleaned = text ? stripModelChrome(text) : "";
  if (!cleaned || /\+?\d[\d\s\-()]{7,}\d/.test(cleaned)) return fallback;
  return (
    `${cleaned}\n\n` +
    `${ctaMarker("continue_enroll", "Continue")}\n` +
    `${ctaMarker("start_over", "Start over")}`
  );
}

/** Model-written post-submit confirmation (warm, short, no phone number). */
export async function generateEnrollmentConfirmationMessage(
  data: EnrollmentData
): Promise<string> {
  const paymentState = enrollmentPaymentState(data);
  const first = enrollmentFirstName(data.full_name);
  const fallback = enrollmentReceivedConfirmationMessage({
    fullName: data.full_name,
    paymentState,
  });

  const faculties = [
    data.faculty_choice_1,
    data.faculty_choice_2,
    data.faculty_choice_3,
  ]
    .map((f) => (f || "").trim())
    .filter(Boolean);

  const context = [
    `first_name=${first || "(unknown)"}`,
    `payment_state=${paymentState}`,
    `faculties=${faculties.join(" | ") || "(none)"}`,
  ].join("\n");

  const paymentInstruction =
    paymentState === "office_delivery"
      ? "Mention they should bring the bank receipt to the SNU office."
      : paymentState === "pending"
        ? "Mention they can upload the bank receipt later or bring it to the office."
        : "Payment receipt is already on file — no need to ask for it again.";

  const text = await groqShortCompletion(
    "You are SNUBot confirming a completed SNU enrollment application. " +
      "Write 3–4 short sentences in a warm, natural voice (same as a friendly admissions assistant). " +
      "Cover: the application is received and under review; an admin will verify documents and contact them if anything is missing; " +
      "how to check status later — tell them to ask you to check status and give the phone number they applied with " +
      '(say "the number you applied with" — NEVER print the actual phone number). ' +
      `${paymentInstruction} ` +
      "Use first_name only if provided (not the full name). You may briefly acknowledge their faculty choices. " +
      "No headers, no bold labels, no bullet lists, no invented timelines or promises. Vary the wording.",
    `Draft the confirmation from this context:\n${context}`,
    { temperature: 0.75, maxTokens: 220 }
  );

  const cleaned = text ? stripModelChrome(text) : "";
  // Guard against the model echoing a phone-looking token
  if (!cleaned || /\+?\d[\d\s\-()]{7,}\d/.test(cleaned)) return fallback;
  return cleaned;
}
