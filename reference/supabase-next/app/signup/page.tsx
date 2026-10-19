import { OneHealthRegistration } from "@/components/OneHealthRegistration";
import { SignupForm } from "@/components/SignupForm";

export default async function Signup({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  if (source !== "1health") return <SignupForm />;
  return (
    <OneHealthRegistration
      fallback={<SignupForm />}
      pendingUrl="/1health/pending"
      completeUrl="/1health/complete-registration"
    />
  );
}
