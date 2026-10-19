---
name: 1health-launch-sso
description: Add "launch from 1health" single sign-on to an existing web app whose users authenticate with Supabase Auth or Better Auth. When a 1health user opens the app from the 1health Apps screen, they are signed in automatically if their verified email matches an account; otherwise they get a prefilled registration that links the accounts. Use when the user asks to integrate 1health login, the 1health app launcher, 1health SSO, a 1health launch payload (lpl), or "sign in from 1health" into a repo.
---

# 1health launch SSO

You are adding 1health app-launch sign-in to an **existing** app without changing how its current users sign in. The 1health handshake is fixed (see `references/protocol.md`). What varies is how the app creates its *own native session* once the 1health identity is verified, and that depends on the auth stack.

Supported stacks:

| Auth | Server | Template set |
|---|---|---|
| Better Auth | Next.js (App Router), Hono, Express, Fastify, or any Node server that mounts `auth.handler` | `templates/better-auth/` + `templates/ts/protocol.ts` |
| Supabase Auth | Next.js with `@supabase/ssr` (cookie sessions) | `templates/supabase-next/` + `templates/ts/protocol.ts` |
| Supabase Auth | Python FastAPI (supabase-py), sessions held in the browser | `templates/supabase-fastapi/` |

**How well each set is proven (Oct 2026).**
- **Better Auth:** live-verified against 1health demo in a production app.
- **Supabase + FastAPI:** unit-tested, but not live with these templates.
- **Supabase + Next.js:** type-checked only, not live.

On a Supabase repo, treat the integration as the first live validation. Probe each deployment, test live before merging (§6), and expect to report fixes back.

For any other stack, stop and tell the user it isn't supported yet. Point them to `references/protocol.md` and explain the one stack-specific question they need to answer: *how do I create a native session for an existing user from the server?*

## Hard rules

- **Never** write secret values into tracked files, commit them, print them back, or put them in `NEXT_PUBLIC_*` or client code. Write them only to the untracked env file the user names (check `.gitignore` first), or tell the user which variables to set in their hosting provider.
- **Never** hand-make session tokens (custom JWTs). Use the stack's own session primitives (§4).
- **Never** add a fallback that creates a session with elevated or service-role privileges if the native session fails. Fail closed.
- 1health access and refresh tokens **stay on the server** and are discarded after the identity is resolved, unless the user explicitly needs 1health API calls on behalf of the user. In that case, store them encrypted server-side and ask before adding that.
- Don't change the app's existing sign-in or sign-up behavior for non-1health users.
- Keep the change minimal and match the repo's conventions: file layout, naming, error handling, migration style.
- **Install with the package manager version the lockfile was made with.** For example, pnpm 11 ignores `package.json` `"pnpm".overrides` and silently rewrites the lockfile, which can drop security pins. Use `npx pnpm@<major>` when the global one differs. Then diff the lockfile and check that no `overrides` changed before committing.
- **Don't run commands that rewrite the user's env files.** `vercel link` (CLI 50+) and `vercel env pull` overwrite `.env.local`. Pull into a separate file (`vercel env pull .env.vercel.local`), and back up `.env.local` first.

## Workflow

Track these steps with your task list.

### 1. Detect the stack

Read `package.json` / `pnpm-lock.yaml` / `requirements*.txt` / `pyproject.toml` and the auth setup. Record:

- **Auth library and version.** `better-auth`, `@supabase/supabase-js`, `@supabase/ssr`, `supabase` (Python). For Better Auth, the internal-adapter signatures in this skill are verified for **1.6.x**. If the version is different, read `node_modules/@better-auth/core/dist/types/context.d.mts` and adapt `createSession` and friends.
- **Framework and router.** Next.js version (check `node_modules/next/package.json`; Next 16 renamed `middleware.ts` to `proxy.ts`), Hono, Express, FastAPI.
- **Where sessions live.** Better Auth: always cookies. Supabase: cookies via `@supabase/ssr`, or browser storage via supabase-js / a custom `localStorage` token. Find out which by reading the existing login code.
- **User table and email lookup.** Better Auth: built-in. Supabase: is there a `profiles`/`users` table mirroring `auth.users.email`?
- **Sign-up gates.** Better Auth `databaseHooks.user.create.before`, invite-only flags, domain allow-lists, `requireEmailVerification`; Supabase "Confirm email". Note them, because they also apply to 1health registrations.
- **Route protection.** `proxy.ts`/`middleware.ts` matchers, layout guards, FastAPI dependencies. The launch routes must stay reachable when the user is signed out.
- **Base URL / origin config.** `BETTER_AUTH_URL`, `baseURL`, `trustedOrigins`, `ALLOWED_HOSTS` / `TrustedHostMiddleware`.
- **Migration style.** drizzle-kit, Supabase migrations folder, or hand-written SQL scripts.
- **Test runner.** vitest, jest, pytest, or none. If there's none, you'll add vitest (§5). Note the tsconfig `target`: below ES2017, top-level `await` in tests fails `tsc`.
- **Dependencies the templates import.** `jose`, and for Better Auth also `zod`. These are often only transitive (zod comes in through better-auth), so add them as direct dependencies.
- **Sign-in and sign-up page paths**, including any query flag that sign-up needs to render (`?signup=enabled`, `?invite=…`). The plugin and routes append `source=1health` correctly to a path that already has a query.

