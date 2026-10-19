# Supabase recipe

Templates:
- Next.js: `templates/supabase-next/*`
- FastAPI: `templates/supabase-fastapi/one_health.py`
- Migration: `templates/sql/supabase.sql`

## Creating a native session (the stack-specific step)

Supabase has no Admin API call for "create a session for user X". The supported route has two steps:

1. `auth.admin.generateLink({ type: "magiclink", email })` with the **service role**. Called through the Admin API, this sends **no email**. It returns `properties.hashed_token`.
2. `auth.verifyOtp({ token_hash, type: "magiclink" })` on an **anon-key** client. This returns a real session (access and refresh tokens) signed by the project, so RLS and `auth.uid()` work. (`type: "email"` is the newer equivalent.)

For the second step:
- **`@supabase/ssr`**: run `verifyOtp` on the cookie-bound server client. It writes the session cookies, so you only need to redirect.
- **supabase-py**: create a **new** client for each call, because clients hold session state. `verify_otp({"token_hash": …, "type": "magiclink"})` is supported (`VerifyTokenHashParams`).

**Don't**:
- hand-make JWTs (Supabase rejects them: `signature is invalid` / `no suitable key`);
- fall back to the service-role client with manual `user_id` filters (this bypasses RLS);
- drop the refresh token (the session would die after about an hour).

An older but working alternative is `GET {SUPABASE_URL}/auth/v1/verify?token=<hash>&type=magiclink` with `follow_redirects=false`, then parsing the tokens from the 303 `Location` fragment. It depends on **Site URL** being set correctly. Prefer `verifyOtp`.

## Delivering the session

| App stores the session in… | Delivery |
|---|---|
| Cookies (`@supabase/ssr`, SSR) | Already set by `verifyOtp`. Respond `303 → /`. |
| supabase-js in the browser (SPA) | `303 → /#access_token=…&refresh_token=…&expires_in=…&token_type=bearer&type=magiclink`. `detectSessionInUrl` picks it up with `flowType: 'implicit'`. With `pkce`, call `setSession()` yourself. |
| Custom storage (e.g. a bearer token in `localStorage`) | The same fragment. The boot script stores both tokens and calls `history.replaceState` to remove them. |

Browsers don't send URL fragments to servers or include them in `Referer`. Handle the whole launch in one server request that ends in a redirect. Never return JSON to a top-level navigation.

## Finding users

1. Look for a **linked** identity: `(one_health_env, one_health_tenant_id, one_health_user_id)` on the profile table, or on a `one_health_links` table if the repo has no profile table.
2. Otherwise match on **email** through the `auth_user_id_by_email` security-definer function, which only `service_role` can execute. Supabase stores emails in lower case.
3. If the email belongs to an account already linked to a *different* 1health user, return `identity_conflict`.
4. Never call `generateLink` to find out whether a user exists.

## Sign-up gates hide their message

A gate that rejects the email reaches `admin.createUser` as `status 500, "Database error creating new user"`, whether it's a trigger on `auth.users` raising an exception or a "before user created" auth hook. Supabase doesn't pass the trigger's own text through. The template maps that case to "Account creation is not available for this email address." Use the repo's own copy, or check the gate before calling `createUser`. Verified on local Supabase, October 2026.

## Unmatched user

The launch sets a signed, HttpOnly, 15-minute `oh_pending_link` cookie (Next: `jose`, Python: `itsdangerous`) and redirects to sign-up with `?source=1health`. The registration page:
- calls `/1health/pending` to prefill the email (read-only) and the name;
- posts to `/1health/complete-registration`.

On the server, that endpoint calls `admin.createUser({ email: <from cookie>, password, email_confirm: true })`, runs the repo's normal post-sign-up work, links the identity, creates the session, and clears the cookie.

## confirm-first-link

The launch sets the pending cookie and redirects to sign-in with `?source=1health`. After a successful normal sign-in, the page calls `POST /1health/confirm-link`. In Next.js that request carries cookies; in FastAPI, send `Authorization: Bearer <app token>`. The endpoint links the identity only if the signed-in email equals the pending email.

## Dashboard checks (hand to the user)

- Auth → Providers → **Email** enabled.
- **Site URL** set to the production origin, not `http://localhost:3000`.
- **Redirect URLs** include the production, staging and dev origins.
- Prefer asymmetric **JWT signing keys**.
- The service role key is on the server only.

## Repo checks

- **FastAPI**: `TrustedHostMiddleware` / `ALLOWED_HOSTS` must include the launch host. Otherwise the browser shows "Invalid host header" while `curl` works.
- **Tables created by raw SQL** may lack grants. Add `GRANT … TO service_role`.
- **MFA (AAL2)**: the minted session is AAL1, so step-up still applies.
- **Supabase "Confirm email"**: not affected, because `email_confirm: true` is set for 1health registrations.
