import { getSupabase } from "@/lib/supabase";

export type RequestedChat = {
  conversation_id: string;
  title: string;
  updated_at: string;
  /** True when the latest message is from the student (admin has not replied yet). */
  awaiting_reply: boolean;
};

function stripCtas(text: string): string {
  return text.replace(/\[\[cta:[^\]]+\]\]/gi, "").replace(/\s+/g, " ").trim();
}

function titleFromMessage(text: string): string {
  const clean = stripCtas(text);
  if (!clean) return "Student request";
  if (clean.length <= 40) return clean;
  return `${clean.slice(0, 39).trimEnd()}…`;
}

/**
 * Conversations where a student requested an admin (needs_human = true).
 */
export async function getRequestedChats(limit = 30): Promise<RequestedChat[]> {
  const supabase = getSupabase();

  let rows: { id: string; title?: string | null; updated_at: string }[] | null =
    null;

  {
    const withTitle = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .eq("needs_human", true)
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (withTitle.error && /title/i.test(withTitle.error.message)) {
      const fallback = await supabase
        .from("conversations")
        .select("id, updated_at")
        .eq("needs_human", true)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (fallback.error) throw new Error(fallback.error.message);
      rows = fallback.data as { id: string; updated_at: string }[];
    } else if (withTitle.error) {
      throw new Error(withTitle.error.message);
    } else {
      rows = withTitle.data as {
        id: string;
        title?: string | null;
        updated_at: string;
      }[];
    }
  }

  const ids = (rows ?? []).map((r) => String(r.id));
  if (ids.length === 0) return [];

  const titleById = new Map<string, string | null>();
  for (const row of rows ?? []) {
    titleById.set(String(row.id), (row.title as string | null) ?? null);
  }

  const missingTitleIds = ids.filter((id) => !titleById.get(id)?.trim());
  const firstUserById = new Map<string, string>();

  if (missingTitleIds.length > 0) {
    const { data: userMsgs } = await supabase
      .from("messages")
      .select("conversation_id, content, created_at")
      .in("conversation_id", missingTitleIds)
      .eq("role", "user")
      .order("created_at", { ascending: true });

    for (const row of userMsgs ?? []) {
      const id = String(row.conversation_id);
      if (firstUserById.has(id)) continue;
      firstUserById.set(id, String(row.content ?? ""));
    }
  }

  // Latest message role per conversation — student last => awaiting admin reply
  const lastRoleById = new Map<string, string>();
  const { data: recentMsgs } = await supabase
    .from("messages")
    .select("conversation_id, role, created_at")
    .in("conversation_id", ids)
    .order("created_at", { ascending: false });

  for (const row of recentMsgs ?? []) {
    const id = String(row.conversation_id);
    if (lastRoleById.has(id)) continue;
    lastRoleById.set(id, String(row.role ?? ""));
  }

  const updatedById = new Map(
    (rows ?? []).map((r) => [String(r.id), String(r.updated_at)])
  );

  const chats = ids.map((id) => {
    const stored = titleById.get(id)?.trim();
    const title =
      stored ||
      titleFromMessage(firstUserById.get(id) || "") ||
      "Student request";
    const lastRole = lastRoleById.get(id);
    const awaiting_reply = lastRole !== "admin";

    return {
      conversation_id: id,
      title,
      updated_at: updatedById.get(id) || new Date().toISOString(),
      awaiting_reply,
    };
  });

  // Awaiting first, then already-replied (stable within each group by updated_at desc)
  return chats.sort((a, b) => {
    if (a.awaiting_reply !== b.awaiting_reply) {
      return a.awaiting_reply ? -1 : 1;
    }
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
}
