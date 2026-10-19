# Case Study: 1health Launch SSO in Giggle Gauge (Supabase + FastAPI)

**A companion to *Single Sign-On from the 1health App Launcher into a Supabase-Authenticated App*.**
Version 0.2 (draft), October 2026. Tachin.

This document records how the reference implementation was built, what it does today, and where it differs from the general white paper. Read the white paper for the recommended design. Read this to see how it held up on a real, existing ("brownfield") codebase.

---

## 1. Context

- **App:** Giggle Gauge (`gigglegauge.com`). It is a FastAPI 0.104 monolith (`laughter-detector/`) with a vanilla-JS single-page frontend and Supabase Auth (supabase-py 2.4). It runs on a DigitalOcean VPS behind nginx and systemd.
- **Session model before the integration:** the server signed users in with `sign_in_with_password`. The browser kept the Supabase access token in `localStorage['auth_token']` and sent it as a Bearer token. The backend used a per-user Supabase client, so RLS applied.
- **Team:** Neil Sethi (Giggle Gauge creator, product manager for the platform) and Dejan Nenov (1health CTO) paired on January 24–25, 2026, for about 13–15 hours. The work was planned with BMAD: a PRD, one epic, and stories 1.1–1.9. Claude, Codex and Gemini took turns.
- **Repository:** `stokedbloke/giggles-cli`. Branches `1hfun` and `dejan-bmad-bootstrap` are merged into `main`. The launch code was final at commit `ab39b96` (2026-01-25).
- **Outcome:** a user signed in to `demo.1health.io` who clicks Giggle Gauge in Apps gets a new tab, already signed in. A user with no matching email lands on registration.

## 2. Timeline

| When | Milestone |
|---|---|
| Jan 24, afternoon | Dejan's reference pack (1health launch guide, filtered OpenAPI spec, Python/Caddy example) added under `docs/`. PRD and epics written. |
| Jan 24, 7:28 pm | **Story 1.1**: `/api/launch` decrypts the payload, after fixes for HTTPS, the host header and the key assignment. |
| Jan 24, 8:13 pm | **Story 1.2**: one-time-code exchange works once `ONE_HEALTH_API_BASE_URL` is set. |
| Jan 24, 9:02 pm | No email claim in the token, because the claims are encrypted. Decision: call `/api/v2/user/myself`. |
| Jan 25, 10:28 am | Email match works (`user_found = true`) after creating a matching 1health user with a manager role. |
| Jan 25, midday | Stories 1.5 to 1.8: identity columns, `launch_audit_logs`, maintenance mode, log redaction. |
| Jan 25, 2:26 to 3:16 pm | Session approach changed three times (see §4). Final version: a magic-link session. **End-to-end success.** |
| Feb 21–22 | Production deployment work, nginx and systemd, a sprint change proposal, and removing an accidentally committed `.env.bak` from history. |

## 3. As-built flow

1. 1health opens `https://<host>/api/launch?lpl=…`.
2. If the request comes from a browser (it accepts `text/html`), the server returns a **302 to `/?lpl=…`**. The SPA reads `lpl`, removes it from the URL, and `fetch`es `/api/launch?lpl=…` to get JSON.
3. `launch_crypto.decrypt_launch_payload` uses HKDF-SHA256 and AES-256-GCM, and checks that the one-time code is 16 alphanumeric characters.
4. `one_health_oauth.exchange_one_time_code` calls `POST …/user/token` with an HMAC signature.
5. `one_health_oauth.get_1h_user_email` calls `GET /api/v2/user/myself` and reads `email`.
6. `user_service.get_user_by_email` looks up `public.users`, using the service role and an exact match.
7. `update_one_health_identifiers` writes `one_health_tenant_id` and `one_health_user_id`, but only if they are empty.
8. `create_session_for_user` calls `admin.generate_link(magiclink)`, then `GET /auth/v1/verify` with `follow_redirects=False`, then reads `access_token` from the fragment of the 303 `Location` header.
9. The JSON response includes the Giggle Gauge session token **and the 1health access and refresh tokens**. The SPA stores the Giggle Gauge token in `localStorage`.
10. If no user matches, the app shows the registration form with a banner. After registering, the user is asked to **launch again from 1health** to link the accounts.

