import { getSupabase } from "./supabase";

export type AdminStudentListItem = {
  id: string;
  phone: string | null;
  full_name: string | null;
  enrollment_status: string | null;
  enrollment_step: number | null;
  faculty_choice_1: string | null;
  study_campus: string | null;
  exam_location: string | null;
  conversation_id: string | null;
  needs_human: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AdminStudentDetail = AdminStudentListItem & {
  mothers_name: string | null;
  gender: string | null;
  date_of_birth: string | null;
  place_of_birth: string | null;
  national_id: string | null;
  nationality: string | null;
  region: string | null;
  address: string | null;
  school_name: string | null;
  school_country: string | null;
  school_region_city: string | null;
  certificate_type: string | null;
  exam_roll_number: string | null;
  certificate_number: string | null;
  faculty_choice_2: string | null;
  faculty_choice_3: string | null;
  guardian_name: string | null;
  guardian_mobile: string | null;
  guardian_relation: string | null;
  doc_photo_url: string | null;
  doc_id_url: string | null;
  doc_certificate_url: string | null;
  doc_payment_url: string | null;
};

export type AdminStudentPatch = {
  study_campus?: string | null;
  exam_location?: string | null;
  enrollment_status?: string | null;
  full_name?: string | null;
  mothers_name?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  place_of_birth?: string | null;
  national_id?: string | null;
  nationality?: string | null;
  region?: string | null;
  address?: string | null;
  school_name?: string | null;
  school_country?: string | null;
  school_region_city?: string | null;
  exam_roll_number?: string | null;
  certificate_number?: string | null;
  faculty_choice_1?: string | null;
  faculty_choice_2?: string | null;
  faculty_choice_3?: string | null;
  guardian_name?: string | null;
  guardian_mobile?: string | null;
  guardian_relation?: string | null;
};

const PATCHABLE_TEXT_KEYS = [
  "study_campus",
  "exam_location",
  "full_name",
  "mothers_name",
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
  "exam_roll_number",
  "certificate_number",
  "faculty_choice_1",
  "faculty_choice_2",
  "faculty_choice_3",
  "guardian_name",
  "guardian_mobile",
  "guardian_relation",
] as const satisfies readonly (keyof AdminStudentPatch)[];

export const ADMIN_ENROLLMENT_STATUSES = [
  "in_progress",
  "pending_review",
  "approved",
  "rejected",
] as const;

export type AdminEnrollmentStatus = (typeof ADMIN_ENROLLMENT_STATUSES)[number];

const LIST_SELECT =
  "id, phone, full_name, enrollment_status, enrollment_step, faculty_choice_1, study_campus, exam_location, conversation_id, needs_human, created_at, updated_at";

const DETAIL_SELECT =
  "id, phone, full_name, mothers_name, gender, date_of_birth, place_of_birth, national_id, nationality, region, address, school_name, school_country, school_region_city, certificate_type, exam_roll_number, certificate_number, study_campus, exam_location, faculty_choice_1, faculty_choice_2, faculty_choice_3, guardian_name, guardian_mobile, guardian_relation, doc_photo_url, doc_id_url, doc_certificate_url, doc_payment_url, enrollment_status, enrollment_step, conversation_id, needs_human, created_at, updated_at";

/** Map UI filter keys to DB status values. */
export function statusFilterValues(
  status: string | null | undefined
): string[] | null {
  const key = (status || "").trim().toLowerCase();
  if (!key || key === "all") return null;
  if (key === "pending_review" || key === "under_review") {
    return ["pending_review", "under_review", "pending", "submitted"];
  }
  if (key === "in_progress") {
    return ["in_progress", "draft", "started", "incomplete"];
  }
  if (key === "approved") return ["approved", "accepted", "enrolled"];
  if (key === "rejected") return ["rejected", "declined"];
  return [key];
}

export async function listAdminStudents(opts: {
  q?: string;
  status?: string;
  limit?: number;
}): Promise<AdminStudentListItem[]> {
  const supabase = getSupabase();
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const q = (opts.q || "").trim();

  let query = supabase
    .from("students")
    .select(LIST_SELECT)
    .order("updated_at", { ascending: false })
    .limit(limit);

  const statuses = statusFilterValues(opts.status);
  if (statuses) {
    if (opts.status?.toLowerCase() === "in_progress") {
      query = query.or(
        `enrollment_status.in.(${statuses.join(",")}),enrollment_status.is.null`
      );
    } else {
      query = query.in("enrollment_status", statuses);
    }
  }

  if (q) {
    const safe = q.replace(/[%_,.()]/g, " ").trim();
    if (safe) {
      query = query.or(
        `full_name.ilike.%${safe}%,phone.ilike.%${safe}%,faculty_choice_1.ilike.%${safe}%`
      );
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as AdminStudentListItem[];
}

export async function getAdminStudent(
  id: string
): Promise<AdminStudentDetail | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("students")
    .select(DETAIL_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AdminStudentDetail | null) ?? null;
}

export async function patchAdminStudent(
  id: string,
  patch: AdminStudentPatch
): Promise<AdminStudentDetail> {
  const allowed: AdminStudentPatch = {};
  for (const key of PATCHABLE_TEXT_KEYS) {
    if (key in patch) {
      const raw = patch[key];
      allowed[key] = typeof raw === "string" ? raw.trim() || null : null;
    }
  }
  if ("enrollment_status" in patch) {
    const status = (patch.enrollment_status || "").trim().toLowerCase();
    if (
      status &&
      !(ADMIN_ENROLLMENT_STATUSES as readonly string[]).includes(status)
    ) {
      throw new Error(
        `enrollment_status must be one of: ${ADMIN_ENROLLMENT_STATUSES.join(", ")}`
      );
    }
    allowed.enrollment_status = status || null;
  }

  if (Object.keys(allowed).length === 0) {
    throw new Error("No valid fields to update");
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("students")
    .update(allowed)
    .eq("id", id)
    .select(DETAIL_SELECT)
    .single();

  if (error) throw new Error(error.message);
  return data as AdminStudentDetail;
}
