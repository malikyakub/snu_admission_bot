import type { KbChunkMatch } from "./supabase";

export type ChatSource = {
  url: string;
  /** Display name on the badge */
  label: string;
};

/** Friendly site label for known SNU hosts; otherwise hostname. */
export function sourceLabelFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "snu.edu.so") return "snu.edu.so";
    if (host.endsWith(".snu.edu.so")) return host;
    return host;
  } catch {
    return "Source";
  }
}

/** Dedupe chunk source URLs for UI badges. */
export function sourcesFromChunks(chunks: KbChunkMatch[]): ChatSource[] {
  const seen = new Set<string>();
  const out: ChatSource[] = [];
  for (const c of chunks) {
    const url = c.source_url?.trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: sourceLabelFromUrl(url) });
  }
  return out;
}

/** Encode for response header (ASCII-safe). */
export function encodeSourcesHeader(sources: ChatSource[]): string {
  return Buffer.from(JSON.stringify(sources), "utf8").toString("base64url");
}

export function decodeSourcesHeader(raw: string | null): ChatSource[] {
  if (!raw) return [];
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is ChatSource =>
        s &&
        typeof s.url === "string" &&
        typeof s.label === "string" &&
        /^https?:\/\//i.test(s.url)
    );
  } catch {
    return [];
  }
}
