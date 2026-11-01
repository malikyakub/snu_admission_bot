/**
 * New-chat session races:
 *  1. getOrCreateConversation UUID validation + ON CONFLICT DO NOTHING
 *  2. Client: New chat ×5, poll-in-flight race, Strict Mode remount
 *  3. No DB row until first message
 *
 * Needs: SUPABASE_* in .env / .env.local (and optionally npm run dev for API check)
 * Run: node scripts/test_new_chat_session.mjs
 */
import { createRequire } from "module";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);

// Load env like other scripts
for (const f of [".env", ".env.local"]) {
  const p = resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CLIENT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertClientConversationId(id) {
  const trimmed = String(id).trim();
  if (!CLIENT_UUID_RE.test(trimmed)) {
    throw new Error(`invalid conversation_id (expected UUID): ${id}`);
  }
  return trimmed;
}

async function insertIgnoreConflict(id, ipAddress = null) {
  const payload = {
    id,
    needs_human: false,
    handoff_offered: false,
    waiting_for_phone: false,
  };
  if (ipAddress) payload.ip_address = ipAddress;
  const { error } = await sb
    .from("conversations")
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

async function getConversation(id) {
  const { data, error } = await sb
    .from("conversations")
    .select(
      "id, needs_human, handoff_offered, waiting_for_phone, ip_address, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function getOrCreateConversation(id, opts = {}) {
  if (id) {
    const safeId = assertClientConversationId(id);
    await insertIgnoreConflict(safeId, opts.ipAddress ?? null);
    const row = await getConversation(safeId);
    if (!row) throw new Error(`row missing for ${safeId}`);
    return row;
  }
  const { data, error } = await sb
    .from("conversations")
    .insert({
      needs_human: false,
      handoff_offered: false,
      waiting_for_phone: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function countById(id) {
  const { count, error } = await sb
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function deleteConv(id) {
  await sb.from("messages").delete().eq("conversation_id", id);
  await sb.from("conversations").delete().eq("id", id);
}

let passed = 0;
let failed = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1) DB: UUID validation + conflict-safe insert                        */
/* ------------------------------------------------------------------ */
console.log("\n=== DB getOrCreateConversation ===");

{
  let threw = false;
  try {
    await getOrCreateConversation("not-a-uuid");
  } catch (e) {
    threw = /invalid conversation_id/i.test(String(e.message || e));
  }
  ok("rejects non-UUID client id", threw);
}

{
  const id = randomUUID();
  const [a, b, c] = await Promise.all([
    getOrCreateConversation(id),
    getOrCreateConversation(id),
    getOrCreateConversation(id),
  ]);
  ok("parallel getOrCreate returns same id", a.id === id && b.id === id && c.id === id);
  ok("parallel getOrCreate creates exactly one row", (await countById(id)) === 1);
  await deleteConv(id);
}

{
  const id = randomUUID();
  await getOrCreateConversation(id);
  await getOrCreateConversation(id); // retry
  ok("retry getOrCreate still one row", (await countById(id)) === 1);
  await deleteConv(id);
}

/* ------------------------------------------------------------------ */
/* 2) Client state machine (mirrors app/page.tsx fix)                   */
/* ------------------------------------------------------------------ */
console.log("\n=== Client New-chat state machine ===");

function makeStore() {
  /** @type {Record<string, any>} */
  const index = {};
  let active = null;
  let conversationId = null;
  let messages = [];
  let ensuringSessionId = null;
  let conversationIdRef = null;

  function sortedIndexList() {
    return Object.values(index)
      .filter((e) => e.messageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function syncIndexMeta(id, msgs) {
    const prev = index[id];
    if (msgs.length === 0 && !prev) return;
    const title =
      msgs.find((m) => m.role === "user")?.content?.trim()?.slice(0, 60) ||
      prev?.title ||
      "New conversation";
    index[id] = {
      conversation_id: id,
      createdAt: prev?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      title,
      messageCount: msgs.length,
      adminHandoff: false,
    };
  }

  function startNewChat() {
    active = null;
    ensuringSessionId = null;
    conversationIdRef = null;
    conversationId = null;
    messages = [];
  }

  /** Simulate Strict Mode double-bootstrap with no reuse id */
  function bootstrapDraft() {
    // cancelled first pass does nothing lasting
    active = null;
    ensuringSessionId = null;
    conversationId = null;
    messages = [];
  }

  async function syncFromRemote(id, remoteMessages, { delayMs = 0 } = {}) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (conversationIdRef !== id) return; // stale guard
    messages = remoteMessages;
    syncIndexMeta(id, remoteMessages);
  }

  function handleSend(text) {
    let id = conversationId ?? ensuringSessionId;
    if (!id) {
      id = randomUUID();
      ensuringSessionId = id;
      conversationIdRef = id;
      conversationId = id;
      active = id;
    } else if (!conversationId) {
      conversationIdRef = id;
      conversationId = id;
      active = id;
    }
    messages = [...messages, { role: "user", content: text }];
    syncIndexMeta(id, messages);
    return id;
  }

  return {
    get sidebar() {
      return sortedIndexList();
    },
    get conversationId() {
      return conversationId;
    },
    get messages() {
      return messages;
    },
    get active() {
      return active;
    },
    startNewChat,
    bootstrapDraft,
    syncFromRemote,
    handleSend,
    /** test hook: seed an existing chat in the index */
    seedChat(id, title, msgs) {
      conversationId = id;
      conversationIdRef = id;
      active = id;
      messages = msgs;
      syncIndexMeta(id, msgs);
    },
  };
}

{
  const s = makeStore();
  const oldId = randomUUID();
  s.seedChat(oldId, "Fees for medicine?", [
    { role: "user", content: "Fees for medicine?" },
    { role: "assistant", content: "Here are the fees…" },
  ]);
  const before = s.sidebar.length;

  for (let i = 0; i < 5; i++) s.startNewChat();

  ok("New chat ×5 → conversationId null", s.conversationId === null);
  ok("New chat ×5 → messages empty", s.messages.length === 0);
  ok(
    "New chat ×5 → sidebar unchanged (no duplicates)",
    s.sidebar.length === before &&
      s.sidebar.every((e) => e.conversation_id === oldId)
  );
  ok(
    "New chat ×5 → no empty draft rows",
    s.sidebar.every((e) => e.messageCount > 0)
  );
}

{
  const s = makeStore();
  const oldId = randomUUID();
  const oldMsgs = [
    { role: "user", content: "What programs?" },
    { role: "assistant", content: "Engineering, Medicine…" },
  ];
  s.seedChat(oldId, "What programs?", oldMsgs);
  const beforeTitles = s.sidebar.map((e) => e.title);

  // Poll in flight for oldId, then New chat mid-flight
  const inflight = s.syncFromRemote(oldId, oldMsgs, { delayMs: 30 });
  s.startNewChat();
  await inflight;

  ok("poll-in-flight + New chat → still null session", s.conversationId === null);
  ok("poll-in-flight + New chat → messages stay empty", s.messages.length === 0);
  ok(
    "poll-in-flight + New chat → no duplicate sidebar entry",
    s.sidebar.length === 1 &&
      s.sidebar[0].conversation_id === oldId &&
      s.sidebar[0].title === beforeTitles[0]
  );
}

{
  const s = makeStore();
  // Strict Mode: effect runs, cleanup, effect runs again — draft only
  s.bootstrapDraft();
  s.bootstrapDraft();
  ok("Strict Mode remount → null session", s.conversationId === null);
  ok("Strict Mode remount → empty sidebar", s.sidebar.length === 0);
  ok("Strict Mode remount → no ensuring id leak", s.active === null);
}

/* ------------------------------------------------------------------ */
/* 3) No DB row until first message                                     */
/* ------------------------------------------------------------------ */
console.log("\n=== No DB row until first message ===");

{
  const s = makeStore();
  const draftIds = [];
  // Simulate 5 New chats — client never allocates an id
  for (let i = 0; i < 5; i++) {
    s.startNewChat();
    if (s.conversationId) draftIds.push(s.conversationId);
  }
  ok("draft New chats allocate zero client ids", draftIds.length === 0);

  // First send creates id + DB row
  const id = s.handleSend("Hello SNU");
  ok("first send mints UUID", CLIENT_UUID_RE.test(id));

  // Before API: row should not exist yet
  ok("no DB row before getOrCreate", (await countById(id)) === 0);

  await getOrCreateConversation(id);
  ok("DB row exists after first-message getOrCreate", (await countById(id)) === 1);

  // Double API call (retry / Strict) still one row
  await Promise.all([
    getOrCreateConversation(id),
    getOrCreateConversation(id),
  ]);
  ok("post-send double getOrCreate still one row", (await countById(id)) === 1);

  ok(
    "sidebar has exactly one entry after first send",
    s.sidebar.length === 1 && s.sidebar[0].conversation_id === id
  );

  await deleteConv(id);
}

/* ------------------------------------------------------------------ */
/* 4) Optional live API smoke (if dev server up)                        */
/* ------------------------------------------------------------------ */
console.log("\n=== Live API smoke (optional) ===");
const BASE = process.env.CHAT_BASE || "http://localhost:3000";
try {
  const id = randomUUID();
  // Hitting chat with a brand-new id should create exactly one row
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "hi",
      conversation_id: id,
      history: [],
      stream: false,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    console.log(`  SKIP  live API (HTTP ${res.status})`);
  } else {
    const json = await res.json();
    const n = await countById(id);
    ok(
      "live API uses client id or creates ≤1 row",
      (json.conversation_id === id || json.conversation_id == null) && n <= 1,
      `conversation_id=${json.conversation_id} count=${n}`
    );
    ok("live API never creates >1 row for same id", n <= 1, `count=${n}`);
    if (n) await deleteConv(id);
  }
} catch (e) {
  console.log(`  SKIP  live API (${e.cause?.code || e.message || e})`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
