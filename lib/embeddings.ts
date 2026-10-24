const OLLAMA_MODEL = process.env.OLLAMA_EMBED_MODEL || "bge-base-en-v1.5";
const CF_MODEL = "@cf/baai/bge-base-en-v1.5";
const EMBEDDING_DIMS = 768;

/** BGE retrieval query prefix (documents are embedded without this). */
const BGE_QUERY_PREFIX =
  "Represent this sentence for searching relevant passages: ";

/**
 * Query embedding for RAG — always `BAAI/bge-base-en-v1.5` (768-dim).
 *
 * Default path is Cloudflare Workers AI (`@cf/baai/bge-base-en-v1.5`) for both
 * local and Vercel. Needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
 * (token with the "Workers AI" read permission).
 *
 * Optional: `EMBEDDING_PROVIDER=ollama` if you have a local community port
 * under `OLLAMA_EMBED_MODEL` — not recommended (may diverge from these weights).
 */
export async function embedQuery(text: string): Promise<number[]> {
  const provider = (process.env.EMBEDDING_PROVIDER || "cloudflare").toLowerCase();
  const ollamaUrl = process.env.OLLAMA_URL;
  const queryText = `${BGE_QUERY_PREFIX}${text}`;

  if (provider === "ollama" && ollamaUrl) {
    return embedWithOllama(queryText, ollamaUrl);
  }

  return embedWithCloudflare(queryText);
}

/** Document embedding (no BGE query prefix) — used by ingest. */
export async function embedDocument(text: string): Promise<number[]> {
  return embedWithCloudflare(text);
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

type CloudflareAiResponse = {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { shape?: number[]; data?: number[][] };
};

async function embedWithCloudflare(text: string): Promise<number[]> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const missing = [
    !accountId && "CLOUDFLARE_ACCOUNT_ID",
    !token && "CLOUDFLARE_API_TOKEN",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `${missing.join(" and ")} not set. Embedding uses Cloudflare Workers AI ${CF_MODEL}.`
    );
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_MODEL}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // CLS pooling matches the sentence-transformers config for this model,
    // which is what the existing kb_chunks vectors were embedded with.
    // Workers AI defaults to mean pooling, which is not compatible.
    body: JSON.stringify({ text: [text], pooling: "cls" }),
  });

  const raw = await res.text();
  let data: CloudflareAiResponse | undefined;
  try {
    data = JSON.parse(raw) as CloudflareAiResponse;
  } catch {
    data = undefined;
  }

  if (!res.ok || !data?.success) {
    const detail =
      data?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") || raw;
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Cloudflare Workers AI embedding unauthorized (${res.status}). Check that ` +
          `CLOUDFLARE_API_TOKEN has the "Workers AI" permission and ` +
          `CLOUDFLARE_ACCOUNT_ID is correct. Details: ${detail}`
      );
    }
    throw new Error(
      `Cloudflare Workers AI embedding failed (${res.status}): ${detail}`
    );
  }

  const embedding = data.result?.data?.[0];
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Cloudflare Workers AI returned an empty embedding");
  }
  if (embedding.length !== EMBEDDING_DIMS) {
    throw new Error(
      `Cloudflare Workers AI returned a ${embedding.length}-dim embedding; ` +
        `expected ${EMBEDDING_DIMS} (kb_chunks is vector(${EMBEDDING_DIMS}))`
    );
  }

  return embedding;
}
