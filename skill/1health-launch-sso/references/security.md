# Security checklist

| # | Control | |
|---|---|---|
| 1 | Launch secrets live only in server env or a secrets manager. Never in `NEXT_PUBLIC_*`, client code or tracked files. If one was ever committed, run `git rm --cached` **and rotate** it. | Required |
| 2 | `externalApplicationId` matches the app ID for that environment | Required |
| 3 | `emailVerified === true` from `/myself`, **and** `email` is a real address (QA/system users return a username) | Required |
| 4 | Match on the linked identity first, then on the lower-cased verified email | Required |
| 5 | Reject `identity_conflict` (email already linked to another 1health user). Never log a warning and continue. | Required |
| 6 | Only native sessions (Better Auth `createSession` / Supabase `verifyOtp`). No custom JWTs. No elevated fallback. | Required |
| 7 | 1health tokens never reach the browser. Discard them, or encrypt them at rest if needed. | Required |
| 8 | Pending-link cookie is signed, HttpOnly, Secure, `SameSite=Lax`, lives at most 15 minutes, and holds identity only | Required |
| 9 | Registration takes the email from the **signed cookie**, never from the request body | Required |
| 10 | Tenant allow-list for private apps or pilots | Recommended |
| 11 | `confirm-first-link` where "an email match alone must not merge accounts" (regulated or professional apps) | Recommended |
| 12 | Rate limits on the launch and registration routes | Recommended |
| 13 | Launch query strings (`lpl`) kept out of access logs. `next dev` prints full request URLs, and Vercel request logs include query strings, so filter log drains. | Recommended |
| 14 | Audit row per launch with identifiers only. No emails, tokens, codes or `/myself` bodies. | Recommended |
| 15 | QA launch-minting code and keys disabled and absent in production | Required if present |
| 17 | Unexpected server errors in the launch route redirect to `?error=launch_failed` (logged without `lpl`, tokens or `/myself` bodies). Never a raw 500 page. | Required |
| 16 | MFA apps: minted sessions are AAL1, so step-up still applies | Required with MFA |

## Residual risk: login CSRF

The launch starts in 1health, so there is no `state` value tying it to the user's browser. An attacker can mint a launch from their **own** 1health account and get a victim to open it while the code is still valid. The victim is then signed in as the attacker.

Mitigations:
- The code is single-use and short-lived.
- Show a visible "Signed in as … via 1health" notice.
- If the browser already has a session for a *different* user, ask before switching.
- `confirm-first-link` closes this for first-time links, because linking needs the victim's own credentials.
- Ask 1health about launch-time `state` support.

## Trust model

Trusting the email is like "Sign in with Google": 1health vouches that the person controls the email address. This holds only for `emailVerified === true`. Authentication proves who the person is. It does **not** prove their professional qualifications, employment, or authority to act for an organization. Don't derive app roles from 1health launch data unless the product explicitly decides to.
