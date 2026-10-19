// lib/one-health/messages.ts — sign-in / sign-up page copy for the 1health launch (any stack).
// The launch route redirects to SIGN_IN?error=<code> on failure, to SIGN_IN?source=1health for confirm-first-link,
// and to SIGN_UP?source=1health for an unknown user. ← Reword to the product's voice; keep every code covered.
const RELAUNCH = "We couldn't verify this 1health launch. Open the app from 1health again.";
const FAILED = "Something went wrong signing you in. Try again from 1health.";

const ERRORS: Record<string, string> = {
  launch_missing: "Open this app from the 1health Apps screen.",
  payload_invalid: RELAUNCH,
  wrong_application: RELAUNCH,
  token_exchange_failed: "This launch link has expired or was already used. Open the app from 1health again.",
  identity_lookup_failed: "We couldn't read your 1health profile. Try again shortly.",
  identity_no_email: "Your 1health account doesn't have an email address. Add one in 1health, then open the app again.",
  email_not_verified: "Verify your email in 1health, then open the app again.",
  tenant_not_allowed: "Your organization isn't set up for this app yet.",
  identity_conflict: "This account is already connected to a different 1health user. Contact support.",
  rate_limited: "Too many sign-in attempts. Wait a minute, then open the app from 1health again.",
  session_mint_failed: FAILED,
  user_lookup_failed: FAILED,
  link_failed: FAILED,
  launch_failed: FAILED,
};

/** Notice for the sign-in page: an error from ?error=, else the confirm-first-link prompt for ?source=1health. */
export function signInNotice(params: { error?: string | null; source?: string | null }): string | null {
  if (params.error) return ERRORS[params.error] ?? FAILED;
  return params.source === "1health" ? "Sign in once to connect your 1health account." : null;
}

/** Intro for the prefilled registration form (sign-up page with ?source=1health). */
export const REGISTRATION_INTRO = "You're coming from 1health. Create your account to finish connecting.";
