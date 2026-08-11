// ingest.js
// Embeds kb_chunks.json with BAAI/bge-base-en-v1.5 via Hugging Face Inference
// and upserts into Supabase. Ollama does not officially host bge-base-en-v1.5,
// so ingestion uses the same HF model/provider as production query embeddings.
//
// Setup:
//   npm install @supabase/supabase-js dotenv
//
// .env:
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...
//   HF_API_TOKEN=...   (fine-grained token with Inference Providers permission)
//
// Run:
//   node ingest.js
//
// Optional flags:
//   node ingest.js --wipe   # delete all kb_chunks rows before insert

require("dotenv").config();
const fs = require("fs");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HF_MODEL = process.env.HF_EMBED_MODEL || "BAAI/bge-base-en-v1.5";
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`;
const EXPECTED_DIM = 768;
const WIPE = process.argv.includes("--wipe");

function meanPool(tokenVectors) {
  const dims = tokenVectors[0].length;
  const out = new Array(dims).fill(0);
  for (const token of tokenVectors) {
    for (let i = 0; i < dims; i++) out[i] += token[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= tokenVectors.length;
  return out;
}

function normalizeHfEmbedding(data) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Unexpected Hugging Face embedding response shape");
  }
  if (typeof data[0] === "number") return data;
  if (Array.isArray(data[0]) && typeof data[0][0] === "number") {
    return meanPool(data);
  }
  if (Array.isArray(data[0]) && Array.isArray(data[0][0]) && typeof data[0][0][0] === "number") {
    return meanPool(data[0]);
  }
  throw new Error("Unexpected Hugging Face embedding response shape");
}

async function embedDocument(text) {
  const token = process.env.HF_API_TOKEN;
  if (!token) {
    throw new Error(
      "HF_API_TOKEN is not set. Ingestion uses Hugging Face BAAI/bge-base-en-v1.5 " +
        "(Ollama does not host this model)."
    );
  }

  const res = await fetch(HF_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: text,
      options: { wait_for_model: true },
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403) {
      throw new Error(
        `HF 403 — token needs "Make calls to Inference Providers". ${detail}`
      );
    }
    throw new Error(`HF embedding failed (${res.status}): ${detail}`);
  }

  const embedding = normalizeHfEmbedding(await res.json());
  if (embedding.length !== EXPECTED_DIM) {
    throw new Error(
      `Expected ${EXPECTED_DIM}-dim embedding, got ${embedding.length}`
    );
  }
  return embedding;
}

async function wipeKbChunks() {
  console.log("Wiping kb_chunks...");
  // Delete all rows (service role). A filter is required by PostgREST.
  const { error, count } = await supabase
    .from("kb_chunks")
    .delete({ count: "exact" })
    .not("id", "is", null);

  if (error) {
    throw new Error(`Failed to wipe kb_chunks: ${error.message}`);
  }
  console.log(`Deleted ${count ?? "?"} existing row(s).`);
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const raw = fs.readFileSync("./kb_chunks.json", "utf-8");
  const chunks = JSON.parse(raw);

  console.log(
    `Model: ${HF_MODEL} via Hugging Face Inference\n` +
      `Loaded ${chunks.length} chunks.`
  );

  if (WIPE) {
    await wipeKbChunks();
  }

  console.log("Starting embedding + insertion...");

  let inserted = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await embedDocument(chunk.content);

      const { error } = await supabase.from("kb_chunks").insert({
        content: chunk.content,
        topic: chunk.topic,
        faculty: chunk.faculty,
        source_url: chunk.source_url,
        confidence: chunk.confidence,
        last_checked: chunk.last_checked,
        embedding,
      });

      if (error) {
        console.error(
          `Failed to insert chunk (topic=${chunk.topic}):`,
          error.message
        );
      } else {
        inserted++;
        console.log(
          `Inserted [${inserted}/${chunks.length}] topic=${chunk.topic} faculty=${chunk.faculty || "-"} dim=${embedding.length}`
        );
      }
    } catch (err) {
      console.error(
        `Error embedding chunk (topic=${chunk.topic}):`,
        err.message
      );
      // Abort on first embed failure so we don't leave a half-migrated KB.
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `\nDone. ${inserted}/${chunks.length} chunks inserted successfully with ${HF_MODEL}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
