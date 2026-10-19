// Local test data only. Creates (or resets) an existing app user whose email matches a demo 1health account, so the
// "existing user" scenarios can run. Password: TEST_USER_PASSWORD in .env.local (generated; local Supabase only).
// Usage: node --env-file=.env.local scripts/seed-test-user.mjs <email> [--unlink] [--link <env:tenant:user>]
import { createClient } from "@supabase/supabase-js";

const [email, ...flags] = process.argv.slice(2);
if (!email) { console.error("usage: seed-test-user.mjs <email> [--unlink] [--link env:tenant:user]"); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: id } = await db.rpc("auth_user_id_by_email", { p_email: email });
let userId = id;
if (!userId) {
  const { data, error } = await db.auth.admin.createUser({ email, password: process.env.TEST_USER_PASSWORD, email_confirm: true, user_metadata: { name: "Seeded user" } });
  if (error) throw error;
  userId = data.user.id;
}
const i = flags.indexOf("--link");
const link = i >= 0 ? flags[i + 1].split(":") : null;
if (link || flags.includes("--unlink")) {
  const [env, tenant, user] = link ?? [null, null, null];
  const { error } = await db.from("profiles").update({ one_health_env: env, one_health_tenant_id: tenant, one_health_user_id: user }).eq("id", userId);
  if (error) throw error;
}
console.log(`${email} → ${userId}${link ? ` linked ${link.join(":")}` : flags.includes("--unlink") ? " unlinked" : ""}`);
