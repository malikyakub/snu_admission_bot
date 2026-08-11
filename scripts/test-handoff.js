require("dotenv").config();
const fs = require("fs");

const BASE = process.env.CHAT_BASE || "http://localhost:3001";

async function post(body) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

(async () => {
  console.log("=== high confidence (Science programs) ===");
  const hi = await post({
    message: "What programs does the Faculty of Science offer?",
    stream: false,
  });
  console.log({
    status: hi.status,
    low_confidence: hi.json.low_confidence,
    handoff_offered: hi.json.handoff_offered,
    top_similarity: hi.json.top_similarity,
    has_offer: /connect you with an admin/i.test(hi.json.answer || ""),
    intent: hi.json.intent,
  });

  console.log("\n=== low confidence (off-topic) ===");
  const lo = await post({
    message: "What is the price of Bitcoin today and who won the World Cup?",
    stream: false,
  });
  console.log({
    status: lo.status,
    low_confidence: lo.json.low_confidence,
    handoff_offered: lo.json.handoff_offered,
    top_similarity: lo.json.top_similarity,
    has_offer: /connect you with an admin/i.test(lo.json.answer || ""),
    conversation_id: lo.json.conversation_id,
    warning: lo.json.warning,
  });

  console.log("\n=== affirmative after offer (history) ===");
  const yes = await post({
    message: "Yes, please connect me",
    stream: false,
    conversation_id: lo.json.conversation_id || undefined,
    history: [
      {
        role: "user",
        content: "What is the price of Bitcoin today and who won the World Cup?",
      },
      { role: "assistant", content: lo.json.answer },
    ],
  });
  console.log({
    status: yes.status,
    needs_human: yes.json.needs_human,
    answer: yes.json.answer,
    warning: yes.json.warning,
    conversation_id: yes.json.conversation_id,
  });

  fs.writeFileSync(
    "_handoff_test.json",
    JSON.stringify({ hi: hi.json, lo: lo.json, yes: yes.json }, null, 2)
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
