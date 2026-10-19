# Supabase + Next.js reference app

A minimal Next.js 16 app using `@supabase/ssr` cookie sessions on a **local** Supabase. It runs the skill's Supabase
templates as shipped. `lib/one-health/*` and `components/OneHealthRegistration.tsx` are copied from
`skill/1health-launch-sso/templates/` by `pnpm sync`, and `pnpm check-sync` fails if they drift. (They're copied, not
symlinked, because Next/Turbopack resolve symlinks to their real path, where this app's `node_modules` isn't visible.)

The schema mirrors a typical repo:
- a `profiles` table filled by an `auth.users` trigger;
- a sign-up gate trigger (`allowed_signup_domains`);
- the skill's migration (`supabase/migrations/…_one_health.sql`, which is a symlink to `templates/sql/supabase.sql`).

## Run

```bash
# once: Docker (e.g. `brew install colima docker && colima start`) and the Supabase CLI
cd reference/supabase-next
supabase start -x edge-runtime,logflare,vector,imgproxy,storage-api,realtime,studio,postgres-meta,supavisor
npx pnpm@10 install
# .env.local (gitignored): NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
#   (from `supabase status -o env`), ONE_HEALTH_LINK_COOKIE_SECRET (openssl rand -hex 32), ONE_HEALTH_DEMO_APP_ID,
#   ONE_HEALTH_DEMO_LAUNCH_SECRET, TEST_USER_PASSWORD (any generated value; local only)
npx pnpm@10 dev          # http://localhost:3001 ; launch URL http://localhost:3001/1health/launch
node --env-file=.env.local ../../skill/1health-launch-sso/templates/scripts/probe-launch.mjs http://localhost:3001/1health/launch
node --env-file=.env.local scripts/seed-test-user.mjs <email> [--unlink | --link env:tenant:user]
```

## Getting real launches for a local app

1health only launches the registered URL, and that host spends the one-time code. To use a real person's launch here,
capture it on the 1health **Apps** page before it opens. Run this in that tab's DevTools console, then click the tile:

```js
window.open = (u) => { console.log(String(u).replace(/^https:\/\/[^/]+\/[^?]+/, "http://localhost:3001/1health/launch")); return { close() {} }; };
```

The tile does nothing, and the console prints a working local launch URL. Open it within a few minutes. (The general
procedure, for any target, is in the skill's `references/testing.md`.) (Demo API keys
can't do this: every key launches as its own `system_…` user with no real email, so they only reach `identity_no_email`.)

## Live results (1health demo, October 19, 2026)

These used a real demo user (tenant 4, verified email) through the capture above, with each scenario's state set
using `seed-test-user.mjs`.

| # | Scenario | Result |
|---|---|---|
| 1 | Existing unlinked user | ✅ Linked (`demo:4:…`) and signed in. The session reads `profiles` through RLS. |
| 2 | Relaunch, linked | ✅ Silent sign-in |
| 3 | Unknown user → prefilled registration (name from 1health) | ✅ Created with `email_confirm`; profile trigger ran; linked and signed in |
| 4 | Unknown user blocked by the sign-up gate | ✅ After a template fix: the form shows "Account creation is not available…". Supabase reports trigger rejections as a 500 "Database error creating new user"; the template showed "Registration failed." before. |
| 5 | Email linked to a different 1health user | ✅ `identity_conflict`, no session |
| 6 | `confirm-first-link` | ✅ Sign-in page with notice → password sign-in → `confirm-link` linked → next launch silent |
| — | Probe / QA-key launch / replay | ✅ `token_exchange_failed` / `identity_no_email` / `token_exchange_failed` |
| — | Email sent while minting sessions | ✅ none (Mailpit: 0 messages) |

Not covered: hosted Supabase settings (Site URL, redirect allow-list, asymmetric JWT keys), and MFA step-up.
