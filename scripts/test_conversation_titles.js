/**
 * Smoke-test AI conversation titles (no DB writes).
 * Run: node scripts/test_conversation_titles.js
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TITLE_MODEL =
  process.env.GROQ_TITLE_MODEL || "llama-3.1-8b-instant";
const TITLE_SYSTEM =
  "Summarize this question in 3-6 words as a short title, no punctuation at the end, no quotes.";

const samples = [
  {
    user: "What subjects are covered in the SNU admission exam?",
    assistant:
      "The SNU admission exam typically covers Mathematics, English, and general knowledge related to your chosen faculty.",
  },
  {
    user: "how much will I spend for Computer Science",
    assistant:
      "Computer Science tuition at SNU is listed in the fees schedule; total program cost depends on the faculty fee structure.",
  },
  {
    user: "What documents do I need to submit for the online application?",
    assistant:
      "You typically need a photo, national ID or passport, secondary school certificate, and payment proof.",
  },
  {
    user: "Can I choose two Tier 1 faculties as my top choices?",
    assistant:
      "Yes, applicants may rank faculty choices including Tier 1 options according to the admissions rules.",
  },
];

function normalize(raw, fallback) {
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
  return t;
}

async function generate(user, assistant) {
  const started = Date.now();
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
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
          content: `Student: ${user}\nAssistant: ${assistant}`,
        },
      ],
    }),
  });
  const ms = Date.now() - started;
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const title = normalize(json.choices?.[0]?.message?.content ?? "", user.slice(0, 40));
  return { title, ms };
}

async function main() {
  if (!process.env.GROQ_API_KEY) {
    console.error("Missing GROQ_API_KEY");
    process.exit(1);
  }
  console.log("Model:", GROQ_TITLE_MODEL);
  console.log("(Title generation runs in after() on the chat path — not on the response critical path)\n");

  for (const s of samples) {
    const { title, ms } = await generate(s.user, s.assistant);
    console.log(`Q: ${s.user}`);
    console.log(`   → ${title}  (${ms}ms)`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