Summarize what you found for the user in a few lines before changing anything.

### 2. Gather inputs

Ask the user for anything you can't read from the repo, in one message:

1. **Which 1health environments.** Demo (`https://demo.1health.io`), production (`https://app.1health.io`), or both.
2. For each environment:
   - the **External Application ID**;
   - the **launch secret** (the API key assigned to the app). Ask the user to put it into the env file or hosting secrets themselves, or to paste it only if they're comfortable. You only need the **variable names** to write code.
3. The **production origin** the launch URL will use, e.g. `https://app.example.com`.
4. **Linking policy:**
   - `auto-link` (default): sign in immediately on a verified email match.
   - `confirm-first-link`: the first time, the user signs in to the app once, and after that it's silent. Recommend this for regulated or professional apps, or whenever "an email match alone must not merge accounts".
5. Optional **tenant allow-list** (`demo:<tenantId>,prod:<tenantId>`).
6. Whether an **audit table** is wanted (default yes).
7. **For live testing:** demo QA user API keys if they have them (they go into `.env.local` only), and whether they can launch as a demo user with a **real, verified email**. QA users often have a username instead of an email, so they can't test linking.

If the user doesn't have an app registration yet, give them `references/1health-setup.md` and continue with placeholder variable names.

### 3. Plan

Show a short plan:

- files to add, files to modify;
- env vars;
- the migration, if any;
- manual dashboard steps;
- repo-specific risks you found in step 1, such as a sign-up domain gate rejecting 1health users, a proxy matcher blocking `/api/auth/1health/*`, a redirect to a page that doesn't exist, or Supabase Site URL still set to `localhost`;
- **how the change will be tested before it reaches production.** The launch URL registered in 1health points at production, which doesn't have the code until merge (§6).

Then proceed. Ask only if a real choice remains.

### 4. Implement

Use the templates as the starting point. Adapt imports, paths and conventions to the repo.

**Better Auth** (`references/better-auth.md`):

