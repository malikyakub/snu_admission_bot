import { getSupabase } from "./supabase";

/** Student-facing enrollment steps (campus / exam are admin-only). */
export const TOTAL_ENROLLMENT_STEPS = 11;

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
  // step 11 — URLs after upload
  doc_photo_url?: string;
  doc_id_url?: string;
  doc_certificate_url?: string;
  doc_payment_url?: string;
  // meta
  conversation_id?: string;
  enrollment_step?: number;
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

  if (payload.phone) {
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
      if (error) throw new Error(`enrollment insert failed: ${error.message}`);
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

/** Ordered UI field groups → resume step (1-based). Campus/exam are admin-only (skipped). */
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
    fields: [
      "doc_photo_url",
      "doc_id_url",
      "doc_certificate_url",
      "doc_payment_url",
    ],
  },
];

function fieldFilled(data: EnrollmentData, key: keyof EnrollmentData): boolean {
  const v = data[key];
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v) && v > 0;
  if (typeof v === "boolean") return true;
  return Boolean(v);
}

/** First incomplete step (1-based), or null if application looks complete. */
export function nextIncompleteEnrollmentStep(
  data: EnrollmentData
): number | null {
  for (const group of ENROLLMENT_FIELD_STEPS) {
    const missing = group.fields.some((f) => !fieldFilled(data, f));
    if (missing) return group.step;
  }
  return null;
}

export function isEnrollmentIncomplete(data: EnrollmentData): boolean {
  return nextIncompleteEnrollmentStep(data) != null;
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

/** Returns allowed faculties for a choice slot.
 *  Tier 1 programs (Medicine, Science, Engineering, Economic & Management)
 *  may only be selected as 1st choice — never as 2nd or 3rd.
 */
export function allowedFaculties(
  alreadyChosen: string[],
  slot: 1 | 2 | 3 = 2
): Faculty[] {
  return ALL_FACULTIES.filter((f) => {
    if (alreadyChosen.includes(f)) return false;
    if (slot > 1 && isTier1(f)) return false;
    return true;
  });
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
