/**
 * Updates the two fees chunks in Supabase kb_chunks table:
 *   1. The main administrative charges chunk (keeps content, re-embeds)
 *   2. The conflict/disambiguation chunk -> replaced with canonical fee breakdown
 *
 * Run:  node scripts/update_fees_chunks.js
 * Requires:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLOUDFLARE_ACCOUNT_ID,
 *            CLOUDFLARE_API_TOKEN in .env  (Node 22.18+ / 23.6+ for .ts require)
 */

require("dotenv").config({ path: ".env" });

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
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
  const chunks = JSON.parse(fs.readFileSync("kb_chunks.json", "utf8"));
  const feesChunks = chunks.filter((c) => c.topic === "fees");

  console.log(`Found ${feesChunks.length} fees chunks in kb_chunks.json`);

  for (const chunk of feesChunks) {
    console.log(`\nEmbedding chunk (${chunk.content.slice(0, 60)}...)`);
    const embedding = await embedDocument(chunk.content);
    console.log(`  Embedding length: ${embedding.length}`);

    // Find existing row by content match (first 100 chars) or topic+confidence
    const { data: existing } = await supabase
      .from("kb_chunks")
      .select("id")
      .eq("topic", "fees")
      .ilike("content", chunk.content.slice(0, 80) + "%")
      .limit(1);

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from("kb_chunks")
        .update({ content: chunk.content, embedding })
        .eq("id", existing[0].id);
      if (error) console.error("  Update error:", error.message);
      else console.log(`  Updated row ${existing[0].id}`);
    } else {
      // No match by content prefix — fetch all fees rows and match by index order
      console.log(
        "  No content match found — will list all fees rows for manual check"
      );
      const { data: allFees } = await supabase
        .from("kb_chunks")
        .select("id, content")
        .eq("topic", "fees");
      console.log("  Existing fees rows in Supabase:");
      (allFees || []).forEach((r) =>
        console.log(`    ${r.id}: ${r.content.slice(0, 80)}`)
      );
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
