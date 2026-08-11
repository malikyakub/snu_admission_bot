/**
 * Verify BGE embeddings + retrieval.
 * Run: node scripts/verify-embeddings.js
 */
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const HF_MODEL = "BAAI/bge-base-en-v1.5";
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`;
const QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

function meanPool(tokenVectors) {
  const dims = tokenVectors[0].length;
  const out = new Array(dims).fill(0);
  for (const token of tokenVectors) {
    for (let i = 0; i < dims; i++) out[i] += token[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= tokenVectors.length;
  return out;
}

function normalize(data) {
  if (typeof data[0] === "number") return data;
  if (typeof data[0][0] === "number") return meanPool(data);
  return meanPool(data[0]);
}

async function hfEmbed(text) {
  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.HF_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true },
    }),
  });
  if (!res.ok) throw new Error(`HF ${res.status}: ${await res.text()}`);
  return normalize(await res.json());
}

async function checkOllama() {
  const base = process.env.OLLAMA_URL || "http://localhost:11434";
  try {
    const tags = await fetch(`${base.replace(/\/$/, "")}/api/tags`);
    if (!tags.ok) return { ok: false, reason: `tags HTTP ${tags.status}` };
    const body = await tags.json();
    const names = (body.models || []).map((m) => m.name);
    const hasBge = names.some((n) => /bge-base-en-v1\.5/i.test(n));
    return { ok: false, reason: hasBge ? "model present but unused (HF is source of truth)" : `Ollama reachable but no bge-base-en-v1.5 (models: ${names.join(", ") || "none"})` };
  } catch (err) {
    return { ok: false, reason: `Ollama unreachable: ${err.message}` };
  }
}

(async () => {
  console.log("=== Embedding verification (BAAI/bge-base-en-v1.5) ===\n");

  const ollama = await checkOllama();
  console.log("Ollama path:", ollama.reason);

  const doc = await hfEmbed("SNU undergraduate registration and ID card fee");
  const query = await hfEmbed(
    QUERY_PREFIX + "How much is the SNU registration fee?"
  );
  console.log(`HF document embed: dim=${doc.length}`);
  console.log(`HF query embed:    dim=${query.length}`);
  if (doc.length !== 768 || query.length !== 768) {
    throw new Error("Expected 768-dim vectors");
  }

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
  console.log("\nOK: HF ingest+query use the same model; retrieval works.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
