import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { adminClient } from "@/lib/one-health/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  // Read through RLS ("own profile") to prove the minted session is a real user session.
  const { data: profile } = await supabase.from("profiles").select("email, full_name").eq("id", user.id).maybeSingle();
  const { data: link } = await adminClient().from("profiles")
    .select("one_health_env, one_health_tenant_id, one_health_user_id").eq("id", user.id).maybeSingle();
  return (
    <main>
      <h1>Signed in</h1>
      <p data-testid="email">{user.email}</p>
      <p>Profile via RLS: {profile ? `${profile.full_name ?? "(no name)"} <${profile.email}>` : "not readable"}</p>
      <p data-testid="link">
        1health link: {link?.one_health_user_id ? `${link.one_health_env}:${link.one_health_tenant_id}:${link.one_health_user_id}` : "none"}
      </p>
      <form action="/auth/signout" method="post"><button>Sign out</button></form>
    </main>
  );
}
