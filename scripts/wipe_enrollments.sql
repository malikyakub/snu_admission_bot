-- ============================================================
-- Wipe / cripple all enrollment application data
-- Run in Supabase SQL Editor.
-- Does NOT delete student rows — clears enrollment fields only.
-- ============================================================

update public.students
set
  enrollment_status = 'in_progress',
  enrollment_step = 0,
  current_step = null,
  needs_human = false,

  full_name = null,
  mothers_name = null,
  mother_name = null,
  gender = null,
  date_of_birth = null,
  place_of_birth = null,
  national_id = null,
  nationality = null,
  region = null,
  address = null,

  school_name = null,
  school_country = null,
  school_region_city = null,
  certificate_type = null,
  exam_roll_number = null,
  certificate_number = null,

  study_campus = null,
  exam_location = null,

  faculty_choice_1 = null,
  faculty_choice_2 = null,
  faculty_choice_3 = null,

  guardian_name = null,
  guardian_mobile = null,
  guardian_relation = null,

  doc_photo_url = null,
  doc_id_url = null,
  doc_certificate_url = null,
  doc_payment_url = null,
  photo_url = null,
  payment_receipt_url = null;

-- Optional: delete every student row entirely (uncomment)
-- delete from public.students;

-- Optional: empty storage buckets (Dashboard → Storage → empty each):
--   enrollment-photos
--   enrollment-ids
--   enrollment-certificates
--   enrollment-payments
