# Better Auth recipe

Templates: `templates/ts/protocol.ts`, `templates/better-auth/plugin.ts`, `templates/shared/OneHealthRegistration.tsx`, `templates/shared/messages.ts`, `templates/tests/one-health/better-auth-e2e.test.ts` (+ `protocol.test.ts`, `helpers.ts`, `../setup-env.ts`), `templates/scripts/probe-launch.mjs`, `templates/scripts/mint-qa-launch.mjs`.

These were verified on **better-auth 1.6.29**:
- They type-check, and the vitest suite passes: 31 tests across the protocol module and the plugin through `auth.handler` with the memory adapter and mocked 1health.
- They ran **live against 1health demo** in Carrier (Next 16.3, `pg` Pool, Neon) in October 2026. Verified: an existing user was auto-linked and signed in from a real tile click; replay gave `token_exchange_failed`; QA users gave `identity_no_email`; an unknown user got the prefilled registration.

## Why a plugin, not `genericOAuth` / `sso`

1health starts the launch and never sends an OAuth `code` to a callback. The OAuth plugins expect to start the flow themselves, so they don't fit. A plugin endpoint runs inside Better Auth's context and can use the same primitives the built-in sign-in routes use.

## Endpoints (under `basePath`, default `/api/auth`)

- `GET /1health/launch?lpl=…`: the URL to register in 1health, `{BETTER_AUTH_URL}/api/auth/1health/launch`.
- `GET /1health/pending`: `{email, firstName, lastName}` from the signed pending cookie, or 404.
- `POST /1health/complete-registration {name, password}`: creates the user, the credential account and the 1health link, then signs the user in.
- `hooks.after` on `/sign-in*`, `/sign-up*`, `/verify-email*`: if a pending cookie matches `ctx.context.newSession.user.email`, it links the account. This is how confirm-first-link works, and it also covers users who register through the normal form during a pending launch.

## Internal API map (1.6)

| Purpose | Call |
|---|---|
| Linked identity | `internalAdapter.findAccountByProviderId(accountId, "1health")`, where `accountId = "<env>:<tenantId>:<userId>"` |
| Email match | `internalAdapter.findUserByEmail(email, { includeAccounts: true })` |
| Link | `internalAdapter.linkAccount({ userId, providerId: "1health", accountId })` |
| Mark verified | `internalAdapter.updateUser(id, { emailVerified: true })` |
| Create user | `internalAdapter.createUser({ email, name, emailVerified: true })`. This **runs `databaseHooks.user.create`**. |
| Password | `ctx.context.password.hash(pw)` + `linkAccount({ providerId: "credential", accountId: user.id, password })`. Limits come from `ctx.context.password.config.{min,max}PasswordLength`. |
| Session | `internalAdapter.createSession(userId)` then `setSessionCookie(ctx, { session, user })` (from `better-auth/cookies`), then `throw ctx.redirect(path)`. Cookies survive the thrown redirect. |
| Signed cookie | `ctx.setSignedCookie(name, value, ctx.context.secret, attrs)` / `ctx.getSignedCookie(name, ctx.context.secret)` |

If the repo isn't on 1.6.x, read `node_modules/@better-auth/core/dist/types/context.d.mts` and adjust. In particular, older 1.x versions have `createSession(userId, ctx, dontRememberMe)`. Pin the minor version in `package.json` if it uses `^`, or note in docs that upgrades need the e2e test re-run.

## No schema change

Links are `account` rows with `providerId = "1health"`. `password`, `accessToken` and `refreshToken` stay NULL. A unique index on `("providerId","accountId")` is optional but good practice. The audit table is optional: `templates/sql/better-auth-audit.sql`.

## Repo checks (do these during detection)

- **`databaseHooks.user.create.before`** (domain gates, invite lists) also applies to 1health registrations. Make sure `complete-registration` errors reach the UI. If the product wants 1health users to bypass the gate, that's a product decision: ask, and don't change the gate yourself.
- **`databaseHooks.user.create.after`** (for example, adding workspace or organization membership) runs as usual.
- **`requireEmailVerification`**: plugin sessions skip the email/password check. The plugin sets `emailVerified: true` on link because 1health verified the email. Under confirm-first-link, the normal sign-in still enforces verification.
- **Sign-up hidden behind a flag** (for example `?signup=enabled`): set `signUpPath` to a URL that shows the form.
- **Missing pages referenced by redirects**, such as an "access pending" page: call them out. Don't silently create product pages.
- **`baseURL`**: set `BETTER_AUTH_URL` explicitly. Registered launch URLs must be on a stable production origin, not on preview or `VERCEL_URL` deployments.
- **`proxy.ts` / `middleware.ts` matchers** must not intercept `/api/auth/1health/*`.
- **`plugins` order**: `nextCookies()` last, **if the repo uses it**. Repos that sign in from the client with `authClient` often don't, and don't need it for this plugin.
- **Redirect detection**: `ctx.redirect()` throws better-call's `APIError`, a different class from `better-auth/api`'s `APIError`, so `instanceof` is false. Use `isAPIError(e) && e.status === "FOUND"` (exported by `better-auth/api` 1.6).
- **`signUpPath` with a query** (`/sign-up?signup=enabled`): supported. The plugin appends `&source=1health`.
- **Dependencies**: `zod` must be a direct dependency (it's often only transitive), and so must `jose`.
- **Runtime**: Node. No `runtime = "edge"` on the auth route (the code uses `node:crypto`).
- **Rate limit**: `rateLimit.customRules: { "/1health/launch": { window: 60, max: 10 }, "/1health/complete-registration": { window: 60, max: 5 } }`.
- **Neon**: use the pooled URL at runtime and the unpooled URL for migrations. A `pg` Pool, `drizzleAdapter` or the serverless driver all work, since the plugin only touches `internalAdapter`.

## Non-Next servers

Hono: `app.on(["GET","POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`. Express: `app.all("/api/auth/*", toNodeHandler(auth))` from `better-auth/node`, mounted **before** `express.json()`. The plugin and protocol module don't change.
