# Error codes, user-facing copy, scenario matrix

## `?error=` codes (from the launch route)

| Code | Meaning | Copy for the sign-in page |
|---|---|---|
| `launch_missing` | No `lpl` parameter | "Open this app from the 1health Apps screen." |
| `payload_invalid` | No configured secret decrypts the payload, or it's malformed | "We couldn't verify this 1health launch. Open the app from 1health again." *(Ops: is the right secret assigned and configured?)* |
| `token_exchange_failed` | Code already used or expired, or app not Active | "This launch link has expired or was already used. Open the app from 1health again." |
| `wrong_application` | Token was issued for a different app | Same as `payload_invalid`. *(Ops: check `ONE_HEALTH_<ENV>_APP_ID`.)* |
| `identity_lookup_failed` | `/myself` failed, timed out or returned non-JSON | "We couldn't read your 1health profile. Try again shortly." |
| `identity_no_email` | `/myself` has no email **address**. Demo QA/system users return a username. | "Your 1health account doesn't have an email address. Add one in 1health, then open the app again." |
| `email_not_verified` | 1health email not verified | "Verify your email in 1health, then open the app again." |
| `tenant_not_allowed` | Tenant not on the allow-list | "Your organization isn't set up for this app yet." |
| `identity_conflict` | Email already linked to another 1health account | "This account is already connected to a different 1health user. Contact support." |
| `session_mint_failed` / `user_lookup_failed` / `link_failed` (Supabase) / `launch_failed` (any stack) | Server-side failure. `launch_failed` covers any unexpected error and is logged as `[1health] launch failed` | "Something went wrong signing you in. Try again from 1health." |

`?source=1health`:
- on sign-in (confirm-first-link): "Sign in once to connect your 1health account."
- on sign-up: show the prefilled registration form.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Browser: "can't provide a secure connection" | Launch URL is HTTP | HTTPS everywhere |
| "Invalid host header" in the browser; `curl` works | Host allow-list | Add the host. Check `.env` for merged lines. |
| Lands on sign-in with no error | Proxy or middleware intercepted the launch path | Exclude it from the matcher |
| Tile gives **404** on the production URL | The integration isn't deployed there yet (PR not merged) | Test on a preview first (re-target the launch, or mint one). Then merge |
| Preview gives `payload_invalid`; local works | Env vars not scoped to Preview, or not redeployed after setting them | Add the Preview scope, redeploy, then run `probe-launch.mjs` |
| Sign-up URL looks like `/sign-up?x=1?source=1health` | Old template string-concatenated a query | Use the template's `withParam` |
| Raw 500 page on launch | Old Better Auth template rethrew non-`LaunchError`s (an `instanceof APIError` check misses redirects) | Use `isAPIError(e) && e.status === "FOUND"`, and map the rest to `launch_failed` |
| `pnpm` prompts to reinstall `node_modules` from scratch | A different pnpm major from the one that made `node_modules`/the lockfile | Answer **n**. Use `npx pnpm@<major>`, or run `npx next dev` directly |
| Signed in on launch, then signed out | Cookie not stored: Secure cookie over HTTP, or the origin differs from the configured base URL | Same origin, HTTPS |
| Apps tile missing | User's role can't see Apps | Manager role, then sign out and back in |
| `permission denied for table …` (Supabase) | Missing grant | `GRANT … TO service_role` |
| Supabase verify redirects to `localhost:3000` | Site URL not set | Set Site URL |
| `403 … launch-payload` when minting a QA launch | Key's role can't mint | `GET /api/v2/token/context/api-access` with that key |
| 401s for minutes on demo | Burst throttling | Wait. Don't retry in a loop. |

## Scenario matrix (run before handing off)

1. Linked user launches → signed in at the home page.
2. Existing, unlinked user with a matching verified email:
   - `auto-link` → linked and signed in;
   - `confirm-first-link` → sign-in page → signs in → linked → the next launch is silent.
3. Unknown email → prefilled read-only registration → submit → signed in and linked. The next launch is silent.
4. Unknown email rejected by a sign-up gate → a clear error on the form.
5. Unverified 1health email → `email_not_verified`.
6. Reload the launched tab → `token_exchange_failed` with the "launch again" copy.
7. Payload encrypted for another environment or secret → `payload_invalid`.
8. Same email, different 1health user → `identity_conflict`.
9. Normal sign-in and sign-up without 1health → unchanged.
10. Demo QA/system user (username in `email`) → `identity_no_email`.
11. Unexpected server error (e.g. DB down) → `launch_failed` page, not a 500.

Scenarios 2, 3, 4 and 8 need demo users with **real** verified emails; QA keys can't cover them.
