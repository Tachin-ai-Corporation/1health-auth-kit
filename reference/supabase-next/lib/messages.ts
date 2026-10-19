// Copy for ?error=<code> (skill references/troubleshooting.md).
const RELAUNCH = "We couldn't verify this 1health launch. Open the app from 1health again.";
const FAILED = "Something went wrong signing you in. Try again from 1health.";
const M: Record<string, string> = {
  launch_missing: "Open this app from the 1health Apps screen.",
  payload_invalid: RELAUNCH, wrong_application: RELAUNCH,
  token_exchange_failed: "This launch link has expired or was already used. Open the app from 1health again.",
  identity_lookup_failed: "We couldn't read your 1health profile. Try again shortly.",
  identity_no_email: "Your 1health account doesn't have an email address. Add one in 1health, then open the app again.",
  email_not_verified: "Verify your email in 1health, then open the app again.",
  tenant_not_allowed: "Your organization isn't set up for this app yet.",
  identity_conflict: "This account is already connected to a different 1health user. Contact support.",
  session_mint_failed: FAILED, user_lookup_failed: FAILED, link_failed: FAILED, launch_failed: FAILED,
};
export const errorMessage = (code?: string | null) => (code ? M[code] ?? null : null);
