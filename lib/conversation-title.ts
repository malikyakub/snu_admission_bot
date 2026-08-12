import { after } from "next/server";
import { getSupabase } from "@/lib/supabase";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
/** Fast/cheap model for titles — override with GROQ_TITLE_MODEL. */
const GROQ_TITLE_MODEL =
  process.env.GROQ_TITLE_MODEL || "llama-3.1-8b-instant";

const TITLE_SYSTEM =
  "Summarize this question in 3-6 words as a short title, no punctuation at the end, no quotes.";

function stripNoise(text: string): string {
  return text
    .replace(/\[\[cta:[^\]]+\]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fallback when Groq fails — truncated first user message. */
export function fallbackTitleFromUserMessage(content: string): string {
  const clean = stripNoise(content);
  if (!clean) return "New conversation";
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 47).trimEnd()}…`;
}

function normalizeGeneratedTitle(raw: string, fallback: string): string {
  let t = raw
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/[:;,\-–—]+$/g, "").trim();
  if (!t) return fallback;
  const words = t.split(/\s+/);
  if (words.length > 8) {
    t = words.slice(0, 6).join(" ");
  }
  if (t.length > 60) t = `${t.slice(0, 59).trimEnd()}…`;
  return t || fallback;
}

/**
 * One lightweight Groq call → 3–6 word title from the first exchange.
 */
export async function generateConversationTitle(
  userMessage: string,
  assistantMessage: string
): Promise<string> {
  const fallback = fallbackTitleFromUserMessage(userMessage);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return fallback;

  const user = stripNoise(userMessage).slice(0, 500);
  const assistant = stripNoise(assistantMessage).slice(0, 400);
  if (!user) return fallback;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_TITLE_MODEL,
        temperature: 0.2,
        max_tokens: 24,
        messages: [
          { role: "system", content: TITLE_SYSTEM },
          {
            role: "user",
            content: `Student: ${user}\nAssistant: ${assistant || "(no reply yet)"}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      console.warn(
        "[conversation-title] Groq error:",
        res.status,
        await res.text().catch(() => "")
      );
      return fallback;
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = json.choices?.[0]?.message?.content ?? "";
    return normalizeGeneratedTitle(raw, fallback);
  } catch (err) {
    console.warn(
      "[conversation-title] generate failed:",
      err instanceof Error ? err.message : err
    );
    return fallback;
  }
}

/** Write title only when still null (first exchange only). */
export async function saveConversationTitleOnce(
  conversationId: string,
  userMessage: string,
  assistantMessage: string
): Promise<string | null> {
  const supabase = getSupabase();

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", conversationId)
    .maybeSingle();

  if (convError) {
    if (/title/i.test(convError.message)) {
      console.warn(
        "[conversation-title] title column missing — run schema.sql"
      );
      return null;
    }
    console.warn("[conversation-title] read:", convError.message);
    return null;
  }
  if (!conv) return null;
  if (typeof conv.title === "string" && conv.title.trim()) {
    return conv.title.trim();
  }

  const title = await generateConversationTitle(userMessage, assistantMessage);

  const { data: updated, error: updError } = await supabase
    .from("conversations")
    .update({ title })
    .eq("id", conversationId)
    .is("title", null)
    .select("title")
    .maybeSingle();

  if (updError) {
    console.warn("[conversation-title] update:", updError.message);
    return null;
  }

  if (updated?.title) return String(updated.title);

  const { data: again } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", conversationId)
    .maybeSingle();
  return again?.title?.trim() || title;
}

/**
 * Load first user+assistant from DB and title once (backfill / backup path).
 */
export async function ensureConversationTitle(
  conversationId: string
): Promise<string | null> {
  const supabase = getSupabase();

  const { data: conv, error: convError } = await supabase
    .from("conversations")
    .select("id, title")
    .eq("id", conversationId)
    .maybeSingle();

  if (convError) {
    if (/title/i.test(convError.message)) return null;
    console.warn("[conversation-title] read:", convError.message);
    return null;
  }
  if (!conv) return null;
  if (typeof conv.title === "string" && conv.title.trim()) {
    return conv.title.trim();
  }

  const { data: msgs, error: msgError } = await supabase
    .from("messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: true })
    .limit(20);

  if (msgError) {
    console.warn("[conversation-title] messages:", msgError.message);
    return null;
  }

  const firstUser = (msgs ?? []).find((m) => m.role === "user");
  const firstAssistant = (msgs ?? []).find((m) => m.role === "assistant");
  if (!firstUser?.content?.trim() || !firstAssistant?.content?.trim()) {
    return null;
  }

  return saveConversationTitleOnce(
    conversationId,
    String(firstUser.content),
    String(firstAssistant.content)
  );
}

/**
 * Fire-and-forget after the HTTP response — never blocks chat TTFB.
 * Call from the request path with the known first-exchange texts.
 */
export function scheduleConversationTitleFromExchange(
  conversationId: string | null | undefined,
  userMessage: string,
  assistantMessage: string
): void {
  if (!conversationId || !userMessage.trim() || !assistantMessage.trim()) return;

  after(async () => {
    try {
      await saveConversationTitleOnce(
        conversationId,
        userMessage,
        assistantMessage
      );
    } catch (err) {
      console.warn(
        "[conversation-title] schedule failed:",
        err instanceof Error ? err.message : err
      );
    }
  });
}
