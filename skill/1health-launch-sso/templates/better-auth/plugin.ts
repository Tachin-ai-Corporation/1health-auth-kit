import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, isAPIError } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";
import { LaunchError, resolveLaunch, type OneHealthIdentity } from "./protocol";

const PROVIDER_ID = "1health";
const PENDING = "oh_pending_link";
const PENDING_TTL_S = 15 * 60;

const LINK_POLICIES = ["auto-link", "confirm-first-link"] as const;
type LinkPolicy = (typeof LINK_POLICIES)[number];
export interface OneHealthOptions {
  linkPolicy?: LinkPolicy;            // default: env ONE_HEALTH_LINK_POLICY or "auto-link"; other values throw at startup
  signInPath?: string;                // default "/sign-in"
  signUpPath?: string;                // default "/sign-up"; may carry a query string (e.g. "/sign-up?invite=open")
  afterLaunchPath?: string;           // default "/"
  onLaunch?: (e: { outcome: "success" | "no_user" | "pending_confirm" | "failure"; reason?: string;
                   env?: string; tenantId?: string; oneHealthUserId?: string; userId?: string }) => Promise<void> | void;
}

export type OneHealthLaunchEvent = Parameters<NonNullable<OneHealthOptions["onLaunch"]>>[0];

const accountIdOf = (i: Pick<OneHealthIdentity, "env" | "tenantId" | "userId">) => `${i.env}:${i.tenantId}:${i.userId}`;

