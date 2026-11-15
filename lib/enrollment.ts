import { getSupabase } from "./supabase";

/** Student-facing enrollment steps (campus / exam are admin-only). */
export const TOTAL_ENROLLMENT_STEPS = 12;

export type PaymentMethod = "bank_receipt" | "office_delivery";

export type EnrollmentData = {
  // step 1
  full_name?: string;
  mothers_name?: string;
  // step 2
  phone?: string;
  // step 3
  gender?: string;
  date_of_birth?: string; // ISO date string
  place_of_birth?: string;
  // step 4
  national_id?: string;
  nationality?: string;
  // step 5
  region?: string;
  address?: string;
  // step 6
  school_name?: string;
  school_country?: string;
  school_region_city?: string;
  // step 7
  certificate_type?: string;
  exam_roll_number?: string;
  certificate_number?: string;
  // admin-only (not collected in student flow)
  study_campus?: string;
  exam_location?: string;
  // step 8
  faculty_choice_1?: string;
  // step 9
  faculty_choice_2?: string;
  faculty_choice_3?: string;
  // step 10
  guardian_name?: string;
  guardian_mobile?: string;
  guardian_relation?: string;
  // step 11 — core docs (payment receipt is optional, step 12)
  doc_photo_url?: string;
  doc_id_url?: string;
  doc_certificate_url?: string;
  doc_payment_url?: string;
  // step 12 — payment choice (receipt / bank ref optional)
  payment_method?: PaymentMethod | string | null;
  bank_reference_number?: string | null;
  // meta
  conversation_id?: string;
  enrollment_step?: number;
  /** Human-readable progress marker (e.g. "Step 3: gender…"). */
  current_step?: string;
  enrollment_status?: string;
  needs_human?: boolean;
};

/** Upsert partial enrollment data into students table.
 *  Phone is the canonical key once known; before that we key by conversation_id. */
export async function upsertEnrollment(data: EnrollmentData): Promise<void> {
  const supabase = getSupabase();

  // Prefer a consistent phone form for future lookups
  const payload = { ...data };
  if (payload.phone) {
    const digits = payload.phone.replace(/\D/g, "");
    let normalized = digits.startsWith("00") ? digits.slice(2) : digits;
    if (normalized.startsWith("0") && normalized.length >= 9) {
      normalized = `252${normalized.slice(1)}`;
    } else if (normalized.length === 9 && normalized.startsWith("6")) {
      normalized = `252${normalized}`;
    }
    if (normalized.startsWith("252") && normalized.length >= 12) {
      const local = normalized.slice(3);
      payload.phone = `+252 ${local}`;
    }
  }

  // DB has both mother_name (legacy) and mothers_name (app) — keep them in sync
  if (typeof payload.mothers_name === "string") {
    (payload as EnrollmentData & { mother_name?: string }).mother_name =
      payload.mothers_name;
  }

  // Always refresh the readable progress marker after each save
  payload.current_step = currentStepForEnrollment(payload);

  if (payload.phone) {
    // A phone-less draft saved at step 1 for this conversation: fill it in
    // rather than creating a second row for the same conversation.
    if (payload.conversation_id) {
      const { data: draft } = await supabase
        .from("students")
        .select("id")
        .eq("conversation_id", payload.conversation_id)
        .is("phone", null)
        .maybeSingle();

      if (draft) {
        const { data: sameNumber } = await supabase
          .from("students")
          .select("phone")
          .eq("phone", payload.phone)
          .maybeSingle();

        if (!sameNumber) {
          const { error } = await supabase
            .from("students")
            .update(payload)
            .eq("conversation_id", payload.conversation_id)
            .is("phone", null);
          if (error) throw new Error(`enrollment update failed: ${error.message}`);
          return;
        }

        // This number already has an application: drop the empty draft and
        // continue on the existing row (the payload carries the draft's fields).
        const { error } = await supabase
          .from("students")
          .delete()
          .eq("conversation_id", payload.conversation_id)
          .is("phone", null);
        if (error) throw new Error(`enrollment update failed: ${error.message}`);
      }
    }

    // Phone known — upsert on phone
    const { error } = await supabase
      .from("students")
      .upsert({ ...payload }, { onConflict: "phone", ignoreDuplicates: false });
    if (error) throw new Error(`enrollment upsert failed: ${error.message}`);
  } else if (payload.conversation_id) {
    // No phone yet — check if a row with this conversation_id exists
    const { data: existing } = await supabase
      .from("students")
      .select("phone")
      .eq("conversation_id", payload.conversation_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("students")
        .update(payload)
        .eq("conversation_id", payload.conversation_id);
      if (error) throw new Error(`enrollment update failed: ${error.message}`);
    } else {
      const { error } = await supabase.from("students").insert(payload);
      // Step 1 has no phone yet. If the database still requires one
      // (23502 = not-null violation), skip the early save: the form resends
      // every answer so far with the phone at step 2, and the row is created then.
      const phoneRequired =
        error?.code === "23502" && /"phone"/.test(error.message ?? "");
      if (error && !phoneRequired) {
        throw new Error(`enrollment insert failed: ${error.message}`);
      }
    }
  }
}

