import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { clearNeedsHuman } from "@/lib/conversations";
import { ctaMarker } from "@/lib/cta";
import { handoffWelcomeBackMessage } from "@/lib/handoff";
import type { ChatHistoryMessage } from "@/lib/prompt";
import { POST as chatPost } from "@/app/api/chat/route";

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

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/admin/chats/[id] — conversation + messages for admin handoff. */
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
        { ok: false, error: "Missing conversation id" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, title, needs_human, updated_at, created_at")
      .eq("id", id)
      .maybeSingle();

    if (convError) {
      // Older DB without title
      if (/title/i.test(convError.message)) {
        const fallback = await supabase
          .from("conversations")
          .select("id, needs_human, updated_at, created_at")
          .eq("id", id)
          .maybeSingle();
        if (fallback.error) throw new Error(fallback.error.message);
        if (!fallback.data) {
          return NextResponse.json(
            { ok: false, error: "Conversation not found" },
            { status: 404 }
          );
        }
        const { data: messages, error: msgError } = await supabase
          .from("messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", id)
          .order("created_at", { ascending: true });
        if (msgError) throw new Error(msgError.message);
        return NextResponse.json({
          ok: true,
          conversation: { ...fallback.data, title: null },
          messages: messages ?? [],
        });
      }
      throw new Error(convError.message);
    }

    if (!conversation) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, role, content, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });

    if (msgError) throw new Error(msgError.message);

    return NextResponse.json({
      ok: true,
      conversation,
      messages: messages ?? [],
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to load conversation";
    console.error("[/api/admin/chats/[id]]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/** POST /api/admin/chats/[id] — send an admin reply (role: admin). */
export async function POST(req: Request, ctx: Ctx) {
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
        { ok: false, error: "Missing conversation id" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      content?: string;
    } | null;
    const content = (body?.content ?? "").trim();
    if (!content) {
      return NextResponse.json(
        { ok: false, error: "Message content is required" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    if (convError) throw new Error(convError.message);
    if (!conversation) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: message, error: insertError } = await supabase
      .from("messages")
      .insert({
        conversation_id: id,
        role: "admin",
        content,
      })
      .select("id, role, content, created_at")
      .single();

    if (insertError) {
      if (/role|check/i.test(insertError.message)) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Database does not allow role=admin yet. Run scripts/allow_admin_message_role.sql in Supabase.",
          },
          { status: 500 }
        );
      }
      throw new Error(insertError.message);
    }

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true, message });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to send admin message";
    console.error("[/api/admin/chats/[id] POST]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/chats/[id]
 * Body: { action: "release" | "start_enrollment" }
 * - release: needs_human = false; bot answers last student msg or welcomes back
 * - start_enrollment: needs_human = false + assistant enroll CTA for the student
 */
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
        { ok: false, error: "Missing conversation id" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      action?: string;
    } | null;
    const action = (body?.action || "").trim();
    if (action !== "release" && action !== "start_enrollment") {
      return NextResponse.json(
        {
          ok: false,
          error: 'action must be "release" or "start_enrollment"',
        },
        { status: 400 }
      );
    }

    const supabase = getSupabase();
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, needs_human")
      .eq("id", id)
      .maybeSingle();

    if (convError) throw new Error(convError.message);
    if (!conversation) {
      return NextResponse.json(
        { ok: false, error: "Conversation not found" },
        { status: 404 }
      );
    }

    await clearNeedsHuman(id);

    let botMessage = null as {
      id: string;
      role: string;
      content: string;
      created_at: string;
    } | null;

    if (action === "start_enrollment") {
      const content =
        "An admin has started your enrollment. Please complete the application form.\n\n" +
        `${ctaMarker("enroll", "Start your application")}\n\n[[open_enrollment]]`;

      const { data: message, error: insertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: id,
          role: "assistant",
          content,
        })
        .select("id, role, content, created_at")
        .single();

      if (insertError) throw new Error(insertError.message);
      botMessage = message;
    } else {
      // release: answer last student message, or welcome the student back
      const { data: msgs, error: msgError } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true });

      if (msgError) throw new Error(msgError.message);

      const last = msgs?.[msgs.length - 1];
      if (last?.role === "user" && last.content.trim()) {
        const history: ChatHistoryMessage[] = (msgs || [])
          .slice(0, -1)
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }));

        const chatUrl = new URL("/api/chat", req.url);
        const chatRes = await chatPost(
          new Request(chatUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: last.content,
              conversation_id: id,
              history,
              stream: false,
              skip_user_save: true,
            }),
          })
        );

        const chatJson = (await chatRes.json().catch(() => null)) as {
          answer?: string;
          message?: {
            id: string;
            role: string;
            content: string;
            created_at: string;
          } | null;
          error?: string;
        } | null;

        if (!chatRes.ok) {
          throw new Error(
            chatJson?.error || `Bot resume failed (${chatRes.status})`
          );
        }

        if (chatJson?.message) {
          botMessage = chatJson.message;
        } else if (chatJson?.answer?.trim()) {
          // Fallback if chat returned answer but not the row
          const { data: message, error: insertError } = await supabase
            .from("messages")
            .insert({
              conversation_id: id,
              role: "assistant",
              content: chatJson.answer.trim(),
            })
            .select("id, role, content, created_at")
            .single();
          if (insertError) throw new Error(insertError.message);
          botMessage = message;
        }
      } else {
        const content = handoffWelcomeBackMessage();
        const { data: message, error: insertError } = await supabase
          .from("messages")
          .insert({
            conversation_id: id,
            role: "assistant",
            content,
          })
          .select("id, role, content, created_at")
          .single();

        if (insertError) throw new Error(insertError.message);
        botMessage = message;
      }
    }

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({
      ok: true,
      action,
      needs_human: false,
      message: botMessage,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to update conversation";
    console.error("[/api/admin/chats/[id] PATCH]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


