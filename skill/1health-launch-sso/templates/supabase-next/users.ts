// lib/one-health/users.ts — find / link the app user for a verified 1health identity (service role).
// Adapt PROFILE_TABLE and column names to the repo. If the repo has no profile table that mirrors
// auth.users, keep the identity columns on a small `one_health_links` table instead (see sql/supabase.sql).
import "server-only";
import { adminClient } from "./session";
import { LaunchError, type OneHealthIdentity } from "./protocol";

const PROFILE_TABLE = "profiles";        // ← adapt
const PROFILE_ID = "id";                 // ← column that equals auth.users.id

export interface AppUser { id: string; email: string; linked: boolean }

export async function findAppUser(identity: OneHealthIdentity): Promise<AppUser | null> {
  const db = adminClient();

  // 1. Already linked → stable even if the email changed.
  const { data: linked } = await db.from(PROFILE_TABLE).select(`${PROFILE_ID}`)
    .eq("one_health_env", identity.env).eq("one_health_tenant_id", identity.tenantId)
    .eq("one_health_user_id", identity.userId).maybeSingle();
  if (linked) {
    const { data } = await db.auth.admin.getUserById((linked as any)[PROFILE_ID]);
    if (data.user?.email) return { id: data.user.id, email: data.user.email, linked: true };
  }

  // 2. Verified email match (security-definer function, service role only).
  const { data: userId, error } = await db.rpc("auth_user_id_by_email", { p_email: identity.email });
  if (error) throw new LaunchError("user_lookup_failed");
  if (!userId) return null;

  const { data: row } = await db.from(PROFILE_TABLE).select("one_health_user_id").eq(PROFILE_ID, userId).maybeSingle();
  if (row?.one_health_user_id) throw new LaunchError("identity_conflict"); // linked to a different 1health user
  return { id: userId as string, email: identity.email, linked: false };
}

export async function linkOneHealthIdentity(userId: string, identity: OneHealthIdentity) {
  const { error } = await adminClient().from(PROFILE_TABLE).update({
    one_health_env: identity.env, one_health_tenant_id: identity.tenantId, one_health_user_id: identity.userId,
  }).eq(PROFILE_ID, userId);
  if (error) throw new LaunchError("link_failed");
}

export async function auditLaunch(outcome: "success" | "no_user" | "pending_confirm" | "failure",
                                  identity?: Partial<OneHealthIdentity>, extra: { reason?: string; appUserId?: string } = {}) {
  try {
    await adminClient().from("one_health_launch_audit").insert({
      outcome, failure_reason: extra.reason ?? null, one_health_env: identity?.env ?? null,
      one_health_tenant_id: identity?.tenantId ?? null, one_health_user_id: identity?.userId ?? null,
      app_user_id: extra.appUserId ?? null,
    });
  } catch { /* never block sign-in on audit */ }
}
