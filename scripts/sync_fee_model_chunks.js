/**
 * Force-overwrite all topic=fees rows with the confirmed fee model.
 * Run: node scripts/sync_fee_model_chunks.js
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CHUNKS = [
  {
    match: /exam fee|\$30 exam|sit the SNU admission exam/i,
    content:
      "To sit the SNU admission exam, applicants first pay a $30 exam fee upfront. This applies to all applicants regardless of faculty. This fee is separate from and paid before any other admission charges. Only after passing the exam do applicants pay the remaining one-time admission charges.",
  },
  {
    match: /FLAT \$50|true one-time administrative|flat \$50 admin\/registration/i,
    content:
      "The true one-time admin/registration charge at SNU is a flat $50 for every faculty, paid once after passing the admission exam. This is separate from the faculty-specific per-semester service fee in the Administrative Charges table.",
  },
  {
    match: /Administrative Charges table lists|PER-SEMESTER SERVICE FEE|per-semester service fee that varies/i,
    content:
      "SNU's official Administrative Charges table lists faculty-specific figures: Agriculture & Environmental Science $80, Economic & Management Science $80, Education $50, Engineering $125, Health Sciences & Tropical Medicine $100, Languages $80, Law $80, Medicine & Surgery $125, Science $125, Sharia & Islamic Studies $50, Social Science $80, Veterinary Medicine & Animal Husbandry $80. These figures are the ONGOING PER-SEMESTER SERVICE FEE for that faculty — not a one-time administrative charge. Tuition is free; this semester fee is paid every semester until graduation (including Foundation semesters).",
  },
  {
    match: /Foundation Programme|compulsory ONE-YEAR Foundation|\$350 Foundation/i,
    content:
      "After passing the SNU admission exam, admitted students pay a one-time flat $50 admin/registration charge. All undergraduates must also complete a compulsory ONE-YEAR Foundation Programme (Ministry of Education policy since 2023/2024), including EAP, for $350 one-time. That Foundation year adds 2 EXTRA SEMESTERS charged at the same faculty's per-semester rate.",
  },
  {
    match: /renew their student ID|ID card renewal|\$10 fee/i,
    content:
      "SNU students must renew their student ID card every 2 years of total enrollment (including the Foundation year) for a $10 fee. This is separate from the one-time $50 admin/registration charge paid after passing.",
  },
  {
    match: /estimate total cost|total = \$30 \(exam fee\)/i,
    content:
      "To estimate total cost for any SNU undergraduate programme: total = $30 (exam fee) + $50 (flat admin/registration charge) + $350 (Foundation/EAP programme) + [faculty's per-semester rate x (original semester count + 2 foundation-year semesters)] + [$10 x floor(totalSemesters/4) ID renewals across total enrollment including the foundation year]. Original lengths before Foundation: most faculties 4 years (8 semesters); Veterinary Medicine & Animal Husbandry 5 years (10 semesters); Medicine & Surgery 6 years (12 semesters). Per-semester rates: Education $50, Sharia & Islamic Studies $50, Agriculture & Environmental Science $80, Economic & Management Science $80, Languages $80, Law $80, Social Science $80, Veterinary Medicine & Animal Husbandry $80, Health Sciences & Tropical Medicine $100, Engineering $125, Medicine & Surgery $125, Science $125. Always add Foundation's 2 extra semesters at the faculty's own rate — never use a flat $125/semester for every faculty.",
  },
  {
    match: /Worked example fee totals/i,
    content:
      "Worked example fee totals (including the mandatory foundation year): Education (10 total semesters at $50/semester): $30 + $50 + $350 + $500 + $20 (2 renewals) = $950. Science (10 total semesters at $125/semester): $30 + $50 + $350 + $1,250 + $20 (2 renewals) = $1,700. Medicine & Surgery (14 total semesters at $125/semester): $30 + $50 + $350 + $1,750 + $30 (3 renewals) = $2,210. Use the same calculation method for any other faculty by substituting its own per-semester rate and program length.",
  },
];

const TIER_CONTENT =
  "Choosing a Tier 1 faculty at SNU does not change the fee structure rules: students still pay the exam fee, $50 admin/registration, $350 EAP, ID renewals, and their faculty's own per-semester service fee every semester (including Foundation). Tier choice does not make all faculties charge the same per-semester rate.";

(async () => {
  const { data: fees, error } = await sb
    .from("kb_chunks")
    .select("id, content")
    .eq("topic", "fees");
  if (error) throw new Error(error.message);
  console.log(`Found ${fees.length} fees rows`);

  for (const row of fees) {
    const patch = CHUNKS.find((c) => c.match.test(row.content || ""));
    if (!patch) {
      console.log("skip", row.id, (row.content || "").slice(0, 70).replace(/\s+/g, " "));
      continue;
    }
    const { error: upErr } = await sb
      .from("kb_chunks")
      .update({
        content: patch.content,
        last_checked: "2026-08-12",
        confidence: "confirmed",
      })
      .eq("id", row.id);
    if (upErr) console.error("update failed", row.id, upErr.message);
    else console.log("updated", row.id);
  }

  const { data: tierRows } = await sb
    .from("kb_chunks")
    .select("id, content")
    .ilike("content", "%Tier 1 faculty%");
  for (const row of tierRows || []) {
    const { error: upErr } = await sb
      .from("kb_chunks")
      .update({ content: TIER_CONTENT, last_checked: "2026-08-12" })
      .eq("id", row.id);
    if (upErr) console.error("tier update failed", upErr.message);
    else console.log("updated tier", row.id);
  }

  console.log("Done.");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
