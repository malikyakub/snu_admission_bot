/**
 * Strict handoff smoke test.
 * Needs: npm run dev
 * Run: node scripts/test_strict_handoff.js
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const BASE = process.env.CHAT_BASE || "http://localhost:3000";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function postChat(body) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  return { status: res.status, json: await res.json() };
}

(async () => {
  const conv = crypto.randomUUID();
  console.log("conv", conv);

  // Force needs_human without going through handoff UX
  await sb.from("conversations").upsert({
    id: conv,
    needs_human: true,
    handoff_offered: false,
    waiting_for_phone: false,
  });

  const silent1 = await postChat({
    message: "what are the fees for medicine?",
    conversation_id: conv,
    history: [],
  });
  console.log("while handed off #1", {
    flow: silent1.json.flow,
    silent: silent1.json.silent,
    answerLen: (silent1.json.answer || "").length,
    needs_human: silent1.json.needs_human,
  });

  const silent2 = await postChat({
    message: "actually tell me about engineering programs",
    conversation_id: conv,
    history: [],
  });
  console.log("while handed off #2", {
    flow: silent2.json.flow,
    silent: silent2.json.silent,
    answerLen: (silent2.json.answer || "").length,
  });

  // Release via service (simulates admin clearing the flag)
  await sb
    .from("conversations")
    .update({ needs_human: false })
    .eq("id", conv);

  // Simulate hand-back: answer last student message without re-saving it
  const { data: msgs } = await sb
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conv)
    .order("created_at", { ascending: true });
  const last = msgs[msgs.length - 1];
  const history = msgs
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant");

  const beforeCount = (
    await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conv)
  ).count;

  const resumeLast = await postChat({
    message: last.content,
    conversation_id: conv,
    history,
    skip_user_save: true,
  });
  console.log("resume last student msg", {
    lastRole: last.role,
    answerPreview: (resumeLast.json.answer || "").slice(0, 100),
    hasMessage: !!resumeLast.json.message,
  });

  const afterCount = (
    await sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conv)
  ).count;

  const resumed = await postChat({
    message: "What programs does the Faculty of Engineering offer?",
    conversation_id: conv,
    history: [],
  });
  console.log("after release (new msg)", {
    flow: resumed.json.flow,
    silent: resumed.json.silent,
    needs_human: resumed.json.needs_human,
    answerPreview: (resumed.json.answer || "").slice(0, 100),
  });

  const okSilent =
    silent1.json.silent === true &&
    silent1.json.needs_human === true &&
    !(silent1.json.answer || "").trim() &&
    silent2.json.silent === true;
  const okResumeLast =
    last.role === "user" &&
    resumeLast.json.silent !== true &&
    (resumeLast.json.answer || "").length > 20 &&
    afterCount === beforeCount + 1; // only assistant row added
  const okResume =
    resumed.json.silent !== true &&
    resumed.json.needs_human !== true &&
    (resumed.json.answer || "").length > 20;

  if (!okSilent || !okResumeLast || !okResume) {
    console.error("FAIL", {
      okSilent,
      okResumeLast,
      okResume,
      beforeCount,
      afterCount,
    });
    process.exit(1);
  }
  console.log("PASS");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
