// Test helpers: encrypt launch payloads the way 1health does, and mock its two endpoints.
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto"

export const DEMO_SECRET = "test-launch-secret-demo-000000"
export const DEMO_APP_ID = "42"

export function encryptPayload(obj: unknown, secret = DEMO_SECRET) {
  const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), Buffer.alloc(0), 32))
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([c.update(JSON.stringify(obj)), c.final()])
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString("base64")
}

export const launchPayload = (opts: { code?: string; tenantId?: number; userId?: number; firstName?: string } = {}) => ({
  required: {
    apiKey: { name: "k" },
    tenant: { id: opts.tenantId ?? 7 },
    user: { id: opts.userId ?? 9 },
    oneTimeCode: { value: opts.code ?? randomBytes(8).toString("hex") },
  },
  optional: { user_first_name: opts.firstName ?? "Jane", user_last_name: "Doe" },
})

export const fakeJwt = (claims: object) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`