/** Load partial enrollment by conversation_id (for resume). */
export async function loadEnrollmentByConversation(
  conversationId: string
): Promise<EnrollmentData | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("students")
    .select("*")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw new Error(`enrollment load failed: ${error.message}`);
  return data as EnrollmentData | null;
}

/** Ordered UI field groups → resume step (1-based). Campus/exam are admin-only (skipped).
 *  doc_payment_url / bank_reference_number are optional and never block completion. */
const ENROLLMENT_FIELD_STEPS: { step: number; fields: (keyof EnrollmentData)[] }[] = [
  { step: 1, fields: ["full_name", "mothers_name"] },
  { step: 2, fields: ["phone"] },
  { step: 3, fields: ["gender", "date_of_birth", "place_of_birth"] },
  { step: 4, fields: ["national_id", "nationality"] },
  { step: 5, fields: ["region", "address"] },
  { step: 6, fields: ["school_name", "school_country", "school_region_city"] },
  { step: 7, fields: ["exam_roll_number"] },
  { step: 8, fields: ["faculty_choice_1"] },
  { step: 9, fields: ["faculty_choice_2", "faculty_choice_3"] },
  { step: 10, fields: ["guardian_name", "guardian_mobile", "guardian_relation"] },
  {
    step: 11,
    fields: ["doc_photo_url", "doc_id_url", "doc_certificate_url"],
  },
  // step 12 handled by isPaymentChoiceComplete (receipt optional)
];

/** Enrollment values as read from DB / admin rows (nulls allowed). */
export type EnrollmentFields = {
  [K in keyof EnrollmentData]?: EnrollmentData[K] | null;
};

function fieldFilled(
  data: EnrollmentFields,
  key: keyof EnrollmentData
): boolean {
  const v = data[key];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v > 0;
  if (typeof v === "boolean") return true;
  return Boolean(v);
}

/** True when the student finished the payment step in a submit-ready way. */
export function isPaymentChoiceComplete(data: EnrollmentFields): boolean {
  const method = String(data.payment_method || "")
    .trim()
    .toLowerCase();
  if (method === "office_delivery") return true;
  if (method === "bank_receipt" && fieldFilled(data, "doc_payment_url")) {
    return true;
  }
  return false;
}

/** Fields read by payment-pending helpers (nullable to match DB / admin rows). */
export type PaymentPendingFields = {
  payment_method?: string | null;
  doc_payment_url?: string | null;
  bank_reference_number?: string | null;
  enrollment_status?: string | null;
};

/** Payment still owed / awaiting receipt (for student + admin UI). */
export function isPaymentPending(data: PaymentPendingFields): boolean {
  if ((data.doc_payment_url || "").trim().length > 0) return false;
  const method = String(data.payment_method || "")
    .trim()
    .toLowerCase();
  if (method === "office_delivery" || method === "bank_receipt") return true;
  // Submitted without a receipt on file
  const status = (data.enrollment_status || "").trim().toLowerCase();
  if (
    status === "pending_review" ||
    status === "under_review" ||
    status === "submitted"
  ) {
    return true;
  }
  return false;
}

export function formatPaymentPendingLabel(
  data: PaymentPendingFields
): string | null {
  if (!isPaymentPending(data)) return null;
  const method = String(data.payment_method || "")
    .trim()
    .toLowerCase();
  if (method === "office_delivery") {
    return "Pending payment (bring receipt to office)";
  }
  if (method === "bank_receipt") {
    return "Pending payment (bank receipt)";
  }
  return "Pending payment";
}

/** First incomplete step (1-based), or null if application looks complete. */
export function nextIncompleteEnrollmentStep(
  data: EnrollmentFields
): number | null {
  for (const group of ENROLLMENT_FIELD_STEPS) {
    const missing = group.fields.some((f) => !fieldFilled(data, f));
    if (missing) return group.step;
  }
  if (!isPaymentChoiceComplete(data)) return 12;
  return null;
}

export function isEnrollmentIncomplete(data: EnrollmentFields): boolean {
  return nextIncompleteEnrollmentStep(data) != null;
}

