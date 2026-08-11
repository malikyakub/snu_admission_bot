/**
 * Updates fee chunk text in Supabase WITHOUT re-embedding.
 * The existing embedding is close enough for retrieval (same topic/faculty).
 * Run:  node scripts/update_fees_text_only.js
 */

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const NEW_CANONICAL_FEES =
  "SNU undergraduate fee breakdown — use ONLY these three fee items, no others:\n" +
  "1. Registration & ID Card Fee: $50 (one-time, applies to all faculties)\n" +
  "2. Foundation Programme (EAP, 5 levels): $350 (one-time, all students)\n" +
  "3. Faculty administrative charge (one-time): Agriculture & Environmental Science $80, " +
  "Economic & Management Science $80, Education $50, Engineering $125, " +
  "Health Sciences & Tropical Medicine $100, Languages $80, Law $80, " +
  "Medicine & Surgery $125, Science $125, Sharia & Islamic Studies $50, " +
  "Social Science $80, Veterinary Medicine & Animal Husbandry $80\n" +
  "Tuition is FREE for all undergraduate programmes.\n" +
  "Pre-calculated one-time totals (Registration + Foundation + admin charge):\n" +
  "Agriculture & Environmental Science $480 | Economic & Management Science $480 | " +
  "Education $450 | Engineering $525 | Health Sciences & Tropical Medicine $500 | " +
  "Languages $480 | Law $480 | Medicine & Surgery $525 | Science $525 | " +
  "Sharia & Islamic Studies $450 | Social Science $480 | " +
  "Veterinary Medicine & Animal Husbandry $480\n" +
  "CRITICAL: Never add any fee item not listed above. " +
  "Do NOT mention $55, $30, $20, $1,000, or any other figure. " +
  "The total for Science (including Computer Science) is $525.";

async function main() {
  // Fetch all fees rows
  const { data: rows, error } = await supabase
    .from("kb_chunks")
    .select("id, content")
    .eq("topic", "fees");

  if (error) { console.error("Fetch error:", error.message); process.exit(1); }

  console.log(`Found ${rows.length} fees rows in Supabase:`);
  rows.forEach((r) => console.log(`  ${r.id}: ${r.content.slice(0, 80)}`));

  // Find the conflict/disambiguation row
  const conflictRow = rows.find(
    (r) => r.content.includes("known conflict") || r.content.includes("$55")
  );

  if (!conflictRow) {
    console.log(
      "\nNo conflict row found — may already be updated or has different content. Checking for old canonical..."
    );
    // Try to find by partial match
    const oldRow = rows.find((r) => r.content.includes("conflict") || r.content.includes("55"));
    if (!oldRow) {
      console.log("No matching row to update. Listing all fee row IDs for manual inspection.");
      return;
    }
  }

  const targetId = conflictRow?.id ?? rows[rows.length - 1]?.id;
  console.log(`\nUpdating row ${targetId} with canonical fee breakdown...`);

  const { error: updateErr } = await supabase
    .from("kb_chunks")
    .update({ content: NEW_CANONICAL_FEES })
    .eq("id", targetId);

  if (updateErr) {
    console.error("Update error:", updateErr.message);
    process.exit(1);
  }

  console.log("Done — row updated.");
}

main().catch((e) => { console.error(e); process.exit(1); });
