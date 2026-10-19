// 1health launch handshake: encrypted `lpl` payload → one-time-code redemption → /api/v2/user/myself.
// Framework-independent; every failure is a LaunchError with a stable code (see references/troubleshooting.md).
import { createDecipheriv, createHmac, hkdfSync } from "node:crypto";
import { decodeJwt } from "jose";

export const ENVIRONMENTS = {
  demo: { base: "https://demo.1health.io", secret: process.env.ONE_HEALTH_DEMO_LAUNCH_SECRET, appId: process.env.ONE_HEALTH_DEMO_APP_ID },
  prod: { base: "https://app.1health.io",  secret: process.env.ONE_HEALTH_PROD_LAUNCH_SECRET, appId: process.env.ONE_HEALTH_PROD_APP_ID },
} as const;
export type OneHealthEnv = keyof typeof ENVIRONMENTS;

export class LaunchError extends Error {
  constructor(public code: string) { super(code); }
}

export interface OneHealthIdentity {
  env: OneHealthEnv; tenantId: string; userId: string; email: string;
  firstName?: string; lastName?: string;
}

const TIMEOUT_MS = 10_000;  // a hung 1health call must not hold the function open until the platform kills it
// /myself can return a username in `email` with emailVerified: true (observed for demo QA/system users).
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const deriveKey = (secret: string) =>
  Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.alloc(0), 32));

/** Decrypt the payload; the environment is whichever configured secret authenticates it. */
export function decryptLaunchPayload(lpl: string) {
  const raw = Buffer.from(lpl, "base64");
  if (raw.length < 28) throw new LaunchError("payload_invalid");
  const iv = raw.subarray(0, 12), tag = raw.subarray(raw.length - 16), ct = raw.subarray(12, raw.length - 16);
  for (const env of Object.keys(ENVIRONMENTS) as OneHealthEnv[]) {
    const secret = ENVIRONMENTS[env].secret;
    if (!secret) continue;
    let data: any;
    try {
      const d = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
      d.setAuthTag(tag);
      data = JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString("utf8"));
    } catch { continue; }
    const r = data?.required, code = r?.oneTimeCode?.value;
    if (typeof code !== "string" || !/^[A-Za-z0-9]{16}$/.test(code) || r?.tenant?.id == null || r?.user?.id == null)
      throw new LaunchError("payload_invalid");
    return { env, tenantId: String(r.tenant.id), userId: String(r.user.id), code,
             optional: (data.optional ?? {}) as Record<string, string | undefined> };
  }
  throw new LaunchError("payload_invalid");
}

/** fetch with a timeout; network errors and timeouts become `code`. */
async function call(url: string, init: RequestInit, code: string) {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new LaunchError(code);
  }
}

export async function redeemOneTimeCode(env: OneHealthEnv, code: string) {
  const { base, secret } = ENVIRONMENTS[env];
  // HMAC uses the RAW launch secret, not the HKDF-derived key.
  const signature = createHmac("sha256", secret!).update(code, "utf8").digest("base64");
  const res = await call(`${base}/api/v2/public/external-application/auth/oauth2/user/token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ securityCode: code, signature }),
  }, "token_exchange_failed");
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.access_token !== "string") throw new LaunchError("token_exchange_failed");
  return body as { access_token: string; refresh_token?: string; expires_in: number };
}

function tenantAllowed(env: OneHealthEnv, tenantId: string) {
  const list = process.env.ONE_HEALTH_ALLOWED_TENANT_IDS?.split(",").map((s) => s.trim()).filter(Boolean);
  return !list?.length || list.includes(`${env}:${tenantId}`);
}

/** Full launch → verified identity. 1health tokens are discarded when this returns. */
export async function resolveLaunch(lpl: string): Promise<OneHealthIdentity> {
  const launch = decryptLaunchPayload(lpl);
  const { access_token } = await redeemOneTimeCode(launch.env, launch.code);
  const { base, appId } = ENVIRONMENTS[launch.env];

  // Read the plain-text claim without checking the signature: /myself below proves the token is genuine.
  let claims: Record<string, unknown>;
  try { claims = decodeJwt(access_token); } catch { throw new LaunchError("token_exchange_failed"); }
  if (String(claims.externalApplicationId) !== String(appId)) throw new LaunchError("wrong_application");

  const res = await call(`${base}/api/v2/user/myself`, {
    headers: { Authorization: `Bearer ${access_token}` },
  }, "identity_lookup_failed");
  if (!res.ok) throw new LaunchError("identity_lookup_failed");
  const me = await res.json().catch(() => null);
  if (!me || typeof me !== "object") throw new LaunchError("identity_lookup_failed");
  const email = String(me.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new LaunchError("identity_no_email");
  if (me.emailVerified !== true) throw new LaunchError("email_not_verified");
  if (!tenantAllowed(launch.env, launch.tenantId)) throw new LaunchError("tenant_not_allowed");

  return {
    env: launch.env, tenantId: launch.tenantId, userId: launch.userId, email,
    firstName: launch.optional.user_first_name ?? me.firstName ?? undefined,
    lastName:  launch.optional.user_last_name  ?? me.lastName  ?? undefined,
  };
}
