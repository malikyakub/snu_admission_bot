import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRecentChats } from "@/lib/admin-recent-chats";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAdmin(req: Request): Promise<
  { ok: true } | { ok: false; status: number; error: string }
> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : "";
  if (!token) return { ok: false, status: 401, error: "Missing access token" };

  const sb = serviceClient();
  if (!sb) {
    return { ok: false, status: 500, error: "Server Supabase is not configured" };
  }

  const { data: userData, error: userError } = await sb.auth.getUser(token);
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: "Invalid session" };
  }

  const { data: adminRow, error: adminError } = await sb
    .from("admins")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (adminError) {
    return { ok: false, status: 500, error: adminError.message };
  }
  if (!adminRow) {
    return { ok: false, status: 403, error: "Not authorized as an admin." };
  }
  return { ok: true };
}

/** GET /api/admin/recent-chats — last 5 chats with latest message (admin auth). */
export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.status }
      );
    }

    const chats = await getRecentChats(6);
    return NextResponse.json({ ok: true, chats });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load recent chats";
    console.error("[/api/admin/recent-chats]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