/** Append a query param to a path that may already have a query string. */
const withParam = (path: string, key: string, value: string) =>
  `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;

/** Explicit option, else ONE_HEALTH_LINK_POLICY (empty = unset), else auto-link. Unknown values fail closed: throw. */
function resolvePolicy(option?: string): LinkPolicy {
  const v = option ?? (process.env.ONE_HEALTH_LINK_POLICY?.trim() || "auto-link");
  if (!(LINK_POLICIES as readonly string[]).includes(v))
    throw new Error(`[1health] ONE_HEALTH_LINK_POLICY must be "auto-link" or "confirm-first-link", got "${v}"`);
  return v as LinkPolicy;
}

/** Endpoints that can create a session for an existing account. A pending launch is linked after any of them
 *  succeeds for the matching email. OAuth callbacks are included so social-only accounts can confirm too.
 *  ← Add the sign-in paths of other session-creating plugins the repo uses (passkey, email OTP, …). */
const LINK_ON_PATHS = ["/sign-in", "/sign-up", "/verify-email", "/callback/", "/oauth2/callback/", "/magic-link/verify"];

/** ctx.redirect() throws better-call's APIError("FOUND"), which is NOT `instanceof` the APIError exported by
 *  better-auth/api (different class). isAPIError() recognises both. */
const isRedirect = (e: unknown) => isAPIError(e) && e.status === "FOUND";

export const oneHealth = (opts: OneHealthOptions = {}) => {
  const policy = resolvePolicy(opts.linkPolicy);
  const signIn = opts.signInPath ?? "/sign-in";
  const signUp = opts.signUpPath ?? "/sign-up";
  const home = opts.afterLaunchPath ?? "/";
  const audit = async (e: Parameters<NonNullable<OneHealthOptions["onLaunch"]>>[0]) => {
    try { await opts.onLaunch?.(e); }
    catch (err) { console.warn("[1health] audit hook failed", { error: (err as Error)?.message }); } // never break sign-in
  };

  async function setPending(ctx: any, identity: OneHealthIdentity) {
    const value = JSON.stringify({ ...identity, exp: Date.now() + PENDING_TTL_S * 1000 });
    await ctx.setSignedCookie(PENDING, value, ctx.context.secret, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: PENDING_TTL_S,
    });
  }
  async function readPending(ctx: any): Promise<OneHealthIdentity | null> {
    const raw = await ctx.getSignedCookie(PENDING, ctx.context.secret);
    if (!raw) return null;
    try {
      const v = JSON.parse(raw);
      return v.exp > Date.now() ? (v as OneHealthIdentity) : null;
    } catch { return null; }
  }
  const clearPending = (ctx: any) => ctx.setCookie(PENDING, "", { path: "/", maxAge: 0 });

  async function link(ctx: any, userId: string, identity: OneHealthIdentity) {
    await ctx.context.internalAdapter.linkAccount({ userId, providerId: PROVIDER_ID, accountId: accountIdOf(identity) });
  }

  return {
    id: "one-health",
    endpoints: {
      /** 1health launch URL: GET {baseURL}/api/auth/1health/launch?lpl=… */
      oneHealthLaunch: createAuthEndpoint("/1health/launch", {
        method: "GET",
        query: z.object({ lpl: z.string().optional() }),
      }, async (ctx) => {
        let identity: OneHealthIdentity | undefined;
        try {
          if (!ctx.query.lpl) throw new LaunchError("launch_missing");
          identity = await resolveLaunch(ctx.query.lpl);
          const ia = ctx.context.internalAdapter;

          // 1. Already linked?
          const linked = await ia.findAccountByProviderId(accountIdOf(identity), PROVIDER_ID);
          let user = linked ? await ia.findUserById(linked.userId) : null;

          // 2. Otherwise, match on the verified email.
          if (!user) {
            const found = await ia.findUserByEmail(identity.email, { includeAccounts: true });
            if (found) {
              if (found.accounts.some((a) => a.providerId === PROVIDER_ID))
                throw new LaunchError("identity_conflict");            // email already linked to another 1health user
              // Never auto-link an account whose email isn't verified: whoever registered it chose its password, and
              // that may not be the email's owner (pre-account takeover). Treat it as confirm-first-link: the link
              // happens only after a normal sign-in to that account (which, under requireEmailVerification, means
              // after verifying the email). The plugin never marks an existing account verified.
              if (policy === "confirm-first-link" || !found.user.emailVerified) {
                await setPending(ctx, identity);
                await audit({ outcome: "pending_confirm", reason: found.user.emailVerified ? undefined : "account_unverified",
                              env: identity.env, tenantId: identity.tenantId, oneHealthUserId: identity.userId });
                throw ctx.redirect(withParam(signIn, "source", "1health"));
              }
              await link(ctx, found.user.id, identity);
              user = found.user;
            }
          }

          // 3. No account: registration with the email prefilled.
          if (!user) {
            await setPending(ctx, identity);
            await audit({ outcome: "no_user", env: identity.env, tenantId: identity.tenantId, oneHealthUserId: identity.userId });
            throw ctx.redirect(withParam(signUp, "source", "1health"));
          }

          // 4. Native Better Auth session.
          const session = await ia.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          await audit({ outcome: "success", env: identity.env, tenantId: identity.tenantId, oneHealthUserId: identity.userId, userId: user.id });
          throw ctx.redirect(home);
        } catch (e) {
          if (isRedirect(e)) throw e;                                  // the redirects thrown above
          const code = e instanceof LaunchError ? e.code : "launch_failed";
          // Unexpected (DB, adapter, hook) errors get a friendly page too. Never log lpl, tokens or /myself bodies.
          if (!(e instanceof LaunchError)) console.error("[1health] launch failed", { error: (e as Error)?.message });
          await audit({ outcome: "failure", reason: code, env: identity?.env, tenantId: identity?.tenantId, oneHealthUserId: identity?.userId });
          throw ctx.redirect(withParam(signIn, "error", code));
        }
      }),

      /** Registration page reads the prefill. Never returns tenant/user ids. */
      oneHealthPending: createAuthEndpoint("/1health/pending", { method: "GET" }, async (ctx) => {
        const p = await readPending(ctx);
        if (!p) throw new APIError("NOT_FOUND", { message: "No pending 1health link" });
        return ctx.json({ email: p.email, firstName: p.firstName ?? null, lastName: p.lastName ?? null });
      }),

      /** Create the account for a pending 1health identity, link it, and sign in. */
      oneHealthCompleteRegistration: createAuthEndpoint("/1health/complete-registration", {
        method: "POST",
        body: z.object({ name: z.string().trim().min(1), password: z.string() }),
      }, async (ctx) => {
        const p = await readPending(ctx);
        if (!p) throw new APIError("BAD_REQUEST", { message: "Your 1health launch expired. Launch the app from 1health again." });
        const { password } = ctx.body;
        const { minPasswordLength, maxPasswordLength } = ctx.context.password.config;
        if (password.length < minPasswordLength || password.length > maxPasswordLength)
          throw new APIError("BAD_REQUEST", { message: `Password must be ${minPasswordLength}-${maxPasswordLength} characters.` });

        const ia = ctx.context.internalAdapter;
        if (await ia.findUserByEmail(p.email))
          throw new APIError("BAD_REQUEST", { message: "An account with this email already exists. Sign in instead." });

        // Runs your databaseHooks.user.create (e.g. domain gate, workspace membership). A gate's APIError
        // propagates to the client unchanged, so the registration form can show its message.
        const user = await ia.createUser({ email: p.email, name: ctx.body.name, emailVerified: true });
        await ia.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id,
                               password: await ctx.context.password.hash(password) });
        await link(ctx, user.id, p);

        const session = await ia.createSession(user.id);
        await setSessionCookie(ctx, { session, user });
        clearPending(ctx);
        await audit({ outcome: "success", env: p.env, tenantId: p.tenantId, oneHealthUserId: p.userId, userId: user.id });
        return ctx.json({ redirectTo: home });
      }),
    },

    hooks: {
      after: [{
        // confirm-first-link, unverified matches, and users who register through the normal form during a pending
        // launch: after a successful sign-in, sign-up, email verification or OAuth callback, link the pending
        // 1health identity if the emails match.
        matcher: (ctx) => !!ctx.path && LINK_ON_PATHS.some((p) => ctx.path!.startsWith(p)),
        handler: createAuthMiddleware(async (ctx) => {
          const s = ctx.context.newSession;
          if (!s) return;
          const p = await readPending(ctx);
          if (!p || p.email !== s.user.email.toLowerCase()) return;
          const existing = await ctx.context.internalAdapter.findAccountByProviderId(accountIdOf(p), PROVIDER_ID);
          if (!existing) await link(ctx, s.user.id, p);
          clearPending(ctx);
        }),
      }],
    },
  } satisfies BetterAuthPlugin;
};
