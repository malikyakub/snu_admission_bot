/**
 * Canonical SNU undergraduate fee FACTS for prompt injection.
 * Full-programme totals are precomputed here so the model can present a plain
 * breakdown without doing (or showing) the arithmetic itself.
 */

/** Flat one-time / universal fees. */
export const FEE_EXAM = 30;
export const FEE_ADMIN_REGISTRATION = 50;
export const FEE_EAP = 350;
export const FEE_ID_RENEWAL = 10;
export const FOUNDATION_EXTRA_SEMESTERS = 2;

/**
 * Per-semester service fee by faculty (from the official Administrative Charges table).
 * These amounts are paid EVERY semester — they are NOT one-time admin charges.
 */
export const FACULTY_SEMESTER_RATE: Record<string, number> = {
  "Agriculture and Environmental Science": 80,
  "Economic and Management Science": 80,
  Education: 50,
  Engineering: 125,
  "Health Sciences and Tropical Medicine": 100,
  Languages: 80,
  Law: 80,
  "Medicine and Surgery": 125,
  Science: 125,
  "Sharia and Islamic Studies": 50,
  "Social Science": 80,
  "Veterinary Medicine and Animal Husbandry": 80,
};

/**
 * Original degree length in years (before the mandatory Foundation year).
 * Semesters before foundation = years × 2.
 */
export const FACULTY_ORIGINAL_YEARS: Record<string, number> = {
  "Agriculture and Environmental Science": 4,
  "Economic and Management Science": 4,
  Education: 4,
  Engineering: 4,
  "Health Sciences and Tropical Medicine": 4,
  Languages: 4,
  Law: 4,
  "Medicine and Surgery": 6,
  Science: 4,
  "Sharia and Islamic Studies": 4,
  "Social Science": 4,
  "Veterinary Medicine and Animal Husbandry": 5,
};

/** Detect faculties named in free text (for multi-faculty comparisons). */
export function facultiesMentionedInText(text: string): string[] {
  const t = text.normalize("NFKC");
  const found: string[] = [];
  for (const name of Object.keys(FACULTY_SEMESTER_RATE)) {
    const re = new RegExp(
      name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"),
      "i"
    );
    if (re.test(t)) found.push(name);
  }
  if (/\bmedicine\b/i.test(t) && !found.includes("Medicine and Surgery")) {
    found.push("Medicine and Surgery");
  }
  if (
    /\b(vet|veterinary)\b/i.test(t) &&
    !found.includes("Veterinary Medicine and Animal Husbandry")
  ) {
    found.push("Veterinary Medicine and Animal Husbandry");
  }
  if (/\bscience\b/i.test(t) && !/\bsocial\s+science\b/i.test(t)) {
    if (!found.includes("Science")) found.push("Science");
  }
  if (
    /\beconomic/i.test(t) &&
    !found.includes("Economic and Management Science")
  ) {
    found.push("Economic and Management Science");
  }
  if (/\beducation\b/i.test(t) && !found.includes("Education")) {
    found.push("Education");
  }
  return found;
}

/**
 * Fee facts for the LLM, with a precomputed breakdown per faculty.
 * When `faculties` is null/empty, include the full per-semester rate table.
 */
export function formatFeeFactsBlock(
  faculties?: string[] | null,
  opts?: { annualFee?: boolean }
): string {
  const focus =
    faculties && faculties.length > 0
      ? faculties.filter((f) => FACULTY_SEMESTER_RATE[f] != null)
      : Object.keys(FACULTY_SEMESTER_RATE);

  // Precomputed per-faculty breakdowns so the model never has to show formulas
  const facultyLines = focus.map((f) => {
    const rate = FACULTY_SEMESTER_RATE[f];
    const years = FACULTY_ORIGINAL_YEARS[f];
    const totalSem = years * 2 + FOUNDATION_EXTRA_SEMESTERS;
    const renewals = Math.floor(totalSem / 4);
    const semesterTotal = rate * totalSem;
    const total = expectedFullProgramTotal(f);
    return (
      `- ${f}: $${rate} per semester ($${rate * 2} per year). Degree is ${years} years, plus the 1-year Foundation = ${years + 1} years (${totalSem} semesters) in total.\n` +
      `  Full-programme breakdown: exam $${FEE_EXAM} + registration $${FEE_ADMIN_REGISTRATION} + Foundation/EAP $${FEE_EAP} + semester fees $${semesterTotal.toLocaleString("en-US")} ($${rate} × ${totalSem} semesters) + ID renewals $${FEE_ID_RENEWAL * renewals} (${renewals} × $${FEE_ID_RENEWAL}) = $${total?.toLocaleString("en-US")}`
    );
  });

  const annualHint = opts?.annualFee
    ? `\nThe student asked about yearly cost: use the faculty's per-year figure above (2 semesters). Do NOT assume $125/semester for every faculty.`
    : "";

  return (
    `FEE_FACTS (authoritative; prefer these over older fee passages):\n` +
    `One-time fees (all faculties):\n` +
    `- Exam fee: $${FEE_EXAM}, paid before the admission exam\n` +
    `- Registration charge: $${FEE_ADMIN_REGISTRATION}, paid once after passing the exam\n` +
    `- Foundation/EAP programme: $${FEE_EAP}, paid once (the 1-year Foundation is mandatory for every faculty)\n` +
    `- Student ID renewal: $${FEE_ID_RENEWAL} every 2 years of study (Foundation year included)\n` +
    `Per-semester service fee (differs by faculty, paid every semester including the Foundation semesters):\n` +
    `${facultyLines.join("\n")}` +
    annualHint
  );
}

/**
 * Full-programme total for a faculty (also used for the FEE_FACTS breakdown).
 */
export function expectedFullProgramTotal(faculty: string): number | null {
  const rate = FACULTY_SEMESTER_RATE[faculty];
  const years = FACULTY_ORIGINAL_YEARS[faculty];
  if (rate == null || years == null) return null;
  const totalSemesters = years * 2 + FOUNDATION_EXTRA_SEMESTERS;
  const renewals = Math.floor(totalSemesters / 4);
  return (
    FEE_EXAM +
    FEE_ADMIN_REGISTRATION +
    FEE_EAP +
    rate * totalSemesters +
    FEE_ID_RENEWAL * renewals
  );
}
