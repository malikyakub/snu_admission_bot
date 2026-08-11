/** Admin gate helpers for /login and /admin routes. */

export const ADMIN_UNAUTHORIZED_MESSAGE =
  "Not authorized as an admin. This account does not have admin access.";

export const INVALID_CREDENTIALS_MESSAGE =
  "Invalid email or password.";

export const ADMIN_HOME = "/admin/dashboard";

const ADMIN_CACHE_KEY = "snubot:admin_gate";
const ADMIN_CACHE_MS = 10 * 60 * 1000;

export type AdminCache = { email: string | null; at: number };

export function readAdminCache(): AdminCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(ADMIN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminCache;
    if (!parsed?.at || Date.now() - parsed.at > ADMIN_CACHE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAdminCache(email: string | null) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      ADMIN_CACHE_KEY,
      JSON.stringify({ email, at: Date.now() } satisfies AdminCache)
    );
  } catch {
    /* ignore */
  }
}

export function clearAdminCache() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(ADMIN_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/** Map Supabase Auth errors to a clear login message. */
export function mapAuthLoginError(error: {
  message?: string;
  code?: string;
  status?: number;
} | null): string {
  if (!error) return "Login failed. Please try again.";
  const code = (error.code || "").toLowerCase();
  const msg = (error.message || "").toLowerCase();
  if (
    code === "invalid_login_credentials" ||
    code === "invalid_credentials" ||
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password")
  ) {
    return INVALID_CREDENTIALS_MESSAGE;
  }
  return error.message || "Login failed. Please try again.";
}

/** Verify current bearer token is an admin. */
export async function verifyAdminAccess(
  accessToken: string
): Promise<{ ok: true; email: string | null } | { ok: false }> {
  const verifyRes = await fetch("/api/admin/verify", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const verifyJson = (await verifyRes.json().catch(() => null)) as {
    ok?: boolean;
    admin?: { email?: string | null };
  } | null;
  if (!verifyRes.ok || !verifyJson?.ok) return { ok: false };
  return { ok: true, email: verifyJson.admin?.email ?? null };
}
