import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getAdminStudent,
  patchAdminStudent,
  type AdminStudentPatch,
} from "@/lib/admin-students";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

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
    return {
      ok: false,
      status: 403,
      error: "Not authorized as an admin.",
    };
  }
  return { ok: true };
}

/** GET /api/admin/students/[id] */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.status }
      );
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing student id" },
        { status: 400 }
      );
    }

    const student = await getAdminStudent(id);
    if (!student) {
      return NextResponse.json(
        { ok: false, error: "Student not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, student });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load student";
    console.error("[/api/admin/students/[id] GET]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** PATCH /api/admin/students/[id] — campus, exam location, status */
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.status }
      );
    }

    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json(
        { ok: false, error: "Missing student id" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as AdminStudentPatch | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const student = await patchAdminStudent(id, body);
    return NextResponse.json({ ok: true, student });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update student";
    console.error("[/api/admin/students/[id] PATCH]", msg);
    const status =
      /must be one of|No valid fields|faculty choice|first choice/i.test(msg)
        ? 400
        : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
