/**
 * Best-effort client IP from reverse-proxy / platform headers.
 * Prefer leftmost x-forwarded-for entry (original client on Vercel).
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 64);

  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf.slice(0, 64);

  const vercel = headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }

  return null;
}
