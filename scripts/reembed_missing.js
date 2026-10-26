/**
 * Embeds every kb_chunks row whose embedding IS NULL, then prints the
 * remaining NULL count (should be 0).
 *
 * Run:  node scripts/reembed_missing.js
 * Requires:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID,
 *            CLOUDFLARE_API_TOKEN in .env  (Node 22.18+ / 23.6+ for .ts require)
 */

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");
const { embedDocument } = require("../lib/embeddings.ts");

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

async function main() {
  const { data: rows, error } = await supabase
    .from("kb_chunks")
    .select("id, topic, content")
    .is("embedding", null);
  if (error) throw new Error(error.message);

  console.log(`Rows with NULL embedding: ${rows.length}`);
  for (const row of rows) {
    const embedding = await embedDocument(row.content);
    const { error: upErr } = await supabase
      .from("kb_chunks")
      .update({ embedding })
      .eq("id", row.id);
    if (upErr) throw new Error(`${row.id}: ${upErr.message}`);
    console.log(`  embedded ${row.id} (${row.topic}, dim=${embedding.length})`);
  }

  const { count, error: countErr } = await supabase
    .from("kb_chunks")
    .select("id", { count: "exact", head: true })
    .is("embedding", null);
  if (countErr) throw new Error(countErr.message);
  console.log(`Remaining NULL embeddings: ${count}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
