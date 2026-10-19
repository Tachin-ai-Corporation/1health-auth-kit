// lib/one-health/pending-cookie.ts — signed, HttpOnly, 15-minute cookie holding a verified
// 1health identity between the launch and registration (or first sign-in, for confirm-first-link).
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { OneHealthIdentity } from "./protocol";
import { linkCookieKey } from "./config";

const NAME = "oh_pending_link";
const TTL_S = 15 * 60;

export async function setPendingLink(identity: OneHealthIdentity) {
  const token = await new SignJWT({ ...identity }).setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime(`${TTL_S}s`).sign(linkCookieKey());
  (await cookies()).set(NAME, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TTL_S });
}

export async function readPendingLink(): Promise<OneHealthIdentity | null> {
  const token = (await cookies()).get(NAME)?.value;
  if (!token) return null;
  const key = linkCookieKey(); // outside the try: a missing secret is a config error, not "no pending link"
  try {
    const { payload } = await jwtVerify(token, key);
    return payload as unknown as OneHealthIdentity;
  } catch {
    return null;
  }
}

export async function clearPendingLink() {
  (await cookies()).set(NAME, "", { path: "/", maxAge: 0 });
}
