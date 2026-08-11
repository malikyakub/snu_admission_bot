/** Keyword intent detection for optional topic/faculty retrieval filters. */

type TopicEntry = { topic: string; patterns: RegExp[]; weight?: number };
type FacultyEntry = { faculty: string; patterns: RegExp[]; weight?: number };

/**
 * More-specific topics first / higher weight wins.
 * `placement_results` outranks bare `placement` under admission_exam.
 */
const TOPICS: TopicEntry[] = [
  {
    topic: "placement_results",
    weight: 4,
    patterns: [
      /\bplacement\s+results?\b/i,
      /\bplacement\s+scor(?:e|ing|es)?\b/i,
      /\bscor(?:e|ing)\b.*\bplacement\b/i,
      /\bplacement\b.*\bscor(?:e|ing|es)?\b/i,
      /\baccepted\b/i,
      /\bafter (i |you )?pass(ing|ed)?\b/i,
      /\bonce (i |you )?pass(ing|ed)?\b/i,
      /\bwhat happens (next|after)\b/i,
      /\bhappens after\b/i,
      /\bafter the (admission )?exam\b/i,
      /\bpassed the (admission )?exam\b/i,
      /\bwelcoming (event|party)\b/i,
      /\benrollment fee\b/i,
      /\bfirst semester service fee\b/i,
    ],
  },
  {
    topic: "faculty_tiers",
    weight: 3,
    patterns: [/\btier\b/i, /\bcompetition\b/i, /\bcut[- ]?off\b/i],
  },
  {
    topic: "admission_exam",
    weight: 2,
    patterns: [
      /\bentrance exam\b/i,
      /\badmission exam\b/i,
      /\bexam date\b/i,
      /\bplacement\b/i,
    ],
  },
  {
    topic: "faculty_programs",
    weight: 2,
    patterns: [
      /\bprograms?\b/i,
      /\bdegrees?\b/i,
      /\bcourses?\b/i,
      /\bmajors?\b/i,
      /\boffer(?:s|ed)?\b/i,
    ],
  },
  {
    topic: "faculty_list",
    weight: 2,
    patterns: [
      /\bfaculties\b/i,
      /\blist of (facult|program)/i,
      /\bwhat faculties\b/i,
      /\bwhich faculties\b/i,
    ],
  },
  {
    topic: "fees",
    weight: 4,
    patterns: [
      /\bfees?\b/i,
      /\btuition\b/i,
      /\bcosts?\b/i,
      /\bcharges?\b/i,
      /\bpayment\b/i,
      /\bpay(?:s|ing|ment)?\b/i,
      /\bspend(?:s|ing)?\b/i,
      /\bexpenses?\b/i,
      /\bhow much\b/i,
      /\btotals?\b/i,
      /\bprice\b/i,
      /\bbudget\b/i,
      /\badministrative\b/i,
      /\$\d+/,
    ],
  },
  {
    topic: "admission_requirements",
    weight: 2,
    patterns: [
      /\brequirements?\b/i,
      /\beligib/i,
      /\bqualify\b/i,
      /\bdocuments?\b/i,
      /\btranscripts?\b/i,
    ],
  },
  {
    topic: "online_application",
    weight: 2,
    patterns: [
      /\bonline application\b/i,
      /\bapply online\b/i,
      /\bapplication form\b/i,
      /\buploads?\b/i,
      /\bportal\b/i,
    ],
  },
  {
    topic: "application_status",
    weight: 2,
    patterns: [
      /\bapplication status\b/i,
      /\bregistration (is |status|closed|open)/i,
      /\bintake\b/i,
    ],
  },
  {
    topic: "how_to_apply",
    weight: 2,
    patterns: [/\bhow (do i |to )?apply\b/i, /\bapplication process\b/i],
  },
  {
    topic: "academic_calendar",
    weight: 2,
    patterns: [
      /\bcalendar\b/i,
      /\bsemester\b/i,
      /\bdeadline\b/i,
      /\bschedule\b/i,
      /\bacademic year\b/i,
    ],
  },
  {
    topic: "mode_of_study",
    weight: 2,
    patterns: [
      /\bmode of study\b/i,
      /\bfull[- ]?time\b/i,
      /\bpart[- ]?time\b/i,
    ],
  },
  {
    topic: "university_identity",
    weight: 1,
    patterns: [
      /\baddress\b/i,
      /\bcampus(es)?\b/i,
      /\bcontact\b/i,
      /\bphone\b/i,
      /\bemail\b/i,
      /\babout (snu|the university)\b/i,
    ],
  },
];

