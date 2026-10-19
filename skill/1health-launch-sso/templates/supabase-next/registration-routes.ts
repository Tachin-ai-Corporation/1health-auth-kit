// lib/one-health/registration-routes.ts — the two registration route handlers. Re-export them from:
//   app/1health/pending/route.ts               → export { GET } from "@/lib/one-health/registration-routes";
//   app/1health/complete-registration/route.ts → export { POST } from "@/lib/one-health/registration-routes";
// (Or paste each function into its route file.)
import { NextRequest, NextResponse } from "next/server";
import { adminClient, mintSupabaseSession } from "@/lib/one-health/session";
import { auditLaunch, linkOneHealthIdentity } from "@/lib/one-health/users";
import { clearPendingLink, readPendingLink } from "@/lib/one-health/pending-cookie";
import { HOME } from "@/lib/one-health/config";
import { rateLimited } from "@/lib/one-health/rate-limit";

/** GET /1health/pending → prefill for the registration form (never returns 1health ids). */
export async function GET() {
  const p = await readPendingLink();
  if (!p) return NextResponse.json({ message: "No pending 1health link" }, { status: 404 });
  return NextResponse.json({ email: p.email, firstName: p.firstName ?? null, lastName: p.lastName ?? null });
}

/** POST /1health/complete-registration { name, password } */
export async function POST(req: NextRequest) {
  if (rateLimited(req, "complete-registration"))
    return NextResponse.json({ message: "Too many attempts. Wait a minute and try again." }, { status: 429 });
  const p = await readPendingLink();
  if (!p) return NextResponse.json({ message: "Your 1health launch expired. Open the app from 1health again." }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  if (!name || password.length < 8) // ← match the repo's existing password rules
    return NextResponse.json({ message: "Enter your name and a password of at least 8 characters." }, { status: 400 });

  // Email comes from the signed cookie — never from the request body. 1health verified it, so pre-confirm.
  const { data, error } = await adminClient().auth.admin.createUser({
    email: p.email, password, email_confirm: true, user_metadata: { name },
  });
  if (error || !data.user) {
    if (/already/i.test(error?.message ?? ""))
      return NextResponse.json({ message: "An account with this email already exists. Sign in instead." }, { status: 409 });
    // A sign-up gate (a trigger on auth.users, or a "before user created" auth hook) that rejects the email reaches
    // here as a 500 "Database error creating new user": Supabase hides the trigger's own message. ← If the repo
    // gates sign-up, show its usual copy here (or check the gate before calling createUser).
    console.error("[1health] registration failed", { status: error?.status, message: error?.message });
    if (error?.status === 500 && /database error/i.test(error.message))
      return NextResponse.json({ message: "Account creation is not available for this email address." }, { status: 403 });
    return NextResponse.json({ message: "Registration failed." }, { status: 400 });
  }

  // ← Run the repo's normal post-sign-up work here (profile row if not created by a trigger, defaults, welcome email).
  await linkOneHealthIdentity(data.user.id, p);
  await mintSupabaseSession(p.email);
  await clearPendingLink();
  await auditLaunch("success", p, { appUserId: data.user.id });
  return NextResponse.json({ redirectTo: HOME });
}
