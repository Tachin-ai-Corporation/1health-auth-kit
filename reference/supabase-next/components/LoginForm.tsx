"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** Normal email/password sign-in. With ?source=1health (confirm-first-link), links the pending identity after. */
export function LoginForm({ notice, confirmLink }: { notice: string | null; confirmLink: boolean }) {
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) return setError(error.message);
    if (confirmLink) await fetch("/1health/confirm-link", { method: "POST", credentials: "same-origin" });
    window.location.assign("/");
  }
  return (
    <form onSubmit={onSubmit}>
      <h1>Sign in</h1>
      {notice && <p role="status" data-testid="notice">{notice}</p>}
      <p><label>Email <input name="email" type="email" required /></label></p>
      <p><label>Password <input name="password" type="password" required /></label></p>
      {error && <p role="alert">{error}</p>}
      <button type="submit">Sign in</button> <a href="/signup">Create account</a>
    </form>
  );
}
