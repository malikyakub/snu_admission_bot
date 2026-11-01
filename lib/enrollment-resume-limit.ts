/**
 * In-memory rate limit for failed enrollment phone-resume attempts.
 * Keyed by conversation id and/or client IP (whichever is available).
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_FAILURES = 5;

type Bucket = { failures: number[]; }; // timestamps of failures

const buckets = new Map<string, Bucket>();

function prune(bucket: Bucket, now: number): void {
  bucket.failures = bucket.failures.filter((t) => now - t < WINDOW_MS);
}

function keysFor(opts: {
  conversationId?: string | null;
  ip?: string | null;
}): string[] {
  const keys: string[] = [];
  const conv = opts.conversationId?.trim();
  const ip = opts.ip?.trim();
  if (conv) keys.push(`conv:${conv}`);
  if (ip) keys.push(`ip:${ip}`);
  if (keys.length === 0) keys.push("anon");
  return keys;
}

/** True when any related key is over the failed-attempt limit. */
export function isEnrollmentResumePhoneRateLimited(opts: {
  conversationId?: string | null;
  ip?: string | null;
}): boolean {
  const now = Date.now();
  for (const key of keysFor(opts)) {
    const bucket = buckets.get(key);
    if (!bucket) continue;
    prune(bucket, now);
    if (bucket.failures.length >= MAX_FAILURES) return true;
  }
  return false;
}

/** Record a failed resume phone attempt (no match / not resumable). */
export function recordEnrollmentResumePhoneFailure(opts: {
  conversationId?: string | null;
  ip?: string | null;
}): void {
  const now = Date.now();
  for (const key of keysFor(opts)) {
    const bucket = buckets.get(key) ?? { failures: [] };
    prune(bucket, now);
    bucket.failures.push(now);
    buckets.set(key, bucket);
  }
}

export const ENROLLMENT_RESUME_PHONE_RATE_LIMIT = {
  maxFailures: MAX_FAILURES,
  windowMs: WINDOW_MS,
} as const;
