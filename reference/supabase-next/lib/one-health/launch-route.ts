// app/1health/launch/route.ts — the URL registered in 1health: {origin}/1health/launch
import { NextRequest, NextResponse } from "next/server";
import { LaunchError, resolveLaunch, type OneHealthIdentity } from "@/lib/one-health/protocol";
import { mintSupabaseSession } from "@/lib/one-health/session";
import { auditLaunch, findAppUser, linkOneHealthIdentity } from "@/lib/one-health/users";
import { setPendingLink } from "@/lib/one-health/pending-cookie";
import { HOME, POLICY, SIGN_IN, SIGN_UP, withParam } from "@/lib/one-health/config";
import { rateLimited } from "@/lib/one-health/rate-limit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const go = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  let identity: OneHealthIdentity | undefined;
  try {
    if (rateLimited(req, "launch")) throw new LaunchError("rate_limited");
    const lpl = req.nextUrl.searchParams.get("lpl");
    if (!lpl) throw new LaunchError("launch_missing");
    identity = await resolveLaunch(lpl);

    const user = await findAppUser(identity);
    if (!user) {
      await setPendingLink(identity);
      await auditLaunch("no_user", identity);
      return go(withParam(SIGN_UP, "source", "1health"));
    }
    if (!user.linked) {
      if (POLICY === "confirm-first-link") {
        // After a successful normal sign-in, the sign-in page POSTs /1health/confirm-link (confirm-link-route.ts),
        // which links the identity. See references/supabase.md, "confirm-first-link".
        await setPendingLink(identity);
        await auditLaunch("pending_confirm", identity);
        return go(withParam(SIGN_IN, "source", "1health"));
      }
      await linkOneHealthIdentity(user.id, identity);
    }
    await mintSupabaseSession(user.email);
    await auditLaunch("success", identity, { appUserId: user.id });
    return go(HOME);
  } catch (e) {
    const code = e instanceof LaunchError ? e.code : "launch_failed";
    // Never log lpl, tokens or /myself bodies.
    if (!(e instanceof LaunchError)) console.error("[1health] launch failed", { error: (e as Error)?.message });
    await auditLaunch("failure", identity, { reason: code });
    return go(withParam(SIGN_IN, "error", code));
  }
}
