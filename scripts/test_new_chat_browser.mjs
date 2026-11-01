/**
 * Browser races for New chat (Playwright).
 * Needs: npm run dev
 * Run: node scripts/test_new_chat_browser.mjs
 */
import { createRequire } from "module";
import { randomUUID } from "crypto";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const require = createRequire(import.meta.url);
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

const { chromium } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const BASE = process.env.CHAT_BASE || "http://127.0.0.1:3000";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

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

async function sidebarTitles(page) {
  return page.locator("aside button").evaluateAll((btns) =>
    btns
      .map((b) => (b.textContent || "").trim())
      .filter((t) => t && t !== "New chat" && !/Admin/i.test(t))
  );
}

async function activeId(page) {
  return page.evaluate(() => {
    try {
      return JSON.parse(
        localStorage.getItem("snubot:active_conversation_id") || "null"
      );
    } catch {
      return null;
    }
  });
}

async function indexEntries(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("snubot:conversation_index_v1");
      const idx = raw ? JSON.parse(raw) : {};
      return Object.values(idx);
    } catch {
      return [];
    }
  });
}

async function countDb(id) {
  if (!sb || !id) return null;
  const { count, error } = await sb
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("id", id);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

console.log("\n=== Browser: New chat races ===");

await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByRole("button", { name: /New chat/i }).waitFor({
  timeout: 30_000,
});

// Seed one real conversation via UI so sidebar has a baseline
const seedMsg = `Seed fees question ${randomUUID().slice(0, 8)}`;
await page.getByPlaceholder(/mind/i).fill(seedMsg);
await page.getByRole("button", { name: /Send/i }).click();
await page.waitForTimeout(2500);
const seededId = await activeId(page);
const afterSeedTitles = await sidebarTitles(page);
ok("seed chat appears in sidebar", afterSeedTitles.length >= 1, String(afterSeedTitles));
ok("seed created active id", !!seededId);

if (seededId && sb) {
  ok("seed has DB row", (await countDb(seededId)) === 1);
}

const beforeCount = afterSeedTitles.length;

// 1) Click New chat 5 times fast
for (let i = 0; i < 5; i++) {
  await page.getByRole("button", { name: /^New chat$/i }).click({ delay: 0 });
}
await page.waitForTimeout(400);

const afterFiveTitles = await sidebarTitles(page);
const afterFiveId = await activeId(page);
const afterFiveIndex = await indexEntries(page);

ok("New chat ×5 → no active id", afterFiveId == null);
ok(
  "New chat ×5 → sidebar count unchanged",
  afterFiveTitles.length === beforeCount,
  `before=${beforeCount} after=${afterFiveTitles.length} titles=${JSON.stringify(afterFiveTitles)}`
);
ok(
  "New chat ×5 → no empty index drafts",
  afterFiveIndex.every((e) => e.messageCount > 0)
);
ok(
  "New chat ×5 → no duplicate of seed title flood",
  afterFiveTitles.filter((t) => t.includes(seedMsg.slice(0, 20))).length <= 1
);

if (seededId && sb) {
  // Draft clicks must not create extra DB rows for new ids
  ok("seed DB row still exactly 1", (await countDb(seededId)) === 1);
}

// 2) New chat while a poll is in flight:
// Re-open seed, wait for a conversations fetch, click New chat mid-flight
if (seededId) {
  await page.goto(`${BASE}/?conversation=${seededId}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /^New chat$/i }).waitFor();

  // Trigger and race: start a fetch, click New chat immediately
  const race = page.waitForResponse(
    (r) => r.url().includes(`/api/conversations/${seededId}`),
    { timeout: 10_000 }
  ).catch(() => null);

  // Force a poll by waiting ~1s then clicking during likely network activity
  await page.evaluate(async (id) => {
    // Kick an explicit fetch the page would also do
    void fetch(`/api/conversations/${id}`, { cache: "no-store" });
  }, seededId);

  await page.getByRole("button", { name: /^New chat$/i }).click();
  await race;
  await page.waitForTimeout(500);

  const midTitles = await sidebarTitles(page);
  const midId = await activeId(page);
  const midIndex = await indexEntries(page);

  ok("poll-in-flight New chat → no active id", midId == null);
  ok(
    "poll-in-flight New chat → no sidebar duplicate",
    midTitles.length === beforeCount,
    `titles=${JSON.stringify(midTitles)}`
  );
  ok(
    "poll-in-flight → index has no empty ghost for new id",
    midIndex.every((e) => e.messageCount > 0) &&
      midIndex.filter((e) => e.conversation_id !== seededId).every((e) => e.messageCount > 0)
  );
}

// 3) Strict Mode reload (Next.js dev double-mounts effects)
await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 });
await page.getByRole("button", { name: /^New chat$/i }).click();
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(800);

const reloadId = await activeId(page);
const reloadTitles = await sidebarTitles(page);
const reloadIndex = await indexEntries(page);

ok(
  "Strict Mode reload draft → no active id (or only prior seeded)",
  reloadId == null || reloadId === seededId
);
ok(
  "Strict Mode reload → no new empty sidebar rows",
  reloadTitles.length <= beforeCount + 0,
  `before=${beforeCount} after=${reloadTitles.length}`
);
ok(
  "Strict Mode reload → no messageCount=0 drafts in index",
  reloadIndex.every((e) => e.messageCount > 0)
);

// Confirm no orphan DB rows: draft never minted an id, so nothing to check
// beyond seed still being 1
if (seededId && sb) {
  ok("after races seed DB row still 1", (await countDb(seededId)) === 1);
}

await browser.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
