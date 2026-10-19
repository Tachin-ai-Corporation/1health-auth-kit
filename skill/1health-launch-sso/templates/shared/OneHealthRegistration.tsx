"use client";
// Render on the sign-up page when ?source=1health is present. Adapt markup to the repo's form components.
// Better Auth: defaults work as-is. Supabase templates (Next.js and FastAPI): pass pendingUrl="/1health/pending" and
// completeUrl="/1health/complete-registration". Every stack answers errors as JSON { message }.
// FastAPI on a different origin from the SPA: pass the API's absolute URLs and change `credentials` to "include"
// (references/supabase.md, "Split API and SPA origins").
import { useEffect, useState } from "react";

type Pending = { email: string; firstName: string | null; lastName: string | null };

export function OneHealthRegistration({
  fallback,
  pendingUrl = "/api/auth/1health/pending",
  completeUrl = "/api/auth/1health/complete-registration",
}: { fallback?: React.ReactNode; pendingUrl?: string; completeUrl?: string }) {
  const [pending, setPending] = useState<Pending | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(pendingUrl, { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null)).then(setPending).catch(() => setPending(null));
  }, [pendingUrl]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(completeUrl, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name"), password: form.get("password") }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    // Includes sign-up gate errors (e.g. a databaseHooks domain allow-list): show the server's message.
    if (!res.ok) return setError(data.message ?? "Registration failed.");
    window.location.assign(data.redirectTo ?? "/"); // full load so the server sees the new session
  }

  if (pending === undefined) return null;          // loading
  if (pending === null) return <>{fallback}</>;    // no pending launch: normal sign-up form
  return (
    <form onSubmit={onSubmit}>
      <p>You're coming from 1health. Create your account to finish connecting.</p>
      <label>Email <input name="email" type="email" value={pending.email} readOnly aria-readonly /></label>
      <label>Name <input name="name" defaultValue={[pending.firstName, pending.lastName].filter(Boolean).join(" ")} required /></label>
      <label>Password <input name="password" type="password" autoComplete="new-password" required /></label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{busy ? "Creating account…" : "Create account"}</button>
    </form>
  );
}
