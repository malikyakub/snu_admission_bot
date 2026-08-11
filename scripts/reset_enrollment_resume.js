/**
 * Clear later enrollment fields for a student so you can test
 * "continue enrollment" resume flow.
 *
 * Usage:
 *   node scripts/reset_enrollment_resume.js
 *   node scripts/reset_enrollment_resume.js ad005329-8597-4986-9283-11b50960e0bb
 *   node scripts/reset_enrollment_resume.js --phone "+252 613673734"
 *
 * Keeps identity basics (name, phone, DOB, etc.) and clears from
 * school / certificate / faculties / guardian / docs onward by default.
 * Pass --from=step to choose how much to wipe (1–11).
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
 */

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const STUDENT_ID_DEFAULT = "ad005329-8597-4986-9283-11b50960e0bb";

/** Fields cleared at/after each resume step (UI step numbers). */
const CLEAR_FROM_STEP = {
  1: [
    "full_name",
    "mothers_name",
    "mother_name",
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
    "school_region",
    "school_city",
    "certificate_type",
    "exam_roll_number",
    "certificate_number",
    "secondary_exam_roll_number",
    "secondary_certificate_number",
    "study_campus",
    "exam_location",
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
    "photo_url",
    "payment_receipt_url",
  ],
  6: [
    "school_name",
    "school_country",
    "school_region_city",
    "school_region",
    "school_city",
    "certificate_type",
    "exam_roll_number",
    "certificate_number",
    "secondary_exam_roll_number",
    "secondary_certificate_number",
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
    "photo_url",
    "payment_receipt_url",
  ],
  8: [
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
    "photo_url",
    "payment_receipt_url",
  ],
  10: [
    "guardian_name",
    "guardian_mobile",
    "guardian_relation",
    "doc_photo_url",
    "doc_id_url",
    "doc_certificate_url",
    "doc_payment_url",
    "photo_url",
    "payment_receipt_url",
  ],
  11: [
    "doc_photo_url",
    "doc_id_url",
    "doc_certificate_url",
    "doc_payment_url",
    "photo_url",
    "payment_receipt_url",
  ],
};

function parseArgs(argv) {
  let id = STUDENT_ID_DEFAULT;
  let phone = null;
  let fromStep = 8; // default: wipe faculties onward — good continuity test
  for (const a of argv) {
    if (a.startsWith("--phone=")) phone = a.slice("--phone=".length);
    else if (a.startsWith("--from=")) fromStep = Number(a.slice("--from=".length));
    else if (!a.startsWith("--")) id = a;
  }
  if (![1, 6, 8, 10, 11].includes(fromStep)) {
    console.error("Use --from=1|6|8|10|11");
    process.exit(1);
  }
  return { id, phone, fromStep };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const { id, phone, fromStep } = parseArgs(process.argv.slice(2));
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  let q = supabase.from("students").select("id, phone, full_name, mothers_name, mother_name, enrollment_status, enrollment_step");
  q = phone ? q.eq("phone", phone) : q.eq("id", id);
  const { data: before, error: loadErr } = await q.maybeSingle();
  if (loadErr) throw loadErr;
  if (!before) {
    console.error("Student not found");
    process.exit(1);
  }

  const clearFields = CLEAR_FROM_STEP[fromStep];
  const patch = {
    enrollment_status: "in_progress",
    enrollment_step: fromStep,
    needs_human: false,
    current_step: null,
  };
  for (const f of clearFields) patch[f] = null;

  // Keep phone + identity unless wiping from step 1
  if (fromStep > 1) {
    delete patch.full_name;
    // keep mothers_name unless step 1
  }

  const { data: after, error: updErr } = await supabase
    .from("students")
    .update(patch)
    .eq("id", before.id)
    .select("id, phone, full_name, mothers_name, mother_name, enrollment_status, enrollment_step, faculty_choice_1, guardian_name, doc_photo_url")
    .maybeSingle();

  if (updErr) throw updErr;

  console.log("Before:", {
    id: before.id,
    phone: before.phone,
    full_name: before.full_name,
    mothers_name: before.mothers_name,
    mother_name: before.mother_name,
    enrollment_status: before.enrollment_status,
    enrollment_step: before.enrollment_step,
  });
  console.log(`\nCleared from step ${fromStep}. After:`, after);
  console.log(
    "\nTest: ask the bot to check enrollment status with this phone, then click Continue."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
