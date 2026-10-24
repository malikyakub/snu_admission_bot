/**
 * Verify BGE embeddings (Cloudflare Workers AI) + retrieval.
 * Run: node scripts/verify-embeddings.js   (Node 22.18+ / 23.6+ for .ts require)
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { embedQuery, embedDocument } = require("../lib/embeddings.ts");

const HF_URL =
  "https://router.huggingface.co/hf-inference/models/BAAI/bge-base-en-v1.5/pipeline/feature-extraction";

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Optional: compare against the old Hugging Face vectors (what kb_chunks was
 * ingested with). Skipped when HF_API_TOKEN is not set.
 */
async function hfParity(text, cfVector) {
  if (!process.env.HF_API_TOKEN) return "skipped (HF_API_TOKEN not set)";
  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
  });
  if (!res.ok) return `skipped (HF ${res.status})`;
  const hf = await res.json();
  if (!Array.isArray(hf) || typeof hf[0] !== "number") {
    return "skipped (unexpected HF response shape)";
  }
  return `cosine(HF, Cloudflare) = ${cosine(hf, cfVector).toFixed(4)}`;
}

(async () => {
  console.log("=== Embedding verification (@cf/baai/bge-base-en-v1.5) ===\n");

  const docText = "SNU undergraduate registration and ID card fee";
  const doc = await embedDocument(docText);
  const query = await embedQuery("How much is the SNU registration fee?");
  console.log(`Document embed: dim=${doc.length}`);
  console.log(`Query embed:    dim=${query.length}`);
  if (doc.length !== 768 || query.length !== 768) {
    throw new Error("Expected 768-dim vectors");
  }
  console.log(`HF parity:      ${await hfParity(docText, doc)}`);

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { count } = await sb
    .from("kb_chunks")
    .select("*", { count: "exact", head: true });
  console.log(`kb_chunks rows: ${count}`);

  const { data, error } = await sb.rpc("match_kb_chunks", {
    query_embedding: query,
    match_count: 3,
    filter_topic: null,
    filter_faculty: null,
  });
  if (error) {
    console.error("match_kb_chunks RPC error:", error.message);
    console.error(
      "If missing/wrong signature, re-run supabase/schema.sql (id uuid)."
    );
    process.exit(1);
  }
  console.log("\nTop matches:");
  for (const row of data) {
    console.log(
      `- sim=${Number(row.similarity).toFixed(3)} topic=${row.topic} :: ${row.content.slice(0, 80)}...`
    );
  }
  console.log("\nOK: Cloudflare embeddings work; retrieval works.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
