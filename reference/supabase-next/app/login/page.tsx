import { LoginForm } from "@/components/LoginForm";
import { signInNotice } from "@/lib/one-health/messages";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; source?: string }> }) {
  const { error, source } = await searchParams;
  return <LoginForm notice={signInNotice({ error, source })} confirmLink={source === "1health" && !error} />;
}
