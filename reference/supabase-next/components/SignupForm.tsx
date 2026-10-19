"use client";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

/** The app's normal sign-up (unchanged by the 1health integration). */
export function SignupForm() {
  const [msg, setMsg] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabaseBrowser().auth.signUp({
      email: String(f.get("email")), password: String(f.get("password")), options: { data: { name: String(f.get("name")) } },
    });
    setMsg(error ? error.message : "Check your email to confirm your account.");
  }
  return (
    <form onSubmit={onSubmit}>
      <h1>Create account</h1>
      <p><label>Name <input name="name" required /></label></p>
      <p><label>Email <input name="email" type="email" required /></label></p>
      <p><label>Password <input name="password" type="password" minLength={8} required /></label></p>
      {msg && <p role="status">{msg}</p>}
      <button type="submit">Create account</button> <a href="/login">Sign in</a>
    </form>
  );
}
