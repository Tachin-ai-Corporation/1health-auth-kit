# 1health Auth Kit

Materials for adding **"launch from 1health" single sign-on** to existing apps.

| Path | What |
|---|---|
| `white-papers/01-supabase-1health-launch-sso.md` | General white paper for Supabase Auth apps (Python FastAPI + TypeScript/Next.js). |
| `white-papers/01a-giggle-gauge-case-study.md` | Internal companion: how the reference implementation was built, and how it differs from the paper. |
| `white-papers/02-better-auth-1health-launch-sso.md` | General white paper for Better Auth apps (Postgres/Neon, Drizzle, Next.js and other Node servers). Its code blocks marked as template copies are checked against the skill templates in CI. |
| `white-papers/02a-carrier-case-study.md` | Internal companion: applying the skill to Carrier, the first live Better Auth integration. What broke, and what live testing showed. |
| `skill/1health-launch-sso/` | Agent skill (`SKILL.md` + references + templates + tests + scripts) that applies the integration to a Supabase or Better Auth repo. |
| `reference/better-auth/` | Runnable verification project. Its code and tests are **symlinks** to the skill templates, with a pinned better-auth. |
| `reference/fastapi/` | Runnable verification project for the FastAPI template (symlinks plus `requirements.txt`). |
| `reference/supabase-next/` | Minimal Next.js + `@supabase/ssr` app on a local Supabase that runs the Supabase templates. Used for live 1health tests. |
| `notes/` | Internal working notes (partner technical reviews). Not for publication. |

## Verification (October 2026)

| Template | Static | Automated tests | Live 1health demo |
|---|---|---|---|
| Protocol module (TS) | tsc, ES6 and ES2022 | 19 unit tests (`reference/better-auth`) | ✅ via Carrier |
| Better Auth plugin (1.6.29) | tsc | 12 e2e tests through `auth.handler` (memory adapter, mocked 1health) | ✅ Carrier (production Next 16 + Neon): auto-link, completed registration, identity conflict, replay, QA-user rejection |
| Supabase + Next.js | tsc against supabase-js 2.118, ssr 0.12, Next 16.3 | — | ✅ `reference/supabase-next` on local Supabase: all six scenarios (auto-link, relaunch, registration, gate rejection, conflict, confirm-first-link) |
| Supabase + FastAPI | py_compile | 34 pytest tests (`reference/fastapi`) | ❌ not yet. The earlier Giggle Gauge build used a different code path (white paper 01a). |

- **Tests guard the bugs found in Carrier.** The Better Auth e2e suite fails 3 tests against the pre-Carrier plugin, and the FastAPI suite fails 5 against the pre-Carrier module.
- **Not yet verified live:**
  - Better Auth: a sign-up gate rejecting a registration, and `confirm-first-link` (both pass in tests, and live on the Supabase app);
  - Supabase: hosted-project settings;
  - FastAPI: anything live.
- **Real launches for local testing** can be captured on the 1health Apps page without spending the code. See `skill/1health-launch-sso/references/testing.md`. Demo API keys always launch as `system_…` users, so they can't test linking.

Run the checks yourself:

```bash
(cd reference/better-auth && npx pnpm@10 install && npx pnpm@10 test && npx pnpm@10 typecheck)
(cd reference/fastapi && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m pytest -q)
(cd reference/supabase-next && npx pnpm@10 install && npx pnpm@10 check-sync && npx pnpm@10 typecheck)
node scripts/check-docs.mjs   # white-paper template copies match; the skill directory references nothing outside itself
```

CI (`.github/workflows/ci.yml`) runs the same four checks on every push and pull request. After changing a template, run
`node scripts/check-docs.mjs --write` to refresh the white papers' copies, and `npx pnpm@10 sync` in `reference/supabase-next`.

## Installing the skill

Copy `skill/1health-launch-sso/` into `~/.claude/skills/`, or into a repo's `.claude/skills/`. Then ask Claude Code to "add 1health launch sign-in to this app".
