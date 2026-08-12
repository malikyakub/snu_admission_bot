import { after } from "next/server";
import { getSupabase } from "./supabase";
import { saveConversationTitleOnce } from "./conversation-title";

export type MessageRole = "user" | "assistant" | "system" | "admin";

/** Bump conversation activity only — titles are AI-generated once. */
async function touchConversation(conversationId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (error) {
    console.warn("[messages] touchConversation:", error.message);
  }
}

async function insertMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  createdAt: string
): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    role,
    content,
    created_at: createdAt,
  });
  if (error) {
    console.warn(`[messages] ${role} insert failed:`, error.message);
    return false;
  }
  return true;
}

/**
 * Fire-and-forget single message insert (admin replies, etc.).
 * Prefer saveTurnAsync / saveUserAndAssistantWhenReady for chat turns.
 */
export function saveMessageAsync(
  conversationId: string | null | undefined,
  role: MessageRole,
  content: string
): void {
  if (!conversationId || !content.trim()) return;

  after(async () => {
    try {
      const ok = await insertMessage(
        conversationId,
        role,
        content.trim(),
        new Date().toISOString()
      );
      if (ok) await touchConversation(conversationId);
    } catch (err) {
      console.warn(
        "[messages] insert error:",
        err instanceof Error ? err.message : err
      );
    }
  });
}

export type SavedMessageRow = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

/**
 * Persist a user + assistant turn immediately (used when handing back to bot).
 */
export async function saveTurnNow(
  conversationId: string | null | undefined,
  userContent: string,
  assistantContent: string,
  opts?: { skipUserSave?: boolean }
): Promise<SavedMessageRow | null> {
  if (!conversationId) return null;
  try {
    const user = userContent.trim();
    const assistant = assistantContent.trim();
    if (!user && !assistant) return null;

    const t0 = Date.now();
    if (user && !opts?.skipUserSave) {
      await insertMessage(
        conversationId,
        "user",
        user,
        new Date(t0).toISOString()
      );
    }

    let assistantRow: SavedMessageRow | null = null;
    if (assistant) {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "assistant",
          content: assistant,
          created_at: new Date(t0 + 2).toISOString(),
        })
        .select("id, role, content, created_at")
        .single();
      if (error) {
        console.warn("[messages] saveTurnNow assistant:", error.message);
      } else {
        assistantRow = data as SavedMessageRow;
      }
    }
    await touchConversation(conversationId);
    if (user && assistant) {
      await saveConversationTitleOnce(conversationId, user, assistant);
    }
    return assistantRow;
  } catch (err) {
    console.warn(
      "[messages] saveTurnNow:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Persist a full user + assistant turn without blocking the response.
 * Inserts sequentially with ordered timestamps so the student always
 * appears before the bot when loading by created_at.
 */
export function saveTurnAsync(
  conversationId: string | null | undefined,
  userContent: string,
  assistantContent: string,
  opts?: { skipUserSave?: boolean }
): void {
  if (!conversationId) return;
  after(async () => {
    await saveTurnNow(conversationId, userContent, assistantContent, opts);
  });
}

/**
 * After the HTTP response: insert the user row first, then the assistant
 * once the stream text is ready. Never inserts them in parallel (that raced
 * and put bot bubbles above the student question).
 */
export function saveUserAndAssistantWhenReady(
  conversationId: string | null | undefined,
  userMessage: string,
  contentPromise: Promise<string>,
  opts?: { skipUserSave?: boolean }
): void {
  if (!conversationId) return;

  after(async () => {
    try {
      const user = userMessage.trim();
      const t0 = Date.now();

      if (user && !opts?.skipUserSave) {
        await insertMessage(
          conversationId,
          "user",
          user,
          new Date(t0).toISOString()
        );
      }

      const content = await contentPromise;
      const assistant = content.trim();
      if (!assistant) {
        if (user && !opts?.skipUserSave) await touchConversation(conversationId);
        return;
      }

      await insertMessage(
        conversationId,
        "assistant",
        assistant,
        new Date(Math.max(Date.now(), t0 + 2)).toISOString()
      );
      await touchConversation(conversationId);

      if (user) {
        await saveConversationTitleOnce(conversationId, user, assistant);
      }
    } catch (err) {
      console.warn(
        "[messages] saveUserAndAssistantWhenReady:",
        err instanceof Error ? err.message : err
      );
    }
  });
}

/** @deprecated use saveUserAndAssistantWhenReady */
export function saveAssistantWhenReady(
  conversationId: string | null | undefined,
  contentPromise: Promise<string>,
  userMessage?: string
): void {
  if (userMessage?.trim()) {
    saveUserAndAssistantWhenReady(
      conversationId,
      userMessage,
      contentPromise
    );
    return;
  }
  after(async () => {
    try {
      const content = await contentPromise;
      if (!content.trim() || !conversationId) return;
      await insertMessage(
        conversationId,
        "assistant",
        content.trim(),
        new Date().toISOString()
      );
      await touchConversation(conversationId);
    } catch (err) {
      console.warn(
        "[messages] assistant insert error:",
        err instanceof Error ? err.message : err
      );
    }
  });
}
