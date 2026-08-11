-- Reset enrollment fields for continuity testing
-- Student: ad005329-8597-4986-9283-11b50960e0bb (Malik Yakub / +252 613673734)
-- Keeps identity basics; clears faculties + guardian + docs (resume around step 8)

update public.students
set
  -- sync legacy + app mother columns if needed
  mother_name = coalesce(nullif(trim(mother_name), ''), mothers_name),
  mothers_name = coalesce(nullif(trim(mothers_name), ''), mother_name),

  enrollment_status = 'in_progress',
  enrollment_step = 8,
  needs_human = false,
  current_step = null,

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
  payment_receipt_url = null
where id = 'ad005329-8597-4986-9283-11b50960e0bb';

-- Optional: wipe from school step instead (uncomment)
-- update public.students set
--   enrollment_status = 'in_progress',
--   enrollment_step = 6,
--   needs_human = false,
--   current_step = null,
--   school_name = null,
--   school_country = null,
--   school_region_city = null,
--   school_region = null,
--   school_city = null,
--   certificate_type = null,
--   exam_roll_number = null,
--   certificate_number = null,
--   secondary_exam_roll_number = null,
--   secondary_certificate_number = null,
--   faculty_choice_1 = null,
--   faculty_choice_2 = null,
--   faculty_choice_3 = null,
--   guardian_name = null,
--   guardian_mobile = null,
--   guardian_relation = null,
--   doc_photo_url = null,
--   doc_id_url = null,
--   doc_certificate_url = null,
--   doc_payment_url = null,
--   photo_url = null,
--   payment_receipt_url = null
-- where id = 'ad005329-8597-4986-9283-11b50960e0bb';
