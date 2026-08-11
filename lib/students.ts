import { getSupabase } from "./supabase";

export type StudentStatus = {
  phone: string;
  full_name: string | null;
  enrollment_status: string | null;
  current_step: string | null;
};

/** Build common phone variants for lookup (digits, +252, leading 0, etc.). */
export function phoneVariants(raw: string): string[] {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  const variants = new Set<string>();

  if (trimmed) variants.add(trimmed);
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.startsWith("252")) {
      variants.add(`+${digits}`);
      variants.add(`0${digits.slice(3)}`);
      variants.add(digits.slice(3));
    } else if (digits.startsWith("0") && digits.length >= 9) {
      variants.add(`252${digits.slice(1)}`);
      variants.add(`+252${digits.slice(1)}`);
    } else if (digits.length >= 8 && digits.length <= 10) {
      variants.add(`252${digits}`);
      variants.add(`+252${digits}`);
      variants.add(`0${digits}`);
    }
  }

  return [...variants];
}

export async function findStudentByPhone(
  rawPhone: string
): Promise<StudentStatus | null> {
  const supabase = getSupabase();
  const variants = phoneVariants(rawPhone);

  for (const phone of variants) {
    const { data, error } = await supabase
      .from("students")
      .select("phone, full_name, enrollment_status, current_step")
      .eq("phone", phone)
      .maybeSingle();

    if (error) {
      throw new Error(`students lookup failed: ${error.message}`);
    }
    if (data) return data as StudentStatus;
  }

  return null;
}
