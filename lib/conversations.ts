import { getSupabase } from "./supabase";

export type Conversation = {
  id: string;
  needs_human: boolean;
  handoff_offered: boolean;
  waiting_for_phone: boolean;
  created_at?: string;
  updated_at?: string;
};

const CONV_SELECT =
  "id, needs_human, handoff_offered, waiting_for_phone, created_at, updated_at";

export async function getConversation(
  id: string
): Promise<Conversation | null> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("conversations")
    .select(CONV_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error && /waiting_for_phone/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .select("id, needs_human, handoff_offered, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    data = fallback.data
      ? { ...fallback.data, waiting_for_phone: false }
      : null;
    error = fallback.error;
  }

  if (error) {
    throw new Error(`conversations read failed: ${error.message}`);
  }
  return normalizeConversation(data);
}

export async function createConversation(): Promise<Conversation> {
  const supabase = getSupabase();
  let { data, error } = await supabase
    .from("conversations")
    .insert({
      needs_human: false,
      handoff_offered: false,
      waiting_for_phone: false,
    })
    .select(CONV_SELECT)
    .single();

  if (error && /waiting_for_phone/i.test(error.message)) {
    const fallback = await supabase
      .from("conversations")
      .insert({ needs_human: false, handoff_offered: false })
      .select("id, needs_human, handoff_offered, created_at, updated_at")
      .single();
    data = fallback.data
      ? { ...fallback.data, waiting_for_phone: false }
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
  id?: string | null
): Promise<Conversation> {
  const supabase = getSupabase();

  if (id) {
    const existing = await getConversation(id);
    if (existing) return existing;

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        id,
        needs_human: false,
        handoff_offered: false,
        waiting_for_phone: false,
      })
      .select(CONV_SELECT)
      .single();

    if (error) {
      throw new Error(
        `conversations create failed: ${error.message}. ` +
          "Run supabase/schema.sql if needed."
      );
    }
    return normalizeConversation(data)!;
  }

  return createConversation();
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
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}
