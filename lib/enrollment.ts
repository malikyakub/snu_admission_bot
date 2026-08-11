import { getSupabase } from "./supabase";

export type EnrollmentData = {
  // step 1
  full_name?: string;
  // step 2
  mothers_name?: string;
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
  // step 8
  study_campus?: string;
  exam_location?: string;
  // step 9
  faculty_choice_1?: string;
  // step 10
  faculty_choice_2?: string;
  // step 11
  faculty_choice_3?: string;
  // step 12
  guardian_name?: string;
  guardian_mobile?: string;
  guardian_relation?: string;
  // step 13 — URLs after upload
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

  if (data.phone) {
    // Phone known — upsert on phone
    const { error } = await supabase
      .from("students")
      .upsert({ ...data }, { onConflict: "phone", ignoreDuplicates: false });
    if (error) throw new Error(`enrollment upsert failed: ${error.message}`);
  } else if (data.conversation_id) {
    // No phone yet — check if a row with this conversation_id exists
    const { data: existing } = await supabase
      .from("students")
      .select("phone")
      .eq("conversation_id", data.conversation_id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("students")
        .update(data)
        .eq("conversation_id", data.conversation_id);
      if (error) throw new Error(`enrollment update failed: ${error.message}`);
    } else {
      const { error } = await supabase.from("students").insert(data);
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

/** Returns allowed choices for choice 2/3 given what's already been picked. */
export function allowedFaculties(
  chosen: string[],
  allChosen: string[]
): Faculty[] {
  const hasT1 = allChosen.some(isTier1);
  return ALL_FACULTIES.filter((f) => {
    if (chosen.includes(f)) return false; // already picked
    if (hasT1 && isTier1(f)) return false; // already used T1 slot
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
