import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/conversations/[id]
 * Public student load: messages + meta for a conversation UUID.
 * Uses service role because anon RLS hides rows from the browser client.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json(
        { ok: false, error: "Invalid conversation id" },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    let conversation: {
      id: string;
      title: string | null;
      needs_human: boolean;
    } | null = null;

    {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, needs_human")
        .eq("id", id)
        .maybeSingle();

      if (error && /title/i.test(error.message)) {
        const fallback = await supabase
          .from("conversations")
          .select("id, needs_human")
          .eq("id", id)
          .maybeSingle();
        if (fallback.error) throw new Error(fallback.error.message);
        if (fallback.data) {
          conversation = {
            id: String(fallback.data.id),
            title: null,
            needs_human: Boolean(fallback.data.needs_human),
          };
        }
      } else if (error) {
        throw new Error(error.message);
      } else if (data) {
        conversation = {
          id: String(data.id),
          title:
            typeof data.title === "string" && data.title.trim()
              ? data.title.trim()
              : null,
          needs_human: Boolean(data.needs_human),
        };
      }
    }

    // Conversation may not exist in DB yet (new local id before first message)
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
    console.error("[/api/conversations/[id]]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
