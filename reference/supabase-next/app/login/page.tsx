import { LoginForm } from "@/components/LoginForm";
import { errorMessage } from "@/lib/messages";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; source?: string }> }) {
  const { error, source } = await searchParams;
  const notice = errorMessage(error) ?? (source === "1health" ? "Sign in once to connect your 1health account." : null);
  return <LoginForm notice={notice} confirmLink={source === "1health"} />;
}
