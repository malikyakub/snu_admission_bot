import { after } from "next/server";
import { getSupabase } from "./supabase";

export type MessageRole = "user" | "assistant" | "system";

/**
 * Fire-and-forget message insert — never awaits on the response path.
 * Uses Next.js `after()` so the write still runs after the response is sent
 * without adding latency for the user.
 */
export function saveMessageAsync(
  conversationId: string | null | undefined,
  role: MessageRole,
  content: string
): void {
  if (!conversationId || !content.trim()) return;

  after(async () => {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        role,
        content: content.trim(),
      });
      if (error) {
        console.warn("[messages] insert failed:", error.message);
      }
    } catch (err) {
      console.warn(
        "[messages] insert error:",
        err instanceof Error ? err.message : err
      );
    }
  });
}

/** Persist a full user + assistant turn without blocking the response. */
export function saveTurnAsync(
  conversationId: string | null | undefined,
  userContent: string,
  assistantContent: string
): void {
  if (!conversationId) return;
  saveMessageAsync(conversationId, "user", userContent);
  saveMessageAsync(conversationId, "assistant", assistantContent);
}

/**
 * Schedule assistant persistence after a Promise resolves (e.g. stream finished).
 * Does not block the HTTP response.
 */
export function saveAssistantWhenReady(
  conversationId: string | null | undefined,
  contentPromise: Promise<string>
): void {
  if (!conversationId) return;

  after(async () => {
    try {
      const content = await contentPromise;
      if (!content.trim()) return;
      const supabase = getSupabase();
      const { error } = await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "assistant",
        content: content.trim(),
      });
      if (error) {
        console.warn("[messages] assistant insert failed:", error.message);
      }
    } catch (err) {
      console.warn(
        "[messages] assistant insert error:",
        err instanceof Error ? err.message : err
      );
    }
  });
}
