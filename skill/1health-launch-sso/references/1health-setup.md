# 1health setup (hand these steps to the user)

## Register the app (per environment; start with demo)

1. Sign in to `https://demo.1health.io` as a tenant **manager**. Switch to the tenant (company) that will own the app.
2. Go to **Settings → Apps** and add an **External Application**. Give it a name and an icon: PNG, SVG or WebP, at most 512×512 px and 500 KB. Use a transparent background.
3. **Launch URL**:
   - Better Auth: `https://<production-origin>/api/auth/1health/launch`
   - Supabase templates: `https://<production-origin>/1health/launch`

   It must be HTTPS, a stable origin, and accepted by the app's host allow-list.
4. **Launch secret**: generate an API key and **assign it to this app**. If the tenant has several keys, the assigned one is what counts. 1health shows it **once**, so save it straight into a secrets manager or hosting env (`ONE_HEALTH_DEMO_LAUNCH_SECRET`). If it's lost, regenerate it. Regenerating invalidates the old key immediately.
5. Note the **External Application ID** (`ONE_HEALTH_DEMO_APP_ID`).
6. Set the state to **Active**. Set visibility: `isPublic`, or the allowed organizations for a private app.
7. Make sure the people who will launch it have a role that sees the Apps screen. In demo, *manager* saw it and *employee* did not. After changing a role, sign out and back in.
8. For production (`https://app.1health.io`), repeat with separate values (`ONE_HEALTH_PROD_*`).

Apps can also be registered through the API: `POST /api/v2/external-application` returns `launchSecret` once, and `PUT …/{id}/state` moves it through Draft → Pending → Active. This isn't in the published docs yet, so test it on demo first.

## Test users

- Create a 1health demo user whose **verified** email matches an existing app user. This is the "known user" case.
- Create another with an email that isn't in the app. This is the "unknown user" case.
- For local or preview testing, get demo **QA user API keys** (`ONE_HEALTH_QA_<ROLE>_KEY`, kept in `.env.local` only) and run `templates/scripts/mint-qa-launch.mjs <launchUrl> <role>`. Every API key, even one a real person creates, launches as its own **`system_…` user**, with a username as its email, so keys only test error paths (`identity_no_email`). For linking and registration, capture a real demo user's tile launch (`references/protocol.md`).
- **Before the integration is merged**, the registered production launch URL returns 404. Either re-target a real tile launch to the preview (swap the origin in the address bar, keep `?lpl=…`), or temporarily register the preview's launch URL.
