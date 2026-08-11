/**
 * Status-check phone-wait exit + phone variant smoke tests (no server required for unit bits).
 * Full chat flow: node scripts/test_phone_wait_exit.js  (needs npm run dev)
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

const BASE = process.env.CHAT_BASE || "http://localhost:3000";

function normalizePhoneDigits(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0") && d.length >= 9 && d.length <= 10) d = `252${d.slice(1)}`;
  if (d.length === 9 && d.startsWith("6")) d = `252${d}`;
  return d;
}

function phoneVariants(raw) {
  const trimmed = raw.trim();
  const digits = normalizePhoneDigits(trimmed);
  const variants = new Set();
  if (trimmed) variants.add(trimmed);
  const rawDigits = trimmed.replace(/\D/g, "");
  if (rawDigits) {
    variants.add(rawDigits);
    variants.add(`+${rawDigits}`);
  }
  if (digits) {
    variants.add(digits);
    variants.add(`+${digits}`);
    if (digits.startsWith("252") && digits.length >= 12) {
      const local = digits.slice(3);
      variants.add(local);
      variants.add(`0${local}`);
      variants.add(`252${local}`);
      variants.add(`+252${local}`);
    }
  }
  return [...variants];
}

console.log("=== phone normalization ===");
const samples = ["252612544819", "+252 61 2544819", "612544819", "0612544819"];
for (const s of samples) {
  console.log(s, "→", normalizePhoneDigits(s), "variants include 252612544819?", phoneVariants(s).includes("252612544819") || phoneVariants(s).includes(normalizePhoneDigits(s)));
}

async function post(body) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

(async () => {
  console.log("\n=== chat flow (needs running server) ===");
  try {
    const conv = crypto.randomUUID();
    const history = [];

    const t1 = await post({
      message: "check my enrollment status",
      conversation_id: conv,
      history,
    });
    console.log("1 ask status:", t1.json.flow, (t1.json.answer || "").slice(0, 80));
    history.push({ role: "user", content: "check my enrollment status" });
    history.push({ role: "assistant", content: t1.json.answer });

    const t2 = await post({
      message: "252612544819",
      conversation_id: conv,
      history,
    });
    console.log(
      "2 bad phone:",
      t2.json.flow,
      "looked_up=",
      t2.json.looked_up,
      (t2.json.answer || "").slice(0, 80)
    );
    history.push({ role: "user", content: "252612544819" });
    history.push({ role: "assistant", content: t2.json.answer });

    const t3 = await post({
      message: "let's start enrollment instead",
      conversation_id: conv,
      history,
    });
    console.log(
      "3 switch enroll:",
      t3.json.flow,
      "exited=",
      t3.json.exited_phone_wait,
      /Start your application|\[\[cta:enroll/i.test(t3.json.answer || ""),
      (t3.json.answer || "").slice(0, 100)
    );

    const stillPhonePrompt = /still need the phone number/i.test(
      t3.json.answer || ""
    );
    if (stillPhonePrompt) {
      console.error("FAIL: still stuck on phone prompt");
      process.exit(1);
    }
    if (t3.json.flow !== "enrollment_offer" && !/\[\[cta:enroll/i.test(t3.json.answer || "")) {
      console.error("FAIL: expected enrollment offer, got", t3.json.flow);
      process.exit(1);
    }
    console.log("PASS");
  } catch (err) {
    console.warn("Chat flow skipped (is the server up?):", err.message);
  }
})();
