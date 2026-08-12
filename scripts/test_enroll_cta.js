const BASE = process.env.CHAT_BASE || "http://localhost:3000";

(async () => {
  const history = [
    {
      role: "user",
      content: "What programs does Faculty of Medicine offer?",
    },
    {
      role: "assistant",
      content: "The Faculty of Medicine and Surgery offers MBBS.",
    },
  ];

  for (const msg of ["that's great. i want in", "i don't see the link"]) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, history, stream: false }),
    });
    const j = await res.json();
    console.log("---", msg);
    console.log("status", res.status, "flow", j.flow, "low", j.low_confidence);
    console.log((j.answer || j.error || "").slice(0, 280).replace(/\s+/g, " "));
    console.log("enroll CTA", /\[\[cta:enroll/i.test(j.answer || ""));
    console.log("handoff CTA", /\[\[cta:handoff/i.test(j.answer || ""));
    if (j.answer) {
      history.push({ role: "user", content: msg });
      history.push({ role: "assistant", content: j.answer });
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