**Key files:**
- `src/api/launch_routes.py`
- `src/services/launch_crypto.py`
- `src/services/one_health_oauth.py`
- `src/services/user_service.py`
- `src/services/launch_audit_service.py`
- `src/auth/supabase_auth.py`
- `src/config/settings.py`
- `static/js/app.js`: `handleLaunchFromOneHealth`, `showSignupWithGuidance`
- `templates/index.html`
- `scripts/setup/migration_add_one_health_identifiers.sql`
- `scripts/setup/migration_create_launch_audit_logs.sql`

**Environment:**
- `LPL_API_KEY`: the 1health tenant API key, assigned to the app
- `ONE_HEALTH_API_BASE_URL`
- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `SECRET_KEY`
- `ALLOWED_HOSTS`, `ALLOWED_ORIGINS`
- `MAINTENANCE_MODE`
- `SUPABASE_JWT_SECRET` exists but **no code reads it**.

**Supabase dashboard:**
- Email provider with magic link enabled.
- **Site URL** changed from `http://localhost:3000` to `https://gigglegauge.com`. The proposal notes the magic-link redirect would have broken otherwise.
- Production domain added to Redirect URLs.
- JWT signing keys migrated to asymmetric.

## 4. How the session approach evolved

| Attempt | Commit | What happened |
|---|---|---|
| 1. Custom HS256 JWT signed with the app's `SECRET_KEY` | `8779c69` | Protected routes rejected it. Supabase/PostgREST returned `signature is invalid`, and after the key migration, `no suitable key or wrong key type`. |
| 2. Verify the custom JWT in the app and use the **service-role** client with manual `user_id` filters | `10c1f17` | It worked, but bypassed RLS. The two had disagreed about RLS all weekend: Dejan considered it overkill, Neil wanted to keep it. |
| 3. Magic link: `generate_link` plus a server-side `/verify` | `ab39b96` | A genuine ES256 Supabase session with RLS intact. The custom JWT was kept as a silent fallback. |

**Lesson:** decide on day one how you will create the app's *own native session* once the 1health identity is verified. Don't invent tokens.

## 5. Differences from the general white paper

| Area | Giggle Gauge today | White paper |
|---|---|---|
| Launch handling | 302 to the SPA, then a JSON fetch | One server request that ends in a redirect |
| Environments | One configured: demo. Production used the same demo values ("same 1h tenant assumed"). | Demo and prod secrets; the environment is detected by which key decrypts the payload |
| `externalApplicationId` check | None | Required |
| `emailVerified` check | Ignored | Required |
| Tenant allow-list | None | Optional |
| Email match | Exact, case-sensitive, on `public.users` | Lower-cased; checks the linked 1health ID first |
| Identifier conflict | A warning is logged and sign-in continues | Rejected |
| Session | `/verify` 303 fragment; **refresh token discarded** (about 1-hour session) | `verifyOtp`; refresh token kept |
| Fallback | HS256 app JWT that falls through to the **service role** | None (fail closed) |
| 1health tokens | Returned to the browser | Kept on the server |
| Unmatched user | Banner, **no prefill**, user must launch again | Prefilled and read-only, linked automatically |
| Linking policy | Automatic link on email match | `auto-link` or `confirm-first-link` |
| Rate limiting | None | Recommended |
| Local development | DNS name pointing to 127.0.0.1, Let's Encrypt certificate, uvicorn with TLS | Same, or mint launch payloads with a QA key |

## 6. Security follow-ups for the Giggle Gauge repository

1. **Rotate the demo tenant API key.** `docs/1h-external-app-launch-dev-ai-context/1hlogin.conf` is still tracked on `main`. It was added to `.gitignore` but never `git rm --cached`, and it contains what looks like a real key.
2. Rotate the secrets from the `.env.bak` that was removed from history on 2026-02-22. Their rotation was put off.
3. Remove the custom-JWT fallback and the code paths that branch on token type.
4. Add the `emailVerified` and `externalApplicationId` checks, and stop sending 1health tokens to the browser.
5. Keep the Supabase refresh token.
6. Rate-limit `/api/launch`.

## 7. Developer-experience lessons (from the retrospective)

- The integration itself was quick to build. The time went on predictable friction:
  - TLS
  - host headers
  - `.env` loading under test runners
  - AI tools corrupting `.env`
  - the reload watcher killing the server
  - drift between dev and prod Supabase projects
- A good **context pack** (launch guide, filtered OpenAPI spec, working example code) let the coding agents copy a known-good pattern instead of guessing.
- Having one model review another model's output caught risky changes.
- Estimate for a professional developer following a recipe like the white paper: about **4 hours**. This first, brownfield attempt took about 13–15.
