/**
 * Readiness battery — runs fixed questions against POST /api/chat.
 * Usage: node scripts/readiness_test.js
 * Env: CHAT_BASE (default http://localhost:3001)
 */
const fs = require("fs");
const path = require("path");

const BASE = process.env.CHAT_BASE || "http://localhost:3001";
const OUT_DIR = path.join(__dirname, "..", "outputs");
const OUT_FILE = process.env.OUT_FILE
  ? path.resolve(process.env.OUT_FILE)
  : path.join(OUT_DIR, "readiness_test_results.csv");

const QUESTIONS = [
  "What documents do I need to submit for the online application?",
  "What programs does the Faculty of Engineering offer?",
  "What subjects are covered in the SNU admission exam?",
  "Can I choose two Tier 1 faculties as my top choices?",
  "What score do I need to get placed into my first-choice faculty?",
  "How much will I spend total for the Faculty of Law program?",
  "What happens after I pass the admission exam?",
  "How can I check my enrollment status?",
  "Where is SNU located and how can I contact admissions?",
  "What is the mode of study at SNU — is it full-time or part-time?",
];

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function ask(question) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: question, stream: false }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      question,
      answer: json.error || `HTTP ${res.status}`,
      intent_topic: "",
      intent_faculty: "",
      top_similarity: "",
      low_confidence: "",
      needs_human: "",
      handoff_offered: "",
      num_sources: 0,
      confidence_of_top_source: "",
      _error: true,
    };
  }

  const sources = Array.isArray(json.sources) ? json.sources : [];
  const top = sources[0];

  return {
    question,
    answer: json.answer ?? "",
    intent_topic: json.intent?.topic ?? "",
    intent_faculty: json.intent?.faculty ?? "",
    top_similarity:
      json.top_similarity != null ? json.top_similarity : top?.similarity ?? "",
    low_confidence: Boolean(json.low_confidence),
    needs_human: Boolean(json.needs_human),
    handoff_offered: Boolean(json.handoff_offered),
    num_sources: sources.length,
    confidence_of_top_source: top?.confidence ?? "",
    _error: false,
  };
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const header = [
    "question",
    "answer",
    "intent_topic",
    "intent_faculty",
    "top_similarity",
    "low_confidence",
    "needs_human",
    "handoff_offered",
    "num_sources",
    "confidence_of_top_source",
  ];

  const rows = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    process.stdout.write(`[${i + 1}/${QUESTIONS.length}] ${q.slice(0, 60)}... `);
    const row = await ask(q);
    rows.push(row);
    console.log(
      row._error
        ? "ERROR"
        : `sim=${row.top_similarity} low=${row.low_confidence} sources=${row.num_sources}`
    );
  }

  const lines = [
    header.join(","),
    ...rows.map((r) =>
      header.map((col) => csvEscape(r[col])).join(",")
    ),
  ];
  fs.writeFileSync(OUT_FILE, lines.join("\n") + "\n", "utf8");

  const low = rows.filter((r) => r.low_confidence === true).length;
  const empty = rows.filter((r) => !String(r.answer || "").trim()).length;
  const errors = rows.filter((r) => r._error).length;

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(
    `Summary: ${rows.length} questions — low_confidence=${low}, empty_answers=${empty}, errors=${errors}`
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
