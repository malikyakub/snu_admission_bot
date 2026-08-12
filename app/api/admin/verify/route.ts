import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * POST /api/admin/verify
 * Body unused — sends Authorization: Bearer <access_token>
 * Confirms the token user has a matching public.admins row (service role).
 */
export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.toLowerCase().startsWith("bearer ")
      ? auth.slice(7).trim()
      : "";
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing access token" },
        { status: 401 }
      );
    }

    const sb = serviceClient();
    if (!sb) {
      return NextResponse.json(
        { ok: false, error: "Server Supabase is not configured" },
        { status: 500 }
      );
    }

    const { data: userData, error: userError } = await sb.auth.getUser(token);
    if (userError || !userData.user) {
      return NextResponse.json(
        { ok: false, error: "Invalid session" },
        { status: 401 }
      );
    }

    const user = userData.user;
    const { data: adminRow, error: adminError } = await sb
      .from("admins")
      .select("id, email, full_name")
      .eq("id", user.id)
      .maybeSingle();

    if (adminError) {
      return NextResponse.json(
        { ok: false, error: adminError.message },
        { status: 500 }
      );
    }

    if (!adminRow) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Not authorized as an admin. This account does not have admin access.",
        },
        { status: 403 }
      );
    }

    return NextResponse.json({
      ok: true,
      admin: {
        id: adminRow.id,
        email: adminRow.email,
        full_name: adminRow.full_name,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verify failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
