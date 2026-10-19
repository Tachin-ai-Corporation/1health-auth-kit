# Case Study: 1health Launch SSO in Carrier (Better Auth + Neon)

**A companion to *Single Sign-On from the 1health App Launcher into a Better Auth App*.**
Version 0.1 (draft), October 2026. Tachin.

Carrier was the first app the `1health-launch-sso` skill was applied to (Phase 2). This document records what the skill got right, what it got wrong, and what only a live launch revealed. The skill, templates and white paper v0.2 already include every fix described here.

---

## 1. Context

- **App:** Carrier, an internal email-campaign tool. Next.js 16.3 App Router, deployed on Vercel. Better Auth 1.6.29 handles email and password sign-in through a `pg` Pool (Better Auth's built-in Kysely path) on Neon, with Drizzle mirroring the schema. Hand-written migrations live in `scripts/00N-*.mjs`. There was no test runner and no ESLint config.
- **Existing gates:**
  - `databaseHooks.user.create.before` only allows emails whose domain is a workspace `signup_domain`.
  - `requireEmailVerification: true` and `autoSignIn: false`.
  - Sign-up was hidden unless `?signup=enabled`. This flag was later removed, since the domain gate is the real control.
  - `requireWorkspacePage` redirects users with no workspace to `/access-pending`, a page that doesn't exist.
- **Registration:** demo External Application **111**. Linking policy `auto-link`. Launch URL `https://carrier-1h.vercel.app/api/auth/1health/launch`.
- **Work:** one agent session applying the skill (October 18–19, 2026), with Neil doing the 1health and Vercel dashboard steps and the tile clicks. PRs `Tachin-ai-Corporation/carrier#2` (integration) and `#3`/`#4` (branding, tachin.ai sign-up domain).

## 2. What the skill got right

- **Stack detection** found every Carrier-specific risk before any code was written: the domain gate, verification, the hidden sign-up, the missing `/access-pending` page, `baseURL` falling back to `VERCEL_URL`, the lack of a proxy, and the migration style.
- **The protocol**, from the HKDF key and payload layout to the HMAC signature, the endpoints and the claim check, worked on the first live call with no changes.
- **The design** held up:
  - no schema change, since links are `account` rows;
  - the pending-link cookie;
  - `internalAdapter.createUser` running the domain-gate hook;
  - `setSessionCookie` before a thrown redirect.
- **Hard rules** kept the launch secret out of git and out of client code. It lived only in `.env.local` and Vercel.

## 3. What the skill got wrong (template bugs)

All of these were found by the adapted e2e test or by the first live launch. All are fixed in the templates.

| # | Bug | Effect | Fix |
|---|---|---|---|
| 1 | The launch endpoint rethrew every non-`LaunchError` | A database or adapter error showed users a raw 500. Troubleshooting listed `launch_failed`, but nothing emitted it. | Map unexpected errors to `?error=launch_failed` and log without secrets |
| 2 | The obvious fix for 1, `e instanceof APIError`, is wrong | `ctx.redirect()` throws **better-call's** `APIError`, a different class from `better-auth/api`'s. Every successful launch became `launch_failed`. | `isAPIError(e) && e.status === "FOUND"` |
| 3 | `` `${signUp}?source=1health` `` | With `signUpPath: "/sign-up?signup=enabled"` (which the skill itself recommended), the URL had two `?` | `withParam` helper |
| 4 | `decodeJwt` and `/myself` `res.json()` unguarded | A non-JWT token or an HTML error page crashed the route | `try`/`catch` mapped to `token_exchange_failed` and `identity_lookup_failed` |
| 5 | Only a non-empty check on `/myself.email` | **Live finding:** demo QA users return `system_1health_carrier-qa-manager` with `emailVerified: true`. The registration form was prefilled with a username. | Require an address, otherwise `identity_no_email` |
| 6 | No timeout on 1health calls | A hung call would hold the serverless function open | `AbortSignal.timeout(10_000)` |

The same bug classes (1, 3, 4, 5) were in the FastAPI template. Its new pytest suite fails 5 tests against the old module. The v0.2 vitest e2e fails 3 tests against the old Better Auth plugin, so the suite now guards these regressions.

## 4. What the skill didn't anticipate (process and environment)

- **Missing direct dependencies.** `zod` was only transitive (via better-auth). Carrier also had no test runner, so the skill had to add vitest. Top-level `await` in the template test failed `tsc` (tsconfig `target: ES6`), and `vi.hoisted` can't reference imports. The fix is env in `setupFiles`.
- **pnpm 11 silently dropped a security override.** It ignores `package.json` `"pnpm".overrides`, and rewrote the lockfile without `hono: 4.12.25`. The fix was to install with `npx pnpm@10` (the lockfile's major) and diff the lockfile for override changes.
- **`vercel link` overwrote `.env.local`** with a Development env pull, losing the launch secret and QA keys. The secret was restored from the session, and the QA keys were re-entered by hand.
- **Vercel env scope.** Vars added in the dashboard were scoped to Production only, so the preview kept returning `payload_invalid` until the Preview scope was added and the preview redeployed.
- **Preview, development and production share one Neon database.** Live testing on the preview wrote to production data. That was acceptable here, with explicit approval.
- **The registered launch URL is production**, which returned 404 until the PR merged. Two techniques worked for testing before merge:
  - **Re-target a real launch.** Click the tile, then swap the origin in the 404 page's address bar for the preview's, keeping `?lpl=…`. The code isn't spent by a 404.
  - **Probe.** Encrypt a well-formed payload with the local secret and a fake code, and send it to a deployment. `token_exchange_failed` proves the secret and the network path. `payload_invalid` shows the env var is missing there. This became `templates/scripts/probe-launch.mjs`.
- **QA keys can't test linking.** Their users have usernames, not emails. The linking and registration scenarios needed real-email demo users: one matching an existing Carrier account, and one new address on an allowed domain.

## 5. Live results (1health demo, October 19, 2026)

| Scenario | Where | Result |
|---|---|---|
| Fake-code probe, real secret | Local dev, preview, production | `token_exchange_failed` (configured) |
| QA manager launch (minted) | Preview | Full handshake. Prefilled registration with a username. This led to fix 5. |
| Reload a used launch | Preview | `token_exchange_failed` with the "launch again" copy |
| QA employee launch after fix 5 | Preview | `identity_no_email` with the new copy |
| Existing verified user, real tile click, re-targeted | Preview | **Auto-linked (`demo:4:315987`) and signed in.** Link and session rows written 10 ms apart. |
| Linked user, real tile click | Production | Signed in silently (audit `success`) |
| Unknown user (new address on an allowed domain) | Production | Prefilled registration (audit `no_user`) |
| Same user completes registration | Production | ✅ Account created and verified, credential + 1health link (`demo:55911:…`), joined the workspace through the sign-up hook, and signed in |
| Email already linked to a different 1health user (link swapped to a fake ID for one launch, then restored) | Production | ✅ `identity_conflict` page, no session. After the restore, the next launch signed in silently. |

The real launches above were captured on the 1health Apps page (`window.open` override) and replayed. API keys can't stand in for people: every key launches as its own `system_…` user.

Not tested live **in Carrier**:
- the sign-up gate rejecting a registration (all of Neil's demo users are on an allowed domain);
- `confirm-first-link` (it would need a production config change).

Both pass in the e2e suite, and both passed live in the Supabase reference app (`reference/supabase-next/README.md`).

## 6. Takeaway

The protocol and plugin design were sound. Most of the time went on two things:
- the template's error handling, which is now fixed and guarded by tests;
- the environment: package manager versions, Vercel env scopes, testing before merge, and QA identities.

The skill now carries that guidance (SKILL.md §1, §5 and §6; `references/troubleshooting.md`). It should be validated next on a Supabase app.
