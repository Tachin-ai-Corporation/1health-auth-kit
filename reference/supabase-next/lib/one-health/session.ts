// lib/one-health/session.ts — create a native Supabase session for an existing user (server only).
// generateLink(magiclink) through the Admin API sends NO email; verifyOtp on the cookie-bound
// server client redeems it and writes the normal @supabase/ssr session cookies.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { LaunchError } from "./protocol";

export function adminClient() {
  return createClient(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Reuse the repo's existing server-client helper if it has one (e.g. lib/supabase/server.ts). */
async function cookieClient() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => list.forEach(({ name, value, options }) => store.set(name, value, options)),
    },
  });
}

export async function mintSupabaseSession(email: string): Promise<void> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data.properties?.hashed_token) throw new LaunchError("session_mint_failed");
  const supabase = await cookieClient();
  const { error: vErr } = await supabase.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (vErr) throw new LaunchError("session_mint_failed");
}
