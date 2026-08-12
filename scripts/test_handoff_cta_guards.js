/**
 * Pure-function guards for handoff CTA stickiness (no API).
 * Run: node scripts/test_handoff_cta_guards.js
 */
const assert = require("assert");

function stripHandoffCta(content) {
  return (content || "")
    .replace(/\[\[cta:handoff(?:\|[^\]]+)?\]\]/gi, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isHandoffDecline(message) {
  const t = message
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!t) return false;
  if (
    /^(n|no|nope|nah|no thanks|no thank you|not now|never mind|nevermind)([.!?\s]|$)/i.test(
      t
    )
  ) {
    return true;
  }
  return /\b(no need|no thanks|no thank you|not necessary|don'?t (need|want|bother)|do not (need|want)|skip (it|that|the admin)|never mind|nevermind)\b/i.test(
    t
  );
}

function finalizeAnswer(raw, lowConfidence) {
  if (lowConfidence) {
    const trimmed = (raw || "").trim();
    if (/\[\[cta:handoff/i.test(trimmed)) return trimmed;
    return `${trimmed}\n\n[[cta:handoff|Connect with an admin]]`;
  }
  return stripHandoffCta(raw);
}

// Model copied CTA into a confident answer → must be stripped
const confident = finalizeAnswer(
  "Medicine offers MBBS.\n\n[[cta:handoff|Connect with an admin]]",
  false
);
assert.ok(!/\[\[cta:handoff/i.test(confident), "strip on high confidence");
assert.ok(/Medicine offers MBBS/i.test(confident));

// Low confidence → CTA present
const low = finalizeAnswer("I don't have that information.", true);
assert.ok(/\[\[cta:handoff/i.test(low), "append on low confidence");

assert.ok(isHandoffDecline("no need, tell me about Medicine"));
assert.ok(isHandoffDecline("No thanks"));
assert.ok(!isHandoffDecline("yes please connect me"));

console.log("PASS");
