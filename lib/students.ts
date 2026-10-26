import { getSupabase } from "./supabase";
import type { EnrollmentData } from "./enrollment";

export type StudentStatus = {
  phone: string;
  full_name: string | null;
  enrollment_status: string | null;
  current_step: string | null;
  enrollment_step?: number | null;
} & Partial<EnrollmentData>;

/** Digits-only Somalia-aware normalization for comparison. */
export function normalizePhoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);

  // 061… → 25261…
  if (d.startsWith("0") && d.length >= 9 && d.length <= 10) {
    d = `252${d.slice(1)}`;
  }
  // 61xxxxxxx (9 digits, Somali mobile) → 25261…
  if (d.length === 9 && d.startsWith("6")) {
    d = `252${d}`;
  }
  // 252 + local without separator already fine (e.g. 252612544819)
  return d;
}

/** Build common phone variants for exact DB matches. */
export function phoneVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const digits = normalizePhoneDigits(trimmed);
  const variants = new Set<string>();

  if (trimmed) variants.add(trimmed);
  const rawDigits = trimmed.replace(/\D/g, "");
  if (rawDigits) {
    variants.add(rawDigits);
    variants.add(`+${rawDigits}`);
    if (rawDigits.startsWith("00")) {
      variants.add(rawDigits.slice(2));
      variants.add(`+${rawDigits.slice(2)}`);
    }
  }

  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.startsWith("252") && digits.length >= 12) {
      const local = digits.slice(3); // e.g. 612544819
      variants.add(local);
      variants.add(`0${local}`);
      variants.add(`252${local}`);
      variants.add(`+252${local}`);
      variants.add(`+252 ${local}`);
      variants.add(`+252-${local}`);
      variants.add(`252 ${local}`);
      variants.add(`252-${local}`);
      // spaced groups e.g. +252 61 2544819
      if (local.length >= 2) {
        variants.add(`+252 ${local.slice(0, 2)} ${local.slice(2)}`);
        variants.add(`+252 ${local.slice(0, 2)}${local.slice(2)}`);
        variants.add(`252 ${local.slice(0, 2)} ${local.slice(2)}`);
        variants.add(`${local.slice(0, 2)} ${local.slice(2)}`);
      }
    } else if (digits.length >= 9 && digits.startsWith("6")) {
      // Local mobile without country code
      variants.add(`252${digits}`);
      variants.add(`+252${digits}`);
      variants.add(`0${digits}`);
    }
  }

  return [...variants].filter(Boolean);
}

const STUDENT_SELECT =
  "phone, full_name, mothers_name, mother_name, gender, date_of_birth, place_of_birth, national_id, nationality, region, address, school_name, school_country, school_region_city, certificate_type, exam_roll_number, certificate_number, study_campus, exam_location, faculty_choice_1, faculty_choice_2, faculty_choice_3, guardian_name, guardian_mobile, guardian_relation, doc_photo_url, doc_id_url, doc_certificate_url, doc_payment_url, enrollment_status, current_step, enrollment_step, conversation_id, needs_human";

export async function findStudentByPhone(
  rawPhone: string
): Promise<StudentStatus | null> {
  const supabase = getSupabase();
  const target = normalizePhoneDigits(rawPhone);
  const variants = phoneVariants(rawPhone);

  if (variants.length) {
    const { data, error } = await supabase
      .from("students")
      .select(STUDENT_SELECT)
      .in("phone", variants)
      .limit(5);

    if (error) {
      throw new Error(`students lookup failed: ${error.message}`);
    }
    const hit = (data ?? []).find(
      (row) => normalizePhoneDigits(row.phone ?? "") === target
    );
    if (hit) return normalizeStudentRow(hit as StudentStatus);
    if (data?.[0]) return normalizeStudentRow(data[0] as StudentStatus);
  }

  // Fallback: match by local digits (handles odd spacing/punctuation in DB)
  if (target.length >= 9) {
    const local = target.startsWith("252") ? target.slice(3) : target;
    const { data, error } = await supabase
      .from("students")
      .select(STUDENT_SELECT)
      .ilike("phone", `%${local}%`)
      .limit(25);

    if (error) {
      throw new Error(`students lookup failed: ${error.message}`);
    }
    const hit = (data ?? []).find(
      (row) => normalizePhoneDigits(row.phone ?? "") === target
    );
    if (hit) return normalizeStudentRow(hit as StudentStatus);
  }

  return null;
}

/** Prefer mothers_name; fall back to legacy mother_name. */
function normalizeStudentRow(row: StudentStatus & { mother_name?: string | null }): StudentStatus {
  const mothers =
    row.mothers_name?.trim() ||
    (typeof row.mother_name === "string" ? row.mother_name.trim() : "") ||
    undefined;
  return {
    ...row,
    mothers_name: mothers,
  };
}

/** Attach this chat to the student row so enrollment panel can resume. */
export async function linkStudentConversation(
  phone: string,
  conversationId: string
): Promise<void> {
  const supabase = getSupabase();
  const variants = phoneVariants(phone);
  const { error } = await supabase
    .from("students")
    .update({ conversation_id: conversationId })
    .in("phone", variants.length ? variants : [phone]);
  if (error) {
    throw new Error(`link conversation failed: ${error.message}`);
  }
}

/** True for a Somali mobile number (61 234 5678, 0612345678, +252 61 234 5678). */
export function isValidSomaliMobile(raw: string): boolean {
  const d = normalizePhoneDigits(raw);
  return /^252[67]\d{8}$/.test(d) || /^[67]\d{8}$/.test(d);
}
