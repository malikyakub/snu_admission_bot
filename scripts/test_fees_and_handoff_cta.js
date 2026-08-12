/**
 * Live fee-model checks: Education $950, Science $1,700, Medicine $2,210.
 * Needs: npm run dev
 * Run: node scripts/test_fees_and_handoff_cta.js
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });

const BASE = process.env.CHAT_BASE || "http://localhost:3000";

async function postChat(body) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: false }),
  });
  const json = await res.json();
  return { status: res.status, json };
}

function hasHandoffCta(answer) {
  return /\[\[cta:handoff/i.test(answer || "");
}

function mentionsAmount(answer, amounts) {
  return amounts.some((a) => (answer || "").includes(a));
}

(async () => {
  const feeConv = crypto.randomUUID();
  const feeQs = [
    {
      q: "What is the total cost for the full Faculty of Education programme including foundation?",
      mustInclude: ["950", "9,50"], // 950 or $950
      accept: ["950"],
    },
    {
      q: "What is the total cost for the full Faculty of Science programme including foundation?",
      accept: ["1700", "1,700"],
    },
    {
      q: "What is the total cost for the full Medicine and Surgery programme including foundation?",
      accept: ["2210", "2,210"],
    },
  ];

  let history = [];
  for (const item of feeQs) {
    const { status, json } = await postChat({
      message: item.q,
      conversation_id: feeConv,
      history,
    });
    if (status !== 200) {
      console.error("FAIL fee HTTP", status, json);
      process.exit(1);
    }
    const answer = json.answer || "";
    console.log("\nQ:", item.q);
    console.log("A:", answer.slice(0, 360).replace(/\s+/g, " "));
    console.log("low_confidence:", json.low_confidence, "sim:", json.top_similarity);

    if (hasHandoffCta(answer) && json.low_confidence !== true) {
      console.error("FAIL unexpected handoff CTA on fee answer");
      process.exit(1);
    }

    const ok = mentionsAmount(answer, item.accept);
    if (!ok) {
      console.error("FAIL missing expected total", item.accept);
      process.exit(1);
    }
    // Old wrong totals must not appear as the headline number for these faculties
    if (item.accept.includes("1700") && /\b1,?575\b/.test(answer) && !/\b1,?700\b/.test(answer)) {
      console.error("FAIL still using old Science total $1,575");
      process.exit(1);
    }
    if (
      item.accept.some((a) => a.includes("2210") || a.includes("2,210")) &&
      /\b2,?180\b/.test(answer) &&
      !/\b2,?210\b/.test(answer)
    ) {
      console.error("FAIL still using slipped Medicine total $2,180");
      process.exit(1);
    }

    history = [
      ...history,
      { role: "user", content: item.q },
      { role: "assistant", content: answer },
    ];
  }

  console.log("\nPASS fee model");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
