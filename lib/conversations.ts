import { getSupabase } from "./supabase";

export type Conversation = {
  id: string;
  needs_human: boolean;
  handoff_offered: boolean;
  waiting_for_phone: boolean;
  ip_address?: string | null;
  created_at?: string;
  updated_at?: string;
};

const CONV_SELECT =
  "id, needs_human, handoff_offered, waiting_for_phone, ip_address, created_at, updated_at";

export type CreateConversationOpts = {
  id?: string;
  ipAddress?: string | null;
};

export async function getConversation(
  id: string
): Promise<Conversation | null> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("conversations")
    .select(CONV_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error && /ip_address/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .select(
        "id, needs_human, handoff_offered, waiting_for_phone, created_at, updated_at"
      )
      .eq("id", id)
      .maybeSingle();
    data = fallback.data
      ? { ...fallback.data, ip_address: null }
      : null;
    error = fallback.error;
  }

  if (error && /waiting_for_phone/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .select("id, needs_human, handoff_offered, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    data = fallback.data
      ? { ...fallback.data, waiting_for_phone: false, ip_address: null }
      : null;
    error = fallback.error;
  }

  if (error) {
    throw new Error(`conversations read failed: ${error.message}`);
  }
  return normalizeConversation(data);
}

function insertPayload(opts: CreateConversationOpts = {}) {
  const row: Record<string, unknown> = {
    needs_human: false,
    handoff_offered: false,
    waiting_for_phone: false,
  };
  if (opts.id) row.id = opts.id;
  if (opts.ipAddress) row.ip_address = opts.ipAddress;
  return row;
}

export async function createConversation(
  opts: CreateConversationOpts = {}
): Promise<Conversation> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("conversations")
    .insert(insertPayload(opts))
    .select(CONV_SELECT)
    .single();

  // Older DBs without ip_address — retry without it
  if (error && /ip_address/i.test(error.message)) {
    const { id: _id, ipAddress: _ip, ...rest } = {
      id: opts.id,
      ipAddress: opts.ipAddress,
    };
    void _id;
    void _ip;
    const fallback = await supabase
      .from("conversations")
      .insert({
        ...(opts.id ? { id: opts.id } : {}),
        needs_human: false,
        handoff_offered: false,
        waiting_for_phone: false,
      })
      .select(
        "id, needs_human, handoff_offered, waiting_for_phone, created_at, updated_at"
      )
      .single();
    data = fallback.data
      ? { ...fallback.data, ip_address: null }
      : null;
    error = fallback.error;
  }

  if (error && /waiting_for_phone/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .insert({
        ...(opts.id ? { id: opts.id } : {}),
        needs_human: false,
        handoff_offered: false,
        ...(opts.ipAddress ? { ip_address: opts.ipAddress } : {}),
      })
      .select("id, needs_human, handoff_offered, created_at, updated_at")
      .single();
    data = fallback.data
      ? { ...fallback.data, waiting_for_phone: false, ip_address: opts.ipAddress ?? null }
      : null;
    error = fallback.error;
  }

  if (error) {
    throw new Error(
      `conversations create failed: ${error.message}. ` +
        "Run supabase/schema.sql if needed."
    );
  }
  return normalizeConversation(data)!;
}

export async function getOrCreateConversation(
  id?: string | null,
  opts: { ipAddress?: string | null } = {}
): Promise<Conversation> {
  if (id) {
    const existing = await getConversation(id);
    if (existing) {
      // Backfill IP once if missing
      if (!existing.ip_address && opts.ipAddress) {
        await setConversationIp(existing.id, opts.ipAddress);
        return { ...existing, ip_address: opts.ipAddress };
      }
      return existing;
    }
    return createConversation({ id, ipAddress: opts.ipAddress });
  }

  return createConversation({ ipAddress: opts.ipAddress });
}

/** Set ip_address when still null (best-effort; ignore column-missing errors). */
export async function setConversationIp(
  id: string,
  ipAddress: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ ip_address: ipAddress })
    .eq("id", id)
    .is("ip_address", null);

  if (error && !/ip_address/i.test(error.message)) {
    console.warn("[conversations] setConversationIp:", error.message);
  }
}

export async function markHandoffOffered(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ handoff_offered: true })
    .eq("id", id);

  if (error) {
    throw new Error(`conversations handoff_offered update failed: ${error.message}`);
  }
}

/** Clear a pending handoff offer (decline or high-confidence follow-up). */
export async function clearHandoffOffered(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ handoff_offered: false })
    .eq("id", id);

  if (error) {
    throw new Error(
      `conversations clear handoff_offered failed: ${error.message}`
    );
  }
}

export async function markNeedsHuman(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ needs_human: true, handoff_offered: false })
    .eq("id", id);

  if (error) {
    throw new Error(`conversations needs_human update failed: ${error.message}`);
  }
}

/** Release conversation back to the bot. */
export async function clearNeedsHuman(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ needs_human: false, handoff_offered: false })
    .eq("id", id);

  if (error) {
    throw new Error(`conversations clear needs_human failed: ${error.message}`);
  }
}

export async function setWaitingForPhone(
  id: string,
  waiting: boolean
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ waiting_for_phone: waiting })
    .eq("id", id);

  if (error) {
    throw new Error(
      `conversations waiting_for_phone update failed: ${error.message}`
    );
  }
}

function normalizeConversation(data: unknown): Conversation | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    needs_human: Boolean(row.needs_human),
    handoff_offered: Boolean(row.handoff_offered),
    waiting_for_phone: Boolean(row.waiting_for_phone),
    ip_address: (row.ip_address as string | null | undefined) ?? null,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}
