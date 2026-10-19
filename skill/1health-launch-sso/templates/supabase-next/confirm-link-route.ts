// lib/one-health/confirm-link-route.ts — POST /1health/confirm-link, for confirm-first-link. Re-export it from:
//   app/1health/confirm-link/route.ts → export { POST } from "@/lib/one-health/confirm-link-route";
// The sign-in page calls it right after a successful normal sign-in when ?source=1health is present (snippet in
// references/supabase.md). Links only if the signed-in user's email equals the pending identity's.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { auditLaunch, linkOneHealthIdentity } from "@/lib/one-health/users";
import { clearPendingLink, readPendingLink } from "@/lib/one-health/pending-cookie";
import { rateLimited } from "@/lib/one-health/rate-limit";

export async function POST(req: NextRequest) {
  if (rateLimited(req, "confirm-link")) return NextResponse.json({ linked: false }, { status: 429 });
  const p = await readPendingLink();
  if (!p) return NextResponse.json({ linked: false });
  const store = await cookies(); // ← reuse the repo's server-client helper (e.g. lib/supabase/server.ts) if it has one
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