/** Longer / more specific faculty names first so "Social Science" beats "Science". */
const FACULTIES: FacultyEntry[] = [
  {
    faculty: "Agriculture and Environmental Science",
    weight: 3,
    patterns: [
      /\bagriculture\b/i,
      /\benvironmental science\b/i,
      /\bfaculty of agriculture\b/i,
    ],
  },
  {
    faculty: "Economic and Management Science",
    weight: 3,
    patterns: [
      /\beconomic(?:s)? and management\b/i,
      /\bmanagement science\b/i,
      /\bfaculty of economic\b/i,
      /\beconomic(?:s)?\s+stud(?:y|ies)\b/i,
      /\beconomic(?:s)?\b/i,
      /\bbusiness\b/i,
    ],
  },
  {
    faculty: "Health Sciences and Tropical Medicine",
    weight: 3,
    patterns: [
      /\bhealth sciences?\b/i,
      /\btropical medicine\b/i,
    ],
  },
  {
    faculty: "Veterinary Medicine and Animal Husbandry",
    weight: 3,
    patterns: [/\bveterinary\b/i, /\banimal husbandry\b/i],
  },
  {
    faculty: "Sharia and Islamic Studies",
    weight: 3,
    patterns: [/\bsharia\b/i, /\bislamic studies\b/i],
  },
  {
    faculty: "Medicine and Surgery",
    weight: 3,
    patterns: [
      /\bmedicine and surgery\b/i,
      /\bfaculty of medicine\b/i,
      /\bmedical school\b/i,
    ],
  },
  {
    faculty: "Social Science",
    weight: 3,
    patterns: [/\bsocial science\b/i, /\bfaculty of social\b/i],
  },
  {
    faculty: "Education",
    weight: 2,
    patterns: [/\bfaculty of education\b/i, /\beducation\b/i, /\bteaching\b/i],
  },
  {
    faculty: "Engineering",
    weight: 2,
    patterns: [/\bengineering\b/i, /\bengineer\b/i],
  },
  {
    faculty: "Languages",
    weight: 2,
    patterns: [/\bfaculty of languages\b/i, /\blanguages?\b/i, /\blinguistics?\b/i],
  },
  {
    faculty: "Law",
    weight: 2,
    patterns: [/\bfaculty of law\b/i, /\blaw\b/i, /\blegal\b/i],
  },
  {
    faculty: "Science",
    weight: 2,
    patterns: [
      /\bfaculty\s+of\s+science\b/i,
      /\bscience\s+faculty\b/i,
      /\bscience\s+programs?\b/i,
      /\bprograms?\s+(?:in|for|of)\s+science\b/i,
      /\bstudy\s+science\b/i,
    ],
  },
];

export type ChatIntent = {
  topic: string | null;
  faculty: string | null;
  /**
   * When true, retrieval should pull fees chunks (topic=fees) plus
   * faculty-specific chunks (e.g. program length / admin context) and merge them.
   */
  combineFeesAndFaculty: boolean;
  /**
   * When true, merge placement_results + admission_exam (post-exam next steps).
   */
  combineExamAndPlacement: boolean;
};

/** Explicit cost/fee language — used to override competing topic matches. */
const FEE_COST_SIGNALS: RegExp[] = [
  /\bfees?\b/i,
  /\btuition\b/i,
  /\bcosts?\b/i,
  /\bcharges?\b/i,
  /\bpayment\b/i,
  /\bpay(?:s|ing|ment)?\b/i,
  /\bspend(?:s|ing)?\b/i,
  /\bexpenses?\b/i,
  /\bhow much\b/i,
  /\btotals?\b/i,
  /\bprice\b/i,
  /\bbudget\b/i,
  /\$\d+/,
];

/** Post-exam / next-steps language → placement_results (not exam content). */
const POST_EXAM_SIGNALS: RegExp[] = [
  /\bafter (i |you )?pass(ing|ed)?\b/i,
  /\bonce (i |you )?pass(ing|ed)?\b/i,
  /\bwhat happens (next|after)\b/i,
  /\bhappens after\b/i,
  /\bafter the (admission )?exam\b/i,
  /\bpassed the (admission )?exam\b/i,
  /\bwelcoming (event|party)\b/i,
];

function hasFeeCostSignal(text: string): boolean {
  return FEE_COST_SIGNALS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

function hasPostExamSignal(text: string): boolean {
  return POST_EXAM_SIGNALS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

/** Normalize punctuation / unicode spaces so keyword regexes can match. */
function normalizeMessage(message: string): string {
  return message
    .normalize("NFKC")
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function bestMatch<T extends string>(
  text: string,
  entries: { key: T; patterns: RegExp[]; weight: number }[]
): T | null {
  let best: T | null = null;
  let bestScore = 0;

  for (const entry of entries) {
    let hits = 0;
    for (const pattern of entry.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) hits += 1;
    }
    if (hits === 0) continue;
    const score = hits * entry.weight;
    if (score > bestScore) {
      bestScore = score;
      best = entry.key;
    }
  }

  return best;
}

export function detectIntent(message: string): ChatIntent {
  const text = normalizeMessage(message);
  if (!text) {
    return {
      topic: null,
      faculty: null,
      combineFeesAndFaculty: false,
      combineExamAndPlacement: false,
    };
  }

  let topic = bestMatch(
    text,
    TOPICS.map((t) => ({
      key: t.topic,
      patterns: t.patterns,
      weight: t.weight ?? 1,
    }))
  );

  const faculty = bestMatch(
    text,
    FACULTIES.map((f) => ({
      key: f.faculty,
      patterns: f.patterns,
      weight: f.weight ?? 1,
    }))
  );

  // Cost/fee language always wins over program/list topics when both fire
  // (e.g. "How much … for the Medicine and Surgery program?").
  if (
    hasFeeCostSignal(text) &&
    (topic === "faculty_programs" ||
      topic === "faculty_list" ||
      topic === null)
  ) {
    topic = "fees";
  }

  // "What happens after I pass the admission exam?" is post-exam flow,
  // not exam-subject content — prefer placement_results.
  const postExam = hasPostExamSignal(text);
  if (postExam && (topic === "admission_exam" || topic === null)) {
    topic = "placement_results";
  }

  const combineFeesAndFaculty = topic === "fees" && faculty !== null;
  const combineExamAndPlacement =
    postExam ||
    (topic === "placement_results" &&
      /\b(admission )?exam\b/i.test(text) &&
      /\b(pass|after|next|happen)/i.test(text));

  return { topic, faculty, combineFeesAndFaculty, combineExamAndPlacement };
}
