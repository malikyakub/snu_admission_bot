import type { KbChunkMatch } from "./supabase";
import { HANDOFF_SIMILARITY_THRESHOLD } from "./handoff";

export type ChatSource = {
  url: string;
  /** Display name under the answer */
  label: string;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const padded = b64 + pad;
  if (typeof atob === "function") {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(padded, "base64"));
}

function utf8ToBytes(text: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text);
  }
  return new Uint8Array(Buffer.from(text, "utf8"));
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(bytes).toString("utf8");
}

/** Host + path for citations, e.g. snu.edu.so/admission/admission-requirements */
export function sourceLabelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path || ""}`;
  } catch {
    return "Source";
  }
}

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

const SOURCE_STOPWORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "also",
  "among",
  "because",
  "before",
  "being",
  "below",
  "between",
  "both",
  "could",
  "does",
  "each",
  "from",
  "have",
  "here",
  "into",
  "just",
  "like",
  "more",
  "most",
  "only",
  "other",
  "over",
  "same",
  "should",
  "some",
  "such",
  "than",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "very",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "with",
  "would",
  "your",
  "faculty",
  "program",
  "programme",
  "programs",
  "programmes",
  "student",
  "students",
  "university",
  "somali",
  "national",
  "admission",
  "admissions",
]);

function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  const normalized = text
    .toLowerCase()
    .replace(/\[\[cta:[^\]]+\]\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^a-z0-9$%]+/g, " ");
  for (const raw of normalized.split(/\s+/)) {
    if (!raw || raw.length < 4) continue;
    if (SOURCE_STOPWORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

function extractMarkers(text: string): Set<string> {
  const out = new Set<string>();
  const matches =
    text.match(/\$\d+(?:\.\d+)?|\b\d{4}\/\d{4}\b|\b\d{4}\b|\b\d+%/g) ?? [];
  for (const m of matches) out.add(m.toLowerCase());
  return out;
}

/**
 * True when distinctive content from the chunk appears in the answer.
 * Prevents citing an unrelated retrieved page the model never used.
 */
export function chunkReflectedInAnswer(
  chunkContent: string,
  answer: string
): boolean {
  const chunk = (chunkContent || "").trim();
  const ans = (answer || "").trim();
  if (!chunk || !ans) return false;

  const chunkToks = significantTokens(chunk);
  const answerToks = significantTokens(ans);
  if (chunkToks.size === 0 || answerToks.size === 0) return false;

  let overlap = 0;
  for (const t of chunkToks) {
    if (answerToks.has(t)) overlap += 1;
  }
  const coverage = overlap / chunkToks.size;

  const chunkMarkers = extractMarkers(chunk);
  let markerHits = 0;
  for (const m of chunkMarkers) {
    if (ans.toLowerCase().includes(m)) markerHits += 1;
  }

  // Strong lexical overlap, or medium overlap plus shared numbers/$ amounts
  if (overlap >= 8 && coverage >= 0.12) return true;
  if (overlap >= 5 && coverage >= 0.2) return true;
  if (markerHits >= 2 && overlap >= 4) return true;
  if (markerHits >= 3 && overlap >= 3) return true;
  return false;
}

/**
 * Keep only chunks close enough to the best match to be plausible context.
 * Drops weak semantic hitchhikers (e.g. unrelated faculty pages).
 */
export function pruneWeakChunks(
  chunks: KbChunkMatch[],
  options?: { maxGap?: number; minSimilarity?: number }
): KbChunkMatch[] {
  if (chunks.length === 0) return chunks;
  const maxGap = options?.maxGap ?? 0.06;
  const minSimilarity =
    options?.minSimilarity ?? Math.min(0.5, HANDOFF_SIMILARITY_THRESHOLD);
  const ranked = [...chunks].sort(
    (a, b) => (b.similarity ?? 0) - (a.similarity ?? 0)
  );
  const top = ranked[0]?.similarity ?? 0;
  const floor = Math.max(minSimilarity, top - maxGap);
  return ranked.filter((c) => (c.similarity ?? 0) >= floor);
}

/** Dedupe chunk source URLs for UI citations. Skips null/empty source_url. */
export function sourcesFromChunks(chunks: KbChunkMatch[]): ChatSource[] {
  const seen = new Set<string>();
  const out: ChatSource[] = [];
  for (const c of chunks) {
    const url = c.source_url?.trim();
    if (!url || !isHttpUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: sourceLabelFromUrl(url) });
  }
  return out;
}

/**
 * Cite only URLs whose chunk content is actually reflected in the answer.
 * Weak overall retrieval → no citations.
 */
export function sourcesUsedInAnswer(
  chunks: KbChunkMatch[],
  answer: string
): ChatSource[] {
  if (!chunks.length || !answer.trim()) return [];

  const topSim = Math.max(...chunks.map((c) => c.similarity ?? 0));
  // Don't cite when nothing was confidently retrieved
  if (topSim < HANDOFF_SIMILARITY_THRESHOLD) return [];

  const candidates = pruneWeakChunks(chunks).filter((c) => {
    const url = c.source_url?.trim();
    if (!url || !isHttpUrl(url)) return false;
    return chunkReflectedInAnswer(c.content, answer);
  });

  return sourcesFromChunks(candidates);
}

/** Normalize any sources-like payload into deduped clickable citations. */
export function normalizeChatSources(input: unknown): ChatSource[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ChatSource[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as { url?: unknown; source_url?: unknown; label?: unknown };
    const raw =
      (typeof row.url === "string" && row.url) ||
      (typeof row.source_url === "string" && row.source_url) ||
      "";
    const url = raw.trim();
    if (!url || !isHttpUrl(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const label =
      typeof row.label === "string" && row.label.trim()
        ? row.label.trim()
        : sourceLabelFromUrl(url);
    out.push({ url, label });
  }
  return out;
}

/** Encode for response header (ASCII-safe). Works on server and browser. */
export function encodeSourcesHeader(sources: ChatSource[]): string {
  return bytesToBase64Url(utf8ToBytes(JSON.stringify(sources)));
}

/** Decode sources header. Safe in the browser (no Node Buffer required). */
export function decodeSourcesHeader(raw: string | null): ChatSource[] {
  if (!raw) return [];
  try {
    const json = bytesToUtf8(base64UrlToBytes(raw));
    return normalizeChatSources(JSON.parse(json));
  } catch {
    return [];
  }
}
