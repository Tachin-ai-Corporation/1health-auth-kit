# Testing launches: before merge, locally and live

1health only launches the URL registered for the app, and every launch's one-time code works **once**, for a few minutes. These techniques get a launch to a build that isn't at the registered URL (localhost, a preview deployment, production before merge).

| Technique | Needs | Tests | Script |
|---|---|---|---|
| Configuration probe | the local launch secret | the deployment has the right secret and reaches 1health | `scripts/probe-launch.mjs` |
| Mint a QA launch | a demo QA user API key | the error paths (`identity_no_email`) and the full handshake | `scripts/mint-qa-launch.mjs` |
| Re-target a tile launch | a 404 at the registered URL | everything, with a real person | none |
| Capture a tile launch | a 1health login in a desktop browser | everything, with a real person, even when the registered URL already works | DevTools snippet below |

## Configuration probe (no 1health login)

```bash
node --env-file=.env.local scripts/probe-launch.mjs <launchUrl> [demo|prod]
```

It encrypts a well-formed payload with the local secret and a fake code, then reads where the deployment redirects:

- `token_exchange_failed`: the deployment has the same secret, decrypted the payload and reached 1health. Configuration is good.
- `payload_invalid`: the deployment's secret is missing or different (on Vercel: not scoped to that environment, or not redeployed since).
- `launch_missing` or 404: the route isn't deployed there, or a proxy strips the query.

It sends one request with a code that can never be valid, so it is safe against production.

## Mint a QA launch

```bash
node --env-file=.env.local scripts/mint-qa-launch.mjs <launchUrl> [manager|employee|sys_admin]
```

It calls `GET https://demo.1health.io/api/v2/external-application/{ONE_HEALTH_DEMO_APP_ID}/launch-payload` with `ONE_HEALTH_QA_<ROLE>_KEY` and prints `<launchUrl>?lpl=…`. Open it straight away. Demo throttles bursts with 401s for minutes, so don't retry in a loop.

**API keys can't stand in for people.** Every demo API key launches as its own `system_…` user with a username in `/myself.email`, even when a real person created the key. QA launches only reach `identity_no_email`. Linking and registration need real demo users with verified emails: one matching an existing app user, and one new.

## Re-target a tile launch

Before the integration is merged, the registered production URL returns 404, so the tile's code is still unspent. Replace the origin in the 404 page's address bar with the preview's (or `http://localhost:<port>`), keep the path and `?lpl=…`, and press Enter within a few minutes. Every deployment shares the same secret, so the payload decrypts there.

## Capture a tile launch without spending it

Once a host already serves the registered URL, a tile click spends the code there. Capture the launch on the 1health **Apps** page instead. The tile calls `window.open(<launch URL>?lpl=…)`, so overriding `window.open` stops the navigation and prints the URL.

1. Sign in to 1health as the demo user, and open the **Apps** page.
2. In that tab's DevTools console, run (change the target to the build under test, including its launch path):

   ```js
   window.open = (u) => {
     console.log(String(u).replace(/^https:\/\/[^/]+\/[^?]+/, "http://localhost:3000/1health/launch"));
     return { close() {} };
   };
   ```

   Better Auth targets end in `/api/auth/1health/launch`.
3. Click the app's tile. Nothing opens, and the console prints a working launch URL for the target.
4. Open it within a few minutes. It works once; capture again for each scenario.

Reload the Apps page to restore `window.open`.

## Scenario matrix

Run the matrix in `references/troubleshooting.md` before handing off. Set up each scenario's state (unlinked, linked, linked to someone else) directly in the app's database between captured launches.

## Automated tests

- TypeScript: `templates/tests/one-health/protocol.test.ts` (protocol module) and, for Better Auth, `better-auth-e2e.test.ts` (the plugin through `auth.handler` with the memory adapter and mocked 1health).
- Python: `templates/tests/test_one_health.py` (protocol paths with `httpx.MockTransport`, and routes with FastAPI's `TestClient`).
- Not covered by any automated test: the Supabase calls (`generateLink`, `verifyOtp`, `admin.createUser`), which need a real or local Supabase project. Cover them with the captured-launch matrix above.
