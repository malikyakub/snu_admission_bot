/**
 * Canonical SNU undergraduate fee FACTS for prompt injection.
 * The LLM calculates totals step-by-step from these components — we do not
 * inject precomputed full-programme totals.
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
 * Raw fee-component facts for the LLM. No precomputed totals.
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

  const rateLines = focus.map((f) => {
    const rate = FACULTY_SEMESTER_RATE[f];
    const years = FACULTY_ORIGINAL_YEARS[f];
    const origSem = years * 2;
    const totalSem = origSem + FOUNDATION_EXTRA_SEMESTERS;
    return `- **${f}**: $${rate}/semester | original degree ${years} years (${origSem} semesters) → with Foundation: ${totalSem} semesters (${years + 1} years total enrollment)`;
  });

  const annualHint = opts?.annualFee
    ? `\nYearly/annual recurring cost for a faculty = 2 × that faculty's per-semester rate (tuition is free). Do NOT assume $125/semester or $250/year for every faculty.`
    : "";

  return (
    `FEE_FACTS (authoritative components — calculate totals yourself step-by-step; show the arithmetic; do NOT invent other fee items):\n` +
    `One-time / universal:\n` +
    `- Exam fee: $${FEE_EXAM} (paid before the exam, all faculties)\n` +
    `- Admin/registration charge: $${FEE_ADMIN_REGISTRATION} (one-time, after passing, all faculties — NOT the per-semester table)\n` +
    `- Foundation/EAP programme: $${FEE_EAP} (one-time; mandatory 1-year Foundation since 2023/2024, all faculties)\n` +
    `- ID card renewal: $${FEE_ID_RENEWAL} every 2 years of total enrollment (including the Foundation year)\n` +
    `Per-semester service fee (varies by faculty — paid every semester, including Foundation semesters):\n` +
    `${rateLines.join("\n")}\n` +
    `How to compute a full-programme total:\n` +
    `1. totalSemesters = originalSemesters + ${FOUNDATION_EXTRA_SEMESTERS} (Foundation year)\n` +
    `2. renewals = floor(totalSemesters / 4)  // one $10 renewal per 2 years\n` +
    `3. total = $${FEE_EXAM} + $${FEE_ADMIN_REGISTRATION} + $${FEE_EAP} + (facultySemesterRate × totalSemesters) + ($${FEE_ID_RENEWAL} × renewals)\n` +
    `Tuition is FREE. Never treat the Administrative Charges table as a one-time admin fee. Never use a flat $125/semester for every faculty.` +
    annualHint
  );
}

/**
 * Reference helper for tests only — mirrors the step-by-step formula the model should use.
 * Not injected into prompts.
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
