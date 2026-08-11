/**
 * Admin login scenario tests (Auth + public.admins gate).
 * Run: node scripts/test_admin_login.js
 *
 * NOTE: Sets a temporary password on malikyakub@hotmail.com for testing.
 */
require("dotenv").config({ path: ".env" });
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ADMIN_EMAIL = "malikyakub@hotmail.com";
const ADMIN_ID = "3ccc827d-0629-43ce-be02-7bb2037048c0";
const TEMP_PW = "SnubotAdminTest2026!";
const NONADMIN_EMAIL = "snubot.nonadmin.test@example.com";
const NONADMIN_PW = "SnubotNonAdmin2026!";

function mapAuth(err) {
  if (!err) return null;
  const code = (err.code || "").toLowerCase();
  const msg = (err.message || "").toLowerCase();
  if (
    code === "invalid_login_credentials" ||
    code === "invalid_credentials" ||
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password")
  ) {
    return "Invalid email or password.";
  }
  return err.message;
}

async function verifyAdminAccess(accessToken) {
  const { data: userData, error: userError } =
    await service.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return { ok: false, status: 401, error: "Invalid session" };
  }
  const { data: adminRow, error: adminError } = await service
    .from("admins")
    .select("id, email, full_name")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (adminError) {
    return { ok: false, status: 500, error: adminError.message };
  }
  if (!adminRow) {
    return {
      ok: false,
      status: 403,
      error:
        "Not authorized as an admin. This account does not have admin access.",
    };
  }
  return { ok: true, status: 200, admin: adminRow };
}

async function main() {
  const upd = await service.auth.admin.updateUserById(ADMIN_ID, {
    password: TEMP_PW,
  });
  console.log(
    "admin password set for test:",
    upd.error ? upd.error.message : "ok (temporary — reset in Dashboard if needed)"
  );

  let nonAdminId = null;
  const listed = await service.auth.admin.listUsers({ page: 1, perPage: 100 });
  const existing = (listed.data?.users || []).find(
    (u) => u.email === NONADMIN_EMAIL
  );
  if (existing) {
    nonAdminId = existing.id;
    await service.auth.admin.updateUserById(nonAdminId, {
      password: NONADMIN_PW,
      email_confirm: true,
    });
    console.log("non-admin reset:", nonAdminId);
  } else {
    const created = await service.auth.admin.createUser({
      email: NONADMIN_EMAIL,
      password: NONADMIN_PW,
      email_confirm: true,
    });
    if (created.error) {
      console.log("create non-admin error:", created.error.message);
      process.exit(1);
    }
    nonAdminId = created.data.user.id;
    console.log("non-admin created:", nonAdminId);
  }

  const inAdmins = await service
    .from("admins")
    .select("id")
    .eq("id", nonAdminId)
    .maybeSingle();
  console.log("non-admin row in public.admins?:", inAdmins.data);

  console.log("\n=== 3) Wrong password / invalid credentials ===");
  const bad = await anon.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: "definitely-wrong-password-xxx",
  });
  console.log({
    authSucceeded: !bad.error,
    uiMessage: mapAuth(bad.error),
    rawMessage: bad.error && bad.error.message,
    code: bad.error && bad.error.code,
    sessionCreated: !!bad.data.session,
    adminsChecked: false,
  });
  await anon.auth.signOut();

  console.log("\n=== 1) Valid admin login ===");
  const good = await anon.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: TEMP_PW,
  });
  if (good.error || !good.data.session) {
    console.log({
      PASS: false,
      authError: good.error && good.error.message,
    });
  } else {
    const verify = await verifyAdminAccess(good.data.session.access_token);
    console.log({
      authSucceeded: true,
      userId: good.data.user.id,
      adminsMatch: verify.ok,
      adminRow: verify.admin || null,
      wouldRedirectToAdminStudents: verify.ok,
      verifyStatus: verify.status,
    });
    await anon.auth.signOut();
  }

  console.log("\n=== 2) Valid Auth user, NOT in public.admins ===");
  const na = await anon.auth.signInWithPassword({
    email: NONADMIN_EMAIL,
    password: NONADMIN_PW,
  });
  if (na.error || !na.data.session) {
    console.log({
      PASS: false,
      authError: na.error && na.error.message,
    });
  } else {
    const verify = await verifyAdminAccess(na.data.session.access_token);
    await anon.auth.signOut();
    const sess = await anon.auth.getSession();
    console.log({
      authSucceeded: true,
      userId: na.data.user.id,
      adminsMatch: verify.ok,
      deniedMessage: verify.error,
      signedOutAfterDeny: !sess.data.session,
      wouldRedirectToAdminStudents: false,
      verifyStatus: verify.status,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
