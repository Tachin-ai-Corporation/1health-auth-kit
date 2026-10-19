# Configuration: environment variables and default paths

## Environment variables (all stacks)

Put the **names** in `.env.example` with no values. Values go in the untracked env file or the hosting provider's secrets, never in tracked files or `NEXT_PUBLIC_*`.

| Variable | Stacks | Secret | Required | Notes |
|---|---|---|---|---|
| `ONE_HEALTH_DEMO_APP_ID` | all | no | if demo is used | External Application ID on `https://demo.1health.io`. Checked against the token's `externalApplicationId`. |
| `ONE_HEALTH_DEMO_LAUNCH_SECRET` | all | **yes** | if demo is used | The API key assigned to the app on demo. Decrypts `lpl` and signs the code redemption. |
| `ONE_HEALTH_PROD_APP_ID` | all | no | if production is used | Same, for `https://app.1health.io`. |
| `ONE_HEALTH_PROD_LAUNCH_SECRET` | all | **yes** | if production is used | Same, for production. Set only the environments you use. |
| `ONE_HEALTH_LINK_POLICY` | all | no | no | `auto-link` (default; also when empty) or `confirm-first-link`. Any other value is a startup error (fails closed). Better Auth: the plugin's `linkPolicy` option wins over it. |
| `ONE_HEALTH_ALLOWED_TENANT_IDS` | all | no | no | Comma-separated `<env>:<tenantId>` allow-list, e.g. `demo:4,prod:123`. Empty means every tenant. |
| `ONE_HEALTH_LINK_COOKIE_SECRET` | Supabase (Next, FastAPI) | **yes** | yes | 32+ random characters (`openssl rand -hex 32`); shorter or missing fails at startup (FastAPI) or via `assertOneHealthConfig()` in `instrumentation.ts` (Next). Signs the pending-link cookie. Better Auth signs it with `BETTER_AUTH_SECRET` instead. |
| `ONE_HEALTH_APP_ORIGIN` | FastAPI | no | only for split origins | The SPA's origin when it differs from the API's, e.g. `https://app.example.com`. Redirects go there. |
| `ONE_HEALTH_QA_<ROLE>_KEY` (or `ONE_HEALTH_QA_KEY`) | scripts | **yes** | no | Demo QA user API keys for `scripts/mint-qa-launch.mjs` (`<ROLE>`: `MANAGER`, `EMPLOYEE`, `SYS_ADMIN`). **Local `.env.local` only, never production or hosting.** |

The 1health base URLs are constants in the templates, not configuration.

### Each stack's own variables (usually already set)

| Stack | Variables the templates read |
|---|---|
| Better Auth | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (set it to the stable production origin), and the repo's database URL |
| Supabase + Next.js | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable), `SUPABASE_SERVICE_ROLE_KEY` (secret, server only). `SUPABASE_URL` is optional and wins over `NEXT_PUBLIC_SUPABASE_URL` for the admin client. |
| Supabase + FastAPI | `SUPABASE_URL`, `SUPABASE_ANON_KEY` (or `SUPABASE_KEY`), `SUPABASE_SERVICE_ROLE_KEY` (secret) |

## Default paths per template

Change them to the repo's real pages during step 1. Sign-up paths may carry a query string (`/sign-up?invite=open`); every template appends `source=1health` correctly.

| Template | Sign-in | Sign-up | After launch | Where to change them |
|---|---|---|---|---|
| Better Auth | `/sign-in` | `/sign-up` | `/` | `oneHealth({ signInPath, signUpPath, afterLaunchPath })` |
| Supabase + Next.js | `/login` | `/signup` | `/` | `lib/one-health/config.ts` (`SIGN_IN`, `SIGN_UP`, `HOME`) |
| Supabase + FastAPI | `/login` | `/register` | `/` | `SIGN_IN`, `SIGN_UP`, `HOME` (and `ONE_HEALTH_APP_ORIGIN`) in `one_health.py` |

### Routes each template serves

| Template | Launch URL (register in 1health) | Registration | confirm-first-link |
|---|---|---|---|
| Better Auth | `{BETTER_AUTH_URL}/api/auth/1health/launch` | `GET /api/auth/1health/pending`, `POST /api/auth/1health/complete-registration` | automatic (`hooks.after` on sign-in, sign-up, verify-email, OAuth callbacks and magic-link verify) |
| Supabase + Next.js | `{origin}/1health/launch` | `GET /1health/pending`, `POST /1health/complete-registration` | `POST /1health/confirm-link` (cookies) |
| Supabase + FastAPI | `{api origin}/1health/launch` | `GET /1health/pending`, `POST /1health/complete-registration` | `POST /1health/confirm-link` (`Authorization: Bearer <access token>`) |

## Rate limits

| Template | Where | Defaults |
|---|---|---|
| Better Auth | `rateLimit.customRules` in `betterAuth({...})` | launch 10/min, complete-registration 5/min |
| Supabase + Next.js | `lib/one-health/rate-limit.ts` (`LIMITS`) | launch 10/min, complete-registration 5/min, confirm-link 10/min, per IP |
| Supabase + FastAPI | `RATE_LIMITS` in `one_health.py` | launch 10/min, complete-registration 5/min, per IP |

The Supabase limiters are in memory, so they hold per process or serverless instance. For a hard limit, put a shared limiter (Redis/Upstash, the platform's firewall or WAF rules) in front of the `/1health/*` routes. A rate-limited launch redirects to sign-in with `?error=rate_limited`; a rate-limited API call returns 429 `{ message }`.
