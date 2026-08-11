const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || "bge-base-en-v1.5";
const HF_MODEL = process.env.HF_EMBED_MODEL || "BAAI/bge-base-en-v1.5";

/** BGE retrieval query prefix (documents are embedded without this). */
const BGE_QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

/**
 * Query embedding for RAG — always `BAAI/bge-base-en-v1.5` (768-dim).
 *
 * Ollama does **not** officially host `bge-base-en-v1.5`, so the default path
 * is Hugging Face Inference (`HF_API_TOKEN`) for both local and Vercel.
 * That keeps ingest + query in the same vector space.
 *
 * Optional: `EMBEDDING_PROVIDER=ollama` if you have a local community port
 * under `OLLAMA_EMBED_MODEL` — not recommended (may diverge from HF weights).
 *
 * HF token needs **Make calls to Inference Providers**:
 * https://huggingface.co/settings/tokens
 */
export async function embedQuery(text: string): Promise<number[]> {
  const provider = (process.env.EMBEDDING_PROVIDER || "hf").toLowerCase();
  const ollamaUrl = process.env.OLLAMA_URL;
  const hfToken = process.env.HF_API_TOKEN;
  const queryText = `${BGE_QUERY_PREFIX}${text}`;

  if (provider === "ollama" && ollamaUrl) {
    return embedWithOllama(queryText, ollamaUrl);
  }

  if (hfToken) {
    return embedWithHuggingFace(queryText, hfToken);
  }

  throw new Error(
    "HF_API_TOKEN is not set. Embedding uses Hugging Face BAAI/bge-base-en-v1.5 " +
      "(Ollama does not host this model)."
  );
}

/** Document embedding (no BGE query prefix) — used by ingest. */
export async function embedDocument(text: string): Promise<number[]> {
  const hfToken = process.env.HF_API_TOKEN;
  if (!hfToken) {
    throw new Error("HF_API_TOKEN is not set");
  }
  return embedWithHuggingFace(text, hfToken);
}

async function embedWithOllama(
  text: string,
  baseUrl: string
): Promise<number[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: text }),
  });

  if (!res.ok) {
    throw new Error(
      `Ollama embedding failed (${res.status}): ${await res.text()}`
    );
  }

  const data = (await res.json()) as { embedding?: number[] };
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("Ollama returned an empty embedding");
  }

  return data.embedding;
}

async function embedWithHuggingFace(
  text: string,
  token: string
): Promise<number[]> {
  const url = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}/pipeline/feature-extraction`;

  const res = await fetch(url, {
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
        `Hugging Face embedding forbidden (403). Create a fine-grained token with ` +
          `"Make calls to Inference Providers" and set HF_API_TOKEN. Details: ${detail}`
      );
    }
    throw new Error(`Hugging Face embedding failed (${res.status}): ${detail}`);
  }

  const data: unknown = await res.json();
  const embedding = normalizeHfEmbedding(data);

  if (embedding.length === 0) {
    throw new Error("Hugging Face returned an empty embedding");
  }

  return embedding;
}

/** Flatten HF feature-extraction payloads into a single 768-d vector. */
function normalizeHfEmbedding(data: unknown): number[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Unexpected Hugging Face embedding response shape");
  }

  if (typeof data[0] === "number") {
    return data as number[];
  }

  if (Array.isArray(data[0]) && typeof (data[0] as unknown[])[0] === "number") {
    return meanPool(data as number[][]);
  }

  if (
    Array.isArray(data[0]) &&
    Array.isArray((data[0] as unknown[])[0]) &&
    typeof ((data[0] as unknown[])[0] as unknown[])[0] === "number"
  ) {
    return meanPool((data as number[][][])[0]);
  }

  throw new Error("Unexpected Hugging Face embedding response shape");
}

function meanPool(tokenVectors: number[][]): number[] {
  if (tokenVectors.length === 0) return [];
  const dims = tokenVectors[0].length;
  const out = new Array<number>(dims).fill(0);
  for (const token of tokenVectors) {
    for (let i = 0; i < dims; i++) out[i] += token[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= tokenVectors.length;
  return out;
}