/** Human-readable labels for student-facing steps (1-based). */
export const ENROLLMENT_STEP_LABELS: Record<number, string> = {
  1: "your name & mother's name",
  2: "phone number",
  3: "gender, date of birth & place of birth",
  4: "national ID / passport & nationality",
  5: "current region & address",
  6: "secondary school details",
  7: "exam roll & certificate number",
  8: "first faculty choice",
  9: "2nd & 3rd faculty choices",
  10: "guardian / emergency contact",
  11: "document uploads",
  12: "exam fee payment",
};

export function enrollmentStepLabel(step: number | null | undefined): string {
  const n = Number(step ?? 0);
  return ENROLLMENT_STEP_LABELS[n] || `step ${n || 1}`;
}

/** Short facts already on file (for resume acknowledgements). */
export function summarizeSavedEnrollment(
  data: EnrollmentData
): {
  nextStep: number;
  nextLabel: string;
  savedBits: string[];
  paymentPending: boolean;
} {
  const nextStep = nextIncompleteEnrollmentStep(data) ?? 1;
  const savedBits: string[] = [];
  // Labels only — never echo raw PII into resume prompts
  if (fieldFilled(data, "full_name")) savedBits.push("name");
  if (fieldFilled(data, "phone")) savedBits.push("phone");
  if (fieldFilled(data, "faculty_choice_1")) {
    savedBits.push("1st faculty choice");
  }
  if (
    fieldFilled(data, "doc_photo_url") ||
    fieldFilled(data, "doc_id_url") ||
    fieldFilled(data, "doc_certificate_url")
  ) {
    savedBits.push("core documents");
  }
  if (fieldFilled(data, "payment_method")) {
    savedBits.push(
      data.payment_method === "office_delivery"
        ? "office delivery chosen"
        : "payment method chosen"
    );
  }
  return {
    nextStep,
    nextLabel: enrollmentStepLabel(nextStep),
    savedBits,
    paymentPending: isPaymentPending(data),
  };
}

/** Persist a readable current_step string for admins / resume copy. */
export function currentStepForEnrollment(data: EnrollmentData): string {
  const next = nextIncompleteEnrollmentStep(data);
  if (next == null) return "Submitted";
  return `Step ${next}: ${enrollmentStepLabel(next)}`;
}

/** Fields wiped on "Start over" (keep conversation_id / row identity). */
const START_OVER_CLEAR_KEYS: (keyof EnrollmentData)[] = [
  "full_name",
  "mothers_name",
  "phone",
  "gender",
  "date_of_birth",
  "place_of_birth",
  "national_id",
  "nationality",
  "region",
  "address",
  "school_name",
  "school_country",
  "school_region_city",
  "certificate_type",
  "exam_roll_number",
  "certificate_number",
  "faculty_choice_1",
  "faculty_choice_2",
  "faculty_choice_3",
  "guardian_name",
  "guardian_mobile",
  "guardian_relation",
  "doc_photo_url",
  "doc_id_url",
  "doc_certificate_url",
  "doc_payment_url",
  "payment_method",
  "bank_reference_number",
];

/** Reset an in-progress application for this conversation (does not delete the row). */
export async function resetEnrollmentForConversation(
  conversationId: string
): Promise<void> {
  const supabase = getSupabase();
  const cleared: Record<string, unknown> = {
    enrollment_step: 0,
    current_step: currentStepForEnrollment({}),
    enrollment_status: "in_progress",
    needs_human: false,
    mother_name: null,
  };
  for (const key of START_OVER_CLEAR_KEYS) {
    cleared[key] = null;
  }
  const { error } = await supabase
    .from("students")
    .update(cleared)
    .eq("conversation_id", conversationId);
  if (error) {
    throw new Error(`enrollment start-over failed: ${error.message}`);
  }
}

/** True when the student-facing application is finished (ready for admin review). */
export function isEnrollmentSubmitted(data: {
  enrollment_step?: number | null;
  enrollment_status?: string | null;
} & Partial<EnrollmentData>): boolean {
  const status = (data.enrollment_status || "").trim().toLowerCase();
  if (
    status === "pending_review" ||
    status === "under_review" ||
    status === "submitted" ||
    status === "approved" ||
    status === "accepted" ||
    status === "enrolled" ||
    status === "rejected" ||
    status === "declined"
  ) {
    return true;
  }
  const step = Number(data.enrollment_step ?? 0);
  if (step >= TOTAL_ENROLLMENT_STEPS) return true;
  return nextIncompleteEnrollmentStep(data as EnrollmentData) == null;
}

const TERMINAL_STATUSES = new Set([
  "approved",
  "accepted",
  "enrolled",
  "rejected",
  "declined",
]);

const REVIEW_STATUSES = new Set([
  "pending_review",
  "under_review",
  "submitted",
]);

