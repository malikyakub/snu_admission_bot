/**
 * Swap created_at on adjacent assistant/user pairs that raced
 * (assistant timestamp slightly before user within 1s).
 * Run: node scripts/fix_message_order.js
 */
require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: convs, error } = await sb.from("conversations").select("id");
  if (error) throw error;
  let swaps = 0;

  for (const c of convs || []) {
    const { data: msgs, error: mErr } = await sb
      .from("messages")
      .select("id, role, created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: true });
    if (mErr) throw mErr;

    for (let i = 0; i < (msgs || []).length - 1; i++) {
      const a = msgs[i];
      const b = msgs[i + 1];
      if (a.role !== "assistant" || b.role !== "user") continue;
      const t0 = Date.parse(a.created_at);
      const t1 = Date.parse(b.created_at);
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
      if (t1 - t0 < 0 || t1 - t0 >= 1000) continue;

      // Swap timestamps so user sorts first
      const { error: e1 } = await sb
        .from("messages")
        .update({ created_at: b.created_at })
        .eq("id", a.id);
      const { error: e2 } = await sb
        .from("messages")
        .update({ created_at: a.created_at })
        .eq("id", b.id);
      if (e1 || e2) {
        console.warn(c.id, e1 || e2);
        continue;
      }
      swaps++;
      console.log("swapped", c.id.slice(0, 8), a.id.slice(0, 8), "<->", b.id.slice(0, 8));
      // refresh local view of timestamps for further pairs
      const tmp = a.created_at;
      a.created_at = b.created_at;
      b.created_at = tmp;
    }
  }

  console.log("Done. swaps=", swaps);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