1. Copy `templates/ts/protocol.ts` to `lib/one-health/protocol.ts`.
2. Copy `templates/better-auth/plugin.ts` to `lib/one-health/plugin.ts`.
3. Register `oneHealth({ signInPath, signUpPath, afterLaunchPath, onLaunch })` in the `betterAuth({ plugins: [...] })` call. If the repo uses `nextCookies()`, put it before that; if not, don't add it. Add `rateLimit.customRules` for `/1health/launch` and `/1health/complete-registration`.
4. The existing catch-all auth route already serves the new endpoints. No new route file is needed.
5. Registration UI: add `templates/better-auth/OneHealthRegistration.tsx` (adapt it to the repo's form components) to the sign-up page when `?source=1health` is present. If sign-up is hidden behind a query flag, set `signUpPath` to a URL that shows the form.
6. Sign-in page: show friendly text for `?error=<code>` and `?source=1health`. Copy is in `references/troubleshooting.md`.
7. No schema change is needed: links live in `account` (`providerId = "1health"`). Optionally add a unique index on `(providerId, accountId)` and the audit table (`templates/sql/better-auth-audit.sql`, plus a Drizzle table if the repo mirrors its schema in Drizzle).
8. Add `jose` (it decodes the token without verifying) and `zod` (the plugin's request schemas) as direct dependencies, unless they already are.
9. Don't change how the plugin template detects redirects or maps errors. `ctx.redirect()` throws better-call's `APIError`, which is **not** `instanceof` the `APIError` from `better-auth/api`. The template uses `isAPIError(e) && e.status === "FOUND"` and maps every other unexpected error to `?error=launch_failed`. The e2e test guards this.

**Supabase + Next.js** (`references/supabase.md`):

1. Copy `templates/ts/protocol.ts` to `lib/one-health/protocol.ts`.
2. Copy and adapt `templates/supabase-next/`: `session.ts`, `pending-cookie.ts`, `users.ts`, and route handlers `app/1health/launch/route.ts`, `app/1health/pending/route.ts`, `app/1health/complete-registration/route.ts`.
3. Run the migration `templates/sql/supabase.sql` (identity columns or table, audit table, email lookup function) in the repo's migration style.
4. Registration UI as above, posting to `/1health/complete-registration`.
5. The launch URL is `{origin}/1health/launch`.

**Supabase + FastAPI** (`references/supabase.md`):

1. Copy `templates/supabase-fastapi/one_health.py` into the app's package. Wire its settings to the repo's settings module, and mount the router.
2. Run `templates/sql/supabase.sql`.
3. Frontend boot code: if the URL fragment contains `access_token` and `refresh_token` with `type=magiclink`, store them the way the app stores its session today, then call `history.replaceState` to clear the fragment. Registration UI as above.
4. Add the launch host to `ALLOWED_HOSTS` / `TrustedHostMiddleware` if present.

**All stacks.**

- Add the env var **names** to `.env.example` (no values).
- Add a short `docs/1health-sso.md` covering how it works, the env vars, the dashboard steps, and how to test.
- Copy `templates/scripts/mint-qa-launch.mjs` and `templates/scripts/probe-launch.mjs` into `scripts/`.

### 5. Test

- **Test runner.** Use the repo's runner. If there is none, add vitest with `templates/tests/vitest.config.mts`, and add `"test": "vitest run"`. Set env in `setupFiles` (`templates/tests/setup-env.ts`), because the protocol module reads env at import time.
- **Protocol unit tests:** `templates/tests/one-health/protocol.test.ts` (vitest; jest is near-identical) or `templates/tests/test_one_health.py` (pytest, FastAPI). They cover:
  - the decrypt round-trip and environment detection;
  - a fixed HMAC vector;
  - every `LaunchError` path, including a non-JWT token, a non-JSON or non-object `/myself`, a username in the email field, network failures and timeouts.
- **Better Auth e2e:** `templates/tests/one-health/better-auth-e2e.test.ts` drives the real plugin through `auth.handler` with the memory adapter and mocked 1health. **Adapt `makeAuth()` to mirror the repo's `lib/auth.ts`**: its sign-up gates, `requireEmailVerification`, `autoSignIn` and the exact plugin options (including a `signUpPath` that carries a query). Keep every scenario:
  - existing user;
  - relaunch;
  - linked identity wins after an email change;
  - unknown user → registration, with the email taken from the signed cookie;
  - gate rejection message reaches the form;
  - password and expired-cookie errors;
  - conflict;
  - bad payloads;
  - single-use replay;
  - normal sign-up unchanged;
  - confirm-first-link;
  - a database failure gives `launch_failed`, not a 500.
- Run the repo's type-check, lint and test commands. Fix anything you broke. If lint can't run (no config), say so; don't add a lint setup.

### 6. Hand off

Tell the user exactly what remains for them, step by step and in plain words. Use `references/1health-setup.md` for the 1health steps.

1. **1health:** register or confirm the External Application. Set the launch URL, assign the secret, set it Active, use a role that can see Apps, and upload an icon (PNG, SVG or WebP; at most 512×512 and 500 KB).
2. **Auth provider dashboard** (Supabase only): Email provider on, Site URL, Redirect URLs.
3. **Hosting:** set the env vars for **every environment that will receive launches**. On Vercel, a var added for Production isn't visible to Preview until you add that scope, and either way only deployments made after the change pick it up. Set the base URL var (`BETTER_AUTH_URL`) to the stable production origin. Keep `lpl` out of logs.
4. **Migration:** run it with the unpooled connection string. Note that preview and dev deployments often share the production database.
5. **Verify each deployment's configuration** with `node --env-file=.env.local scripts/probe-launch.mjs <launchUrl>`. `token_exchange_failed` means it's configured. `payload_invalid` means the secret is missing or wrong there.
6. **Live test before merge.** Production doesn't serve the new route yet, so the 1health tile gives a 404 there. Either:
   - mint a launch for the preview with `scripts/mint-qa-launch.mjs <previewLaunchUrl>`; or
   - click the tile, then replace the origin in the 404 page's address bar with the preview's origin, keeping the path and `?lpl=…`, and press Enter within a few minutes. The code hasn't been spent.

   Demo QA users may return a **username** in `/myself.email`. They only exercise the error paths (`identity_no_email`). Link and registration scenarios need a demo user with a real, verified email: one matching an existing app user, and one new.
7. **After merge:** click the tile on production and run the scenario matrix in `references/troubleshooting.md`.

Report what you changed, what you tested, and what you could **not** verify (for example, no live 1health launch from the sandbox). Then ask before you push, merge or deploy.

Also list every **skill gap** you hit (a template you had to fix, a step that was missing or wrong), with the fix, so the skill can be improved. Template bugs found in one repo are usually in the other stacks' templates too.

## References

- `references/protocol.md`: launch payload, crypto, endpoints, claims, environments, documentation discrepancies.
- `references/better-auth.md`: plugin design, internal-adapter API map, gotchas.
- `references/supabase.md`: session minting (`generateLink` + `verifyOtp`), delivery by session model, gotchas.
- `references/security.md`: checklist and residual risks (login CSRF).
- `references/1health-setup.md`: 1health-side registration, roles, QA keys.
- `references/troubleshooting.md`: error codes, user-facing copy, scenario matrix.
