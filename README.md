# 1health Auth Kit

Materials for adding **"launch from 1health" single sign-on** to existing apps.

| Path | What |
|---|---|
| `white-papers/01-supabase-1health-launch-sso.md` | General white paper for Supabase Auth apps (Python FastAPI + TypeScript/Next.js). |
| `white-papers/01a-giggle-gauge-case-study.md` | Internal companion: how the reference implementation was built, and how it differs from the paper. |
| `white-papers/02-better-auth-1health-launch-sso.md` | General white paper for Better Auth apps (Postgres/Neon, Drizzle, Next.js and other Node servers). Its code is identical to the skill templates. |
| `white-papers/02a-carrier-case-study.md` | Internal companion: applying the skill to Carrier, the first live Better Auth integration. What broke, and what live testing showed. |
| `skill/1health-launch-sso/` | Agent skill (`SKILL.md` + references + templates + tests + scripts) that applies the integration to a Supabase or Better Auth repo. |
| `reference/better-auth/` | Runnable verification project. Its code and tests are **symlinks** to the skill templates, with a pinned better-auth. |
| `reference/fastapi/` | Runnable verification project for the FastAPI template (symlinks plus `requirements.txt`). |
| `notes/` | Internal working notes (partner technical reviews). Not for publication. |

## Verification (October 2026)

| Template | Static | Automated tests | Live 1health demo |
|---|---|---|---|
| Protocol module (TS) | tsc, ES6 and ES2022 | 19 unit tests (`reference/better-auth`) | ✅ via Carrier |
| Better Auth plugin (1.6.29) | tsc | 12 e2e tests through `auth.handler` (memory adapter, mocked 1health) | ✅ Carrier, a production Next 16 + Neon app: auto-link sign-in, prefilled registration, replay rejection, QA-user rejection |
| Supabase + Next.js | tsc against supabase-js 2.118, ssr 0.12, Next 16.3 | none | ❌ not yet |
| Supabase + FastAPI | py_compile | 14 pytest tests (`reference/fastapi`) | ❌ not yet. The earlier Giggle Gauge build used a different code path (white paper 01a). |

- **Tests guard the bugs found in Carrier.** The Better Auth e2e suite fails 3 tests against the pre-Carrier plugin, and the FastAPI suite fails 5 against the pre-Carrier module.
- **Not yet verified live** for Better Auth: completing a registration, a sign-up gate rejecting it, `identity_conflict`, and `confirm-first-link`. These need demo users with real emails.
- **Supabase:** nothing has run against live 1health yet. The next validation target is a Supabase app.

Run the checks yourself:

```bash
cd reference/better-auth && npx pnpm@10 install && npx pnpm@10 test && npx pnpm@10 typecheck
cd reference/fastapi && pip install -r requirements.txt && pytest -q
```

## Installing the skill

Copy `skill/1health-launch-sso/` into `~/.claude/skills/`, or into a repo's `.claude/skills/`. Then ask Claude Code to "add 1health launch sign-in to this app".
