# Supabase recipe

Templates:
- Next.js (`templates/supabase-next/`, copy to `lib/one-health/` and re-export from route files):

  | Template | Copy to | Route file that re-exports it |
  |---|---|---|
  | `ts/protocol.ts` | `lib/one-health/protocol.ts` | |
  | `supabase-next/config.ts` | `lib/one-health/config.ts` (paths, policy) | |
  | `supabase-next/session.ts` | `lib/one-health/session.ts` | |
  | `supabase-next/users.ts` | `lib/one-health/users.ts` | |
  | `supabase-next/pending-cookie.ts` | `lib/one-health/pending-cookie.ts` | |
  | `supabase-next/rate-limit.ts` | `lib/one-health/rate-limit.ts` | |
  | `supabase-next/launch-route.ts` | `lib/one-health/launch-route.ts` | `app/1health/launch/route.ts`: `GET` |
  | `supabase-next/registration-routes.ts` | `lib/one-health/registration-routes.ts` | `app/1health/pending/route.ts`: `GET`; `app/1health/complete-registration/route.ts`: `POST` |
  | `supabase-next/confirm-link-route.ts` | `lib/one-health/confirm-link-route.ts` | `app/1health/confirm-link/route.ts`: `POST` (needed for confirm-first-link) |
  | `shared/messages.ts` | `lib/one-health/messages.ts` (sign-in copy) | |
  | `shared/OneHealthRegistration.tsx` | the repo's components folder | |

  Each route file is two lines, for example:

  ```ts
  // app/1health/launch/route.ts
  export const dynamic = "force-dynamic";
  export { GET } from "@/lib/one-health/launch-route";
  ```
- FastAPI: `templates/supabase-fastapi/one_health.py`
- Migration: `templates/sql/supabase.sql`
- Env vars, default paths and rate limits: `references/configuration.md`

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

## Sign-in page (both Supabase stacks)

The launch redirects to the sign-in page with `?error=<code>` on failure, and with `?source=1health` under confirm-first-link. Show `signInNotice({ error, source })` from `templates/shared/messages.ts` (or the table in `references/troubleshooting.md`). Under confirm-first-link, the launch sets the pending cookie and redirects to sign-in with `?source=1health`. After a successful normal sign-in, the page calls `POST /1health/confirm-link`, which links the identity only if the signed-in email equals the pending email.

Next.js (`@supabase/ssr`; the request carries the session cookies):

```tsx
"use client";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { signInNotice } from "@/lib/one-health/messages";

export function SignInForm() {
  const params = useSearchParams();
  const error = params.get("error"), source = params.get("source");
  const notice = signInNotice({ error, source });
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { error } = await supabase.auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) return; // ← the repo's existing error handling
    if (source === "1health" && !params.get("error"))
      await fetch("/1health/confirm-link", { method: "POST", credentials: "same-origin" }); // links, or no-ops
    window.location.assign("/");
  }
  return <form onSubmit={onSubmit}>{notice && <p role="status">{notice}</p>}{/* existing fields */}</form>;
}
```

Hook the `confirm-link` call into the repo's existing sign-in success path (including OAuth or magic-link sign-in callbacks, if the repo has them) rather than writing a new form. `useSearchParams` needs a `<Suspense>` boundary in the App Router; a server page can read `searchParams` and pass the notice down instead.

FastAPI: the same call, with the new session's access token and the pending cookie:

```ts
await fetch(`${API}/1health/confirm-link`, {
  method: "POST", credentials: "include",            // "same-origin" when API and SPA share an origin
  headers: { Authorization: `Bearer ${session.access_token}` },
});
```

## FastAPI frontend boot code

The FastAPI launch (and `complete-registration`'s `redirectTo`) ends at `{APP_ORIGIN}/#access_token=…&refresh_token=…&expires_in=…&token_type=bearer&type=magiclink`. Run this once, before the app reads its stored session:

```ts
// Boot: pick up a 1health launch session from the URL fragment, then remove it from the address bar.
const h = new URLSearchParams(window.location.hash.slice(1));
if (h.get("type") === "magiclink" && h.get("access_token") && h.get("refresh_token")) {
  const access_token = h.get("access_token")!, refresh_token = h.get("refresh_token")!;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  // supabase-js: await supabase.auth.setSession({ access_token, refresh_token });
  // custom storage: store both tokens exactly where the existing login stores them.
}
```

With supabase-js and `flowType: "implicit"` (the default for `createClient`), `detectSessionInUrl` already does this; the snippet is for `pkce` clients and custom token storage. Keep the refresh token, or the session dies after an hour.

## Split API and SPA origins (FastAPI)

When the SPA (`https://app.example.com`) and FastAPI (`https://api.example.com`) are on different origins:

- **Launch URL** is the API's: `https://api.example.com/1health/launch`. Set `ONE_HEALTH_APP_ORIGIN=https://app.example.com` so every redirect (home with the fragment, sign-in, sign-up) goes to the SPA.
- **The pending cookie lives on the API origin.** The SPA's calls to `/1health/pending`, `/1health/complete-registration` and `/1health/confirm-link` must use the API's absolute URLs with `credentials: "include"`, and FastAPI's `CORSMiddleware` needs `allow_origins=["https://app.example.com"]` (explicit, not `*`) and `allow_credentials=True`.
- **Same site vs. cross site.** `app.` and `api.` under one registrable domain are same-site, so the `SameSite=Lax` cookie is sent. Different registrable domains (e.g. `*.vercel.app` + `*.onrender.com`) are cross-site: browsers increasingly block such cookies. Prefer proxying `/1health/*` through the SPA's origin (a rewrite in the SPA host), which makes the whole flow same-origin and needs no CORS. Then the launch URL is on the SPA origin, and `ONE_HEALTH_APP_ORIGIN` stays empty.
- `TrustedHostMiddleware` must include the API host.

## Rate limits

The Next.js template rate-limits in `lib/one-health/rate-limit.ts`; FastAPI in `RATE_LIMITS` / `_rate_limited` in `one_health.py`. Both are in-memory per process or serverless instance, keyed by client IP:

- Next.js reads `x-forwarded-for`, which the platform proxy sets (Vercel, most load balancers). Without a trusted proxy in front, it can be spoofed.
- FastAPI uses `request.client.host`. Behind a proxy, run uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy IPs>`, or every request shares the proxy's IP.
- For a hard limit across instances, put a shared limiter (Redis/Upstash, Vercel Firewall, Cloudflare rate-limiting rules) in front of `/1health/*`, and keep the template limiter as a backstop.

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
