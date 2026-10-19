// Two route handlers. Split into:
//   app/1health/pending/route.ts               → export { GET }
//   app/1health/complete-registration/route.ts → export { POST }
import { NextRequest, NextResponse } from "next/server";
import { adminClient, mintSupabaseSession } from "@/lib/one-health/session";
import { auditLaunch, linkOneHealthIdentity } from "@/lib/one-health/users";
import { clearPendingLink, readPendingLink } from "@/lib/one-health/pending-cookie";

export const dynamic = "force-dynamic";

/** GET /1health/pending → prefill for the registration form (never returns 1health ids). */
export async function GET() {
  const p = await readPendingLink();
  if (!p) return NextResponse.json({ message: "No pending 1health link" }, { status: 404 });
  return NextResponse.json({ email: p.email, firstName: p.firstName ?? null, lastName: p.lastName ?? null });
}

/** POST /1health/complete-registration { name, password } */
export async function POST(req: NextRequest) {
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
  return NextResponse.json({ redirectTo: "/" });
}

// app/1health/confirm-link/route.ts → export this function as `POST` (named confirmLink here only
// because this template file already exports a POST).
// confirm-first-link: the sign-in page calls this right after a successful normal sign-in when
// ?source=1health is present. Links only if the signed-in user's email equals the pending identity's.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function confirmLink() {
  const p = await readPendingLink();
  if (!p) return NextResponse.json({ linked: false });
  const store = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => store.getAll(), setAll: (l) => l.forEach(({ name, value, options }) => store.set(name, value, options)) },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || user.email.toLowerCase() !== p.email) return NextResponse.json({ linked: false }, { status: 403 });
  await linkOneHealthIdentity(user.id, p);
  await clearPendingLink();
  await auditLaunch("success", p, { appUserId: user.id });
  return NextResponse.json({ linked: true });
}
