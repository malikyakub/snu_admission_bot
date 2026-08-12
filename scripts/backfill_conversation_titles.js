/**
 * Backfill conversations.title for rows that have a first exchange but no title.
 * Run: node scripts/backfill_conversation_titles.js
 *
 * Uses the same Groq title prompt as the live chat path.
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

const { createClient } = require("@supabase/supabase-js");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TITLE_MODEL =
  process.env.GROQ_TITLE_MODEL || "llama-3.1-8b-instant";
const TITLE_SYSTEM =
  "Summarize this question in 3-6 words as a short title, no punctuation at the end, no quotes.";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const groqKey = process.env.GROQ_API_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!groqKey) {
  console.error("Missing GROQ_API_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function stripNoise(text) {
  return String(text || "")
    .replace(/\[\[cta:[^\]]+\]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackTitle(content) {
  const clean = stripNoise(content);
  if (!clean) return "New conversation";
  if (clean.length <= 48) return clean;
  return `${clean.slice(0, 47).trimEnd()}…`;
}

function normalizeTitle(raw, fallback) {
  let t = String(raw || "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:;,\-–—]+$/g, "")
    .trim();
  if (!t) return fallback;
  const words = t.split(/\s+/);
  if (words.length > 8) t = words.slice(0, 6).join(" ");
  if (t.length > 60) t = `${t.slice(0, 59).trimEnd()}…`;
  return t || fallback;
}

async function generateTitle(userMessage, assistantMessage) {
  const fallback = fallbackTitle(userMessage);
  const user = stripNoise(userMessage).slice(0, 500);
  const assistant = stripNoise(assistantMessage).slice(0, 400);
  if (!user) return fallback;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
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
  });

  if (!res.ok) {
    console.warn("Groq error", res.status, await res.text());
    return fallback;
  }
  const json = await res.json();
  return normalizeTitle(json.choices?.[0]?.message?.content ?? "", fallback);
}

async function main() {
  const { data: rows, error } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("list conversations:", error.message);
    process.exit(1);
  }

  const force = process.argv.includes("--force");
  console.log(
    `Conversations scanned: ${(rows || []).length}${force ? " (--force re-title)" : ""}`
  );

  let updated = 0;
  let skipped = 0;
  const examples = [];

  for (const row of rows || []) {
    const existing = String(row.title || "").trim();

    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", row.id)
      .in("role", ["user", "assistant"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (msgErr) {
      console.warn(row.id, msgErr.message);
      skipped++;
      continue;
    }

    const firstUser = (msgs || []).find((m) => m.role === "user");
    const firstAssistant = (msgs || []).find((m) => m.role === "assistant");
    if (!firstUser?.content?.trim() || !firstAssistant?.content?.trim()) {
      skipped++;
      continue;
    }

    const looksLikeRawFirstMessage =
      !existing ||
      existing.endsWith("…") ||
      existing === fallbackTitle(firstUser.content) ||
      existing.length > 40;

    if (!force && existing && !looksLikeRawFirstMessage) {
      skipped++;
      continue;
    }

    const title = await generateTitle(firstUser.content, firstAssistant.content);
    const { error: updErr } = await supabase
      .from("conversations")
      .update({ title })
      .eq("id", row.id);

    if (updErr) {
      console.warn(row.id, updErr.message);
      skipped++;
      continue;
    }

    updated++;
    if (examples.length < 8) {
      examples.push({
        id: row.id.slice(0, 8),
        user: stripNoise(firstUser.content).slice(0, 80),
        title,
      });
    }
    console.log("✓", row.id.slice(0, 8), "→", title);
  }

  console.log("\nDone. updated=%d skipped=%d", updated, skipped);
  console.log("\nExample titles:");
  for (const ex of examples) {
    console.log(`  "${ex.user}" → ${ex.title}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
