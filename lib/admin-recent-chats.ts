import { getSupabase } from "@/lib/supabase";

export type RecentChat = {
  conversation_id: string;
  title: string;
  last_message: string;
  last_role: "user" | "assistant" | "system" | "admin";
  last_at: string;
};

function stripCtas(text: string): string {
  return text.replace(/\[\[cta:[^\]]+\]\]/gi, "").replace(/\s+/g, " ").trim();
}

function previewText(text: string, max = 90): string {
  const clean = stripCtas(text);
  if (clean.length <= max) return clean || "—";
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

function titleFromMessage(text: string): string {
  const clean = stripCtas(text);
  if (!clean) return "New conversation";
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 47).trimEnd()}…`;
}

/**
 * Latest 6 conversations by last message time, with title + last line preview.
 */
export async function getRecentChats(limit = 6): Promise<RecentChat[]> {
  const supabase = getSupabase();

  const { data: recentMsgs, error } = await supabase
    .from("messages")
    .select("conversation_id, role, content, created_at")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) throw new Error(error.message);

  const latestByConv = new Map<
    string,
    { role: string; content: string; created_at: string }
  >();

  for (const row of recentMsgs ?? []) {
    const id = String(row.conversation_id);
    if (latestByConv.has(id)) continue;
    latestByConv.set(id, {
      role: String(row.role),
      content: String(row.content ?? ""),
      created_at: String(row.created_at),
    });
    if (latestByConv.size >= limit) break;
  }

  const ids = [...latestByConv.keys()];
  if (ids.length === 0) return [];

  const titleById = new Map<string, string | null>();
  {
    const titled = await supabase
      .from("conversations")
      .select("id, title")
      .in("id", ids);
    if (titled.error && /title/i.test(titled.error.message)) {
      // Older DB without title column — titles derived from messages below
    } else if (titled.error) {
      throw new Error(titled.error.message);
    } else {
      for (const row of titled.data ?? []) {
        titleById.set(String(row.id), (row.title as string | null) ?? null);
      }
    }
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

  return ids.map((id) => {
    const last = latestByConv.get(id)!;
    const stored = titleById.get(id)?.trim();
    const title =
      stored ||
      titleFromMessage(firstUserById.get(id) || last.content) ||
      "New conversation";

    return {
      conversation_id: id,
      title,
      last_message: previewText(last.content),
      last_role: (last.role as RecentChat["last_role"]) || "assistant",
      last_at: last.created_at,
    };
  });
}
