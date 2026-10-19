# 1health launch protocol

This is 1health's own handshake, started by the portal. It is **not** OAuth authorization-code or OIDC, so there are no redirect URIs, client IDs or scopes to configure.

## Environments

| Env | Base URL | Secret var | App ID var |
|---|---|---|---|
| demo | `https://demo.1health.io` | `ONE_HEALTH_DEMO_LAUNCH_SECRET` | `ONE_HEALTH_DEMO_APP_ID` |
| prod | `https://app.1health.io` | `ONE_HEALTH_PROD_LAUNCH_SECRET` | `ONE_HEALTH_PROD_APP_ID` |

Each environment has its own app registration, launch secret and app ID. To work out which environment a launch came from, try each configured secret: the AES-GCM authentication tag only verifies with the right one. Don't rely on `document.referrer`.

## 1. Launch

The portal opens `https://<launch-url>?lpl=<payload>` in a new tab as a top-level navigation. No CORS changes are needed.

## 2. Payload

```
payload = Base64( IV[12] || AES-256-GCM ciphertext || tag[16] )      (no AAD)
key     = HKDF-SHA256( IKM = launch secret UTF-8, salt = none, info = none, L = 32 )
```

"No salt" means 32 zero bytes (RFC 5869). Node's `hkdfSync` with an empty salt, Python's `HKDF(salt=None)`, and 1health's template (explicit 32 zero bytes) all produce the same key.

Decrypted:

```json
{ "required": { "apiKey": {"name": "…"}, "tenant": {"id": 123}, "user": {"id": 456},
                "oneTimeCode": {"value": "<16 alnum>", "issuedAt": "…", "expiresAt": "…"} },
  "optional": { "user_first_name": "…", "user_last_name": "…", "license": "…", "provider_1health_id": "…",
                "provider_npi": "…", "workflow_id": "…", "journey_id": "…", "journey_step_id": "…", "encounter_id": "…" } }
```

The one-time code is **single-use** and short-lived; the API reference says "typically 5–10 minutes". Redeem it immediately. If the user reloads the tab, it fails, and they have to launch again from 1health. Optional fields are context only: use the names to prefill forms, and never use any of them for authorization.

## 3. Redeem

```
POST {BASE}/api/v2/public/external-application/auth/oauth2/user/token
{ "securityCode": "<code>", "signature": "<Base64(HMAC-SHA256(key = RAW launch secret, msg = code))>" }
→ { access_token, refresh_token, expires_in, scope, token_type, id }
```

The endpoint is public; the HMAC signature is what authenticates the app. Use the raw secret for the HMAC, **not** the HKDF-derived key. The app must be **ACTIVE**.

## 4. Identity

The access-token JWT's identifying claims (`sub`, `userId`, `username`, `roles`, `organizationId`, `personId`, `isMta`) are **encrypted**. The plain-text claims are `tenantId`, `externalApplicationId`, `iat` and `exp`.

- Check `externalApplicationId` against the app ID for that environment. Decoding without verifying the signature is fine here, because the next call proves the token is valid.
- `GET {BASE}/api/v2/user/myself` (Bearer) returns `id`, `email`, `username`, **`emailVerified`**, `tenants`, `tenantContext`, and a lot of PII (DOB, partial SSN, …). Read only `email`, `emailVerified` and names. Never log, store or forward the rest.
- **`emailVerified: true` doesn't mean `email` is an address.** Every demo **API key** gets its own system user (e.g. `system_1health_<app>-qa-manager`, `system_<tenant name>_<key label>`), even when a real person created the key. These users return their username in `email`, still with `emailVerified: true`. Require an address (`x@y.z`). Otherwise reject with `identity_no_email` and never match, link or register on it.

## 5. Tokens

After step 4, throw the 1health tokens away. Keep them, encrypted at rest on the server, only if the app needs to call 1health APIs on the user's behalf. Refresh is `POST {BASE}/auth/oauth2/token` with `grant_type=refresh_token` and `client_id=public-client` (per the agent guide).

## QA / local launches

The portal only launches the registered URL. To test anything else (localhost, previews):

```
GET https://demo.1health.io/api/v2/external-application/{APP_ID}/launch-payload
Authorization: Bearer <demo QA user's API key>
→ { "launchPayload": "…" }
```

Use it as `?lpl=`. Each payload works once. Demo throttles bursts (you'll get 401s for minutes), so don't retry in a loop. QA keys must never reach production. Manager, employee and sys-admin QA keys could all mint for Carrier's app (Oct 2026).

**Re-targeting a real launch.** A tile click opens `<registered launch URL>?lpl=…`. If that host can't handle it yet (e.g. production before merge returns 404), the code is still unspent. Swap the origin for a preview's and open it within the code lifetime. This works because every deployment shares the same secret.

**Capturing a real person's launch without spending it.** On the 1health Apps page, override `window.open` in DevTools to log the URL, then click the tile. The tile calls `window.open(<launch URL>?lpl=…)`, so nothing opens and the code stays unspent. Swap the origin and path for the app under test.

**Configuration probe (no 1health login needed).** Encrypt a well-formed payload with the local secret and a fake code, then send it to a deployment (`templates/scripts/probe-launch.mjs`). `token_exchange_failed` proves that deployment has the same secret and reaches 1health. `payload_invalid` means its secret is missing or different.

## Documentation vs. observed behavior

| Topic | Docs say | Observed / this skill |
|---|---|---|
| Code lifetime | API reference: 5–10 min. An older launch guide: 60 s. | Single-use confirmed. This skill follows the API reference and doesn't depend on a window. |
| Name of the secret | "launch secret", "third-party token", "app secret / decrypt key", "JWT API key" | All the same value: the API key assigned to the External Application. |
| Who receives `lpl` | Agent guide: the browser posts it to `/api/token` | Here the server receives it directly. Both work. |
| 1health tokens | Agent guide: non-HttpOnly cookies, browser calls 1health directly | Kept on the server, because these apps have their own auth and backend. |
| Environment detection | Template uses `document.referrer` | The secret that decrypts the payload. |
| Token lifetimes | Agent guide: ~50 min / ~7 days. Launch sample: 3599 s / 7200 s. | ~60 min access observed. Not relevant once tokens are discarded. |
| Launch-payload minting | Recipe says "not in published docs" | It is documented in the API reference and works on demo with QA keys. |
| `email` on `/myself` | An email address | Usually. Demo QA/system users return a username with `emailVerified: true` (observed Oct 2026). |

## Open questions for 1health

- A JWKS URL for verifying the access token (`/oauth2/jwks` is suggested but unconfirmed).
- Whether `emailVerified` is guaranteed on `/myself`, and why QA/system users report a username as a verified `email`.
- Launch-time `state`/`returnTo` support.
- **Is `user.id` global across tenants?** The link key is `<env>:<tenantId>:<userId>`. If the same person launches from a second tenant, the linked lookup misses, the email matches an account that is already linked, and the result is `identity_conflict`. Untested. If 1health user IDs are global, keying links on `<env>:<userId>` (with the tenant stored separately) would avoid this.
- How production app approval works.
