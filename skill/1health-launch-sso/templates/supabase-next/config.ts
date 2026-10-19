// lib/one-health/config.ts — paths, policy and secrets shared by the 1health route handlers. ← adapt the paths.
// Call assertOneHealthConfig() from instrumentation.ts so a bad deployment fails at server start with a clear
// message, not on the first launch:
//   export async function register() {
//     if (process.env.NEXT_RUNTIME === "nodejs") (await import("@/lib/one-health/config")).assertOneHealthConfig();
//   }
export const SIGN_IN = "/login";
export const SIGN_UP = "/signup";   // may carry a query string, e.g. "/signup?invite=open"
export const HOME = "/";

const POLICIES = ["auto-link", "confirm-first-link"] as const;
export type LinkPolicy = (typeof POLICIES)[number];

/** ONE_HEALTH_LINK_POLICY; empty or unset = auto-link. An unknown value fails closed: it throws (the launch shows
 *  launch_failed) instead of silently auto-linking. Read per request so `next build` never needs it. */
export function linkPolicy(): LinkPolicy {
  const v = process.env.ONE_HEALTH_LINK_POLICY?.trim() || "auto-link";
  if (!(POLICIES as readonly string[]).includes(v))
    throw new Error(`[1health] ONE_HEALTH_LINK_POLICY must be "auto-link" or "confirm-first-link", got "${v}"`);
  return v as LinkPolicy;
}

/** HS256 key for the pending-link cookie: ONE_HEALTH_LINK_COOKIE_SECRET, 32+ characters (openssl rand -hex 32). */
export function linkCookieKey(): Uint8Array {
  const s = process.env.ONE_HEALTH_LINK_COOKIE_SECRET ?? "";
  if (s.length < 32)
    throw new Error("[1health] ONE_HEALTH_LINK_COOKIE_SECRET must be set to 32+ random characters (openssl rand -hex 32)");
  return new TextEncoder().encode(s);
}

export function assertOneHealthConfig() {
  linkPolicy();
  linkCookieKey();
}

/** Append a query param to a path that may already carry a query string. */
export const withParam = (path: string, key: string, value: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
