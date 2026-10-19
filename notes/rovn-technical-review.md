# Rōvn: technical assumptions vs. the 1health launch-SSO pattern

Sources: the "Rovn - 1Health" email (Oct 16, 2026) and its attachments 01 Full Vision, 02 Partnership, and 03 Execution Plan.
Internal working notes, used to prepare Neil's review of Rōvn's 1health references.

## Rōvn's stack
None of the three documents names a framework, auth provider, hosting, database or IdP. **We need to ask.**

## Auth and identity assumptions in the Rōvn documents
1. Rōvn accounts are independent and run parallel to 1health (a "parallel-account entry route", 03 p5). This **fits** the launch pattern.
2. "Standard OAuth" is not assumed, and launching gives no automatic access to other apps (03 p5). This **fits**.
3. **"An email match alone must not merge accounts"** (02 p5, 03 p5). This **conflicts** with the auto-link-by-verified-email default. It can be resolved with no change on the 1health side by using the *confirm-on-first-link* policy: the first launch asks the user to sign in to Rōvn (or confirm) once, and after that only the stored 1health tenant and user ID is matched.
4. The 1health session must identify a person **and an organization** (03 p5). This is partly met. We get `tenant.id` and `/myself` returns `tenants` and `tenantContext`. Whether a 1health tenant equals a Rōvn practice is unconfirmed.
5. Recovery, unlinking and role changes (03 p5). Unlinking and recovery can be built in the app. **Role changes have no push mechanism**: the app only sees identity at launch. Live updates would need 1health webhooks or polling.
6. Organization roles and staff rosters (03 p3–p4). **Not provided by SSO.** They depend on other 1health APIs.
7. Wrong-person and wrong-org links must be preventable or recoverable (03 p5). Partly met. The `identity_conflict` check and confirm-on-first-link handle most cases. The **login-CSRF residual risk** remains, because the launch carries no `state`.
8. Notifications, app discovery and invitation placement (03 p5, described as "developing"). These are platform features, outside SSO.
9. App-to-app exchange, patient records, consent and revocation propagation, and training rights. These are platform, policy and contract matters, outside SSO.
10. Authentication does not establish qualification, employment or authority to act for an organization (03 p5). This agrees with the pattern, which asserts identity only.

## Practical gotcha
On demo, the Apps screen showed for the **manager** role but not **employee**. Clinicians and staff with employee roles may not see the Rōvn tile.

## Questions for Rōvn (Giles, Jerry)
1. Auth stack today (Supabase, Better Auth, Auth0, Clerk, Cognito, Firebase, custom)? Backend framework, database, hosting? Web only, or mobile as well?
2. Is confirm-on-first-link acceptable as your "explicit linking"? After it, launches would sign in silently.
3. Is creating a new account from a verified 1health email acceptable after explicit registration (prefilled email)?
4. Does a 1health tenant map to a Rōvn practice? Can one person belong to several? Which roles do you need, and is a snapshot at launch enough?
5. Who launches Rōvn: clinicians, staff, managers? (The Apps screen is role-gated.)
6. Will you call 1health APIs on the user's behalf? Which ones? Only during a session, or in the background?
7. Which first app or program (Pursuit, Primary Care Streams, other)? What data flows each way? Is PHI involved?
8. Offboarding: how should Rōvn react when a user leaves a tenant or a role changes?
9. Compliance: BAA/HIPAA scope, audit logging, token storage requirements.
10. What do you need from us (demo app registration, QA users) for the weeks 1–2 linking prototype?

## Framings to correct in Rōvn materials
- "An email match alone": the pattern matches on a **verified** email *plus* a stored 1health ID, and confirm-on-first-link is available.
- "Parallel-account entry route" is accurate.
- Nothing should suggest that 1health role or roster data, notifications, or cross-app data access come with launch SSO.
