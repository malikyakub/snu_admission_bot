export type RemoteChatMessage = {
  id: string;
  role: "user" | "assistant" | "admin" | "system";
  content: string;
  created_at: string;
};

export type ConversationMeta = {
  needs_human: boolean;
  title: string | null;
};

export type ConversationBundle = {
  messages: RemoteChatMessage[];
  meta: ConversationMeta | null;
  /** true when the HTTP load failed (not merely an empty new chat) */
  error?: string;
};

type ConversationApiResponse = {
  ok?: boolean;
  error?: string;
  conversation?: {
    id?: string;
    title?: string | null;
    needs_human?: boolean;
  } | null;
  messages?: Array<{
    id?: string;
    role?: string;
    content?: string;
    created_at?: string;
  }>;
};

function mapMessages(
  rows: ConversationApiResponse["messages"]
): RemoteChatMessage[] {
  const out: RemoteChatMessage[] = [];
  for (const row of rows ?? []) {
    const role = String(row.role ?? "");
    if (
      role !== "user" &&
      role !== "assistant" &&
      role !== "admin" &&
      role !== "system"
    ) {
      continue;
    }
    out.push({
      id: String(row.id),
      role: role as RemoteChatMessage["role"],
      content: String(row.content ?? ""),
      created_at: String(row.created_at ?? ""),
    });
  }
  return stabilizeTurnOrder(out);
}

/**
 * Repair adjacent pairs where a parallel-insert race put assistant
 * slightly before its user question (within 1s).
 */
function stabilizeTurnOrder(messages: RemoteChatMessage[]): RemoteChatMessage[] {
  const out = [...messages];
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (a.role !== "assistant" || b.role !== "user") continue;
    const t0 = Date.parse(a.created_at);
    const t1 = Date.parse(b.created_at);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    if (t1 - t0 >= 0 && t1 - t0 < 1000) {
      out[i] = b;
      out[i + 1] = a;
    }
  }
  return out;
}

/** Single load of messages + meta via service-role API (anon RLS blocks direct reads). */
export async function fetchConversationBundle(
  conversationId: string
): Promise<ConversationBundle> {
  try {
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: "GET",
      cache: "no-store",
    });
    const json = (await res
      .json()
      .catch(() => null)) as ConversationApiResponse | null;

    if (!res.ok || !json?.ok) {
      const err = json?.error || `HTTP ${res.status}`;
      console.warn("[student-realtime] load failed:", err);
      return { messages: [], meta: null, error: err };
    }

    const meta: ConversationMeta = json.conversation
      ? {
          needs_human: Boolean(json.conversation.needs_human),
          title:
            typeof json.conversation.title === "string" &&
            json.conversation.title.trim()
              ? json.conversation.title.trim()
              : null,
        }
      : { needs_human: false, title: null };

    return {
      messages: mapMessages(json.messages),
      meta,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Load failed";
    console.warn("[student-realtime]", msg);
    return { messages: [], meta: null, error: msg };
  }
}

export async function fetchConversationMessages(
  conversationId: string
): Promise<RemoteChatMessage[]> {
  const { messages } = await fetchConversationBundle(conversationId);
  return messages;
}

export async function fetchConversationMeta(
  conversationId: string
): Promise<ConversationMeta | null> {
  const { meta } = await fetchConversationBundle(conversationId);
  return meta;
}

export async function fetchConversationNeedsHuman(
  conversationId: string
): Promise<boolean | null> {
  const meta = await fetchConversationMeta(conversationId);
  if (!meta) return null;
  return meta.needs_human;
}