/** Status to persist for a student upsert, given incoming payload. */
export function enrollmentStatusForUpsert(data: EnrollmentData): string {
  const prior = (data.enrollment_status || "").trim().toLowerCase();
  if (TERMINAL_STATUSES.has(prior)) return prior;
  if (REVIEW_STATUSES.has(prior)) return prior === "submitted" ? "pending_review" : prior;

  const step = Number(data.enrollment_step ?? 0);
  const complete =
    step >= TOTAL_ENROLLMENT_STEPS ||
    nextIncompleteEnrollmentStep(data) == null;
  if (complete) return "pending_review";
  return prior || "in_progress";
}

/** True when this upsert is the transition into under-review. */
export function isEnrollmentJustSubmitted(data: EnrollmentData): boolean {
  const prior = (data.enrollment_status || "").trim().toLowerCase();
  if (TERMINAL_STATUSES.has(prior) || REVIEW_STATUSES.has(prior)) return false;
  const step = Number(data.enrollment_step ?? 0);
  return (
    step >= TOTAL_ENROLLMENT_STEPS ||
    nextIncompleteEnrollmentStep(data) == null
  );
}

export const TIER_1_FACULTIES = [
  "Medicine and Surgery",
  "Science",
  "Engineering",
  "Economic and Management Science",
] as const;

export const ALL_FACULTIES = [
  "Agriculture and Environmental Science",
  "Economic and Management Science",
  "Education",
  "Engineering",
  "Health Sciences and Tropical Medicine",
  "Languages",
  "Law",
  "Medicine and Surgery",
  "Science",
  "Sharia and Islamic Studies",
  "Social Science",
  "Veterinary Medicine and Animal Husbandry",
] as const;

export type Faculty = (typeof ALL_FACULTIES)[number];

export function isTier1(faculty: string): boolean {
  return (TIER_1_FACULTIES as readonly string[]).includes(faculty);
}

export function isKnownFaculty(faculty: string): boolean {
  return (ALL_FACULTIES as readonly string[]).includes(faculty);
}

/**
 * Allowed faculties for a choice slot (exact-name match).
 * - Choice 1: any faculty
 * - Choice 2/3: never Tier 1; also exclude earlier picks in `alreadyChosen`
 */
export function allowedFaculties(
  alreadyChosen: string[],
  slot: 1 | 2 | 3 = 2
): Faculty[] {
  return ALL_FACULTIES.filter((f) => {
    if (alreadyChosen.includes(f)) return false;
    if (slot !== 1 && isTier1(f)) return false;
    return true;
  });
}

const TIER_1_FIRST_ONLY_NOTE =
  "Medicine & Surgery, Science, Engineering, and Economic & Management Science can only be your first choice.";

export const FACULTY_CHOICE_TIER1_NOTE = TIER_1_FIRST_ONLY_NOTE;

/** Validate faculty trio. Empty slots are allowed (partial saves). */
export function validateFacultyChoices(data: {
  faculty_choice_1?: string | null;
  faculty_choice_2?: string | null;
  faculty_choice_3?: string | null;
}): string | null {
  const c1 = (data.faculty_choice_1 ?? "").trim();
  const c2 = (data.faculty_choice_2 ?? "").trim();
  const c3 = (data.faculty_choice_3 ?? "").trim();

  if (c1 && !isKnownFaculty(c1)) {
    return `Invalid first faculty choice: "${c1}".`;
  }
  if (c2) {
    if (!isKnownFaculty(c2)) {
      return `Invalid second faculty choice: "${c2}".`;
    }
    if (isTier1(c2)) {
      return `${TIER_1_FIRST_ONLY_NOTE} "${c2}" cannot be choice 2.`;
    }
    if (c1 && c2 === c1) {
      return `Second faculty choice cannot match the first choice ("${c1}").`;
    }
  }
  if (c3) {
    if (!isKnownFaculty(c3)) {
      return `Invalid third faculty choice: "${c3}".`;
    }
    if (isTier1(c3)) {
      return `${TIER_1_FIRST_ONLY_NOTE} "${c3}" cannot be choice 3.`;
    }
    if (c1 && c3 === c1) {
      return `Third faculty choice cannot match the first choice ("${c1}").`;
    }
    if (c2 && c3 === c2) {
      return `Third faculty choice cannot match the second choice ("${c2}").`;
    }
  }
  return null;
}

export const STUDY_CAMPUSES = [
  "Shabelle Campus",
  "Science & Technology Campus (Km4)",
  "Gahayr Campus",
  "Abudwaq Campus",
  "Badhan Campus",
];

export const EXAM_LOCATIONS = [
  "Shabelle Campus",
  "Gaheyr Campus",
  "Km4 (Science & Technology Campus)",
];
