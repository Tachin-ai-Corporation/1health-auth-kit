import { createHmac } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEMO_APP_ID, DEMO_SECRET, encryptPayload, fakeJwt, launchPayload } from "./helpers"
import * as p from "@/lib/one-health/protocol"

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.ONE_HEALTH_ALLOWED_TENANT_IDS
})

const CODE = "Ab12Cd34Ef56Gh78"

function mockFetch(myself: object | Response, claims: object = { externalApplicationId: Number(DEMO_APP_ID) }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).endsWith("/user/token")) {
      return new Response(JSON.stringify({ access_token: fakeJwt(claims), expires_in: 3600 }))
    }
    expect(String(url)).toBe("https://demo.1health.io/api/v2/user/myself")
    expect((init?.headers as Record<string, string>).Authorization).toMatch(/^Bearer h\./)
    return myself instanceof Response ? myself : new Response(JSON.stringify(myself))
  })
}

describe("decryptLaunchPayload", () => {
  it("decrypts and detects the environment from the secret that authenticates it", () => {
    const r = p.decryptLaunchPayload(encryptPayload(launchPayload({ code: CODE })))
    expect(r).toMatchObject({ env: "demo", tenantId: "7", userId: "9", code: CODE })
    expect(r.optional.user_first_name).toBe("Jane")
  })
  it("rejects a payload encrypted with another secret", () => {
    expect(() => p.decryptLaunchPayload(encryptPayload(launchPayload(), "other-secret-xxxxxxxxxxxx"))).toThrow("payload_invalid")
  })
  it("rejects malformed one-time codes", () => {
    expect(() => p.decryptLaunchPayload(encryptPayload(launchPayload({ code: "short" })))).toThrow("payload_invalid")
  })
  it("rejects payloads missing tenant or user", () => {
    const bad = { required: { oneTimeCode: { value: CODE } } }
    expect(() => p.decryptLaunchPayload(encryptPayload(bad))).toThrow("payload_invalid")
  })
  it("rejects garbage and truncated input", () => {
    expect(() => p.decryptLaunchPayload("AAAA")).toThrow("payload_invalid")
    expect(() => p.decryptLaunchPayload(Buffer.alloc(40).toString("base64"))).toThrow("payload_invalid")
  })
  it("throws LaunchError instances with a code", () => {
    try {
      p.decryptLaunchPayload("AAAA")
    } catch (e) {
      expect(e).toBeInstanceOf(p.LaunchError)
      expect((e as InstanceType<typeof p.LaunchError>).code).toBe("payload_invalid")
    }
  })
})

describe("redeemOneTimeCode", () => {
  it("signs the code with HMAC-SHA256 of the RAW secret (base64) and posts to the demo token endpoint", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "t", expires_in: 1 })))
    await p.redeemOneTimeCode("demo", CODE)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe("https://demo.1health.io/api/v2/public/external-application/auth/oauth2/user/token")
    const body = JSON.parse(String(init?.body))
    // Known vector (cross-checked with `openssl dgst -sha256 -hmac`).
    expect(body).toEqual({ securityCode: CODE, signature: createHmac("sha256", DEMO_SECRET).update(CODE).digest("base64") })
    expect(body.signature).toBe("TTRi4Lro/NcbBlyM7ERttoCASE1ly+AsX19ds2MZiRg=")
  })
  it("maps a non-2xx or token-less response to token_exchange_failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 400 }))
    await expect(p.redeemOneTimeCode("demo", CODE)).rejects.toThrow("token_exchange_failed")
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }))
    await expect(p.redeemOneTimeCode("demo", CODE)).rejects.toThrow("token_exchange_failed")
  })
})

describe("resolveLaunch", () => {
  const lpl = () => encryptPayload(launchPayload())

  it("returns a lower-cased verified identity with name prefill", async () => {
    mockFetch({ email: " Jane@Example.com ", emailVerified: true })
    await expect(p.resolveLaunch(lpl())).resolves.toEqual({
      env: "demo", tenantId: "7", userId: "9", email: "jane@example.com", firstName: "Jane", lastName: "Doe",
    })
  })
  it("rejects tokens issued for another app", async () => {
    mockFetch({ email: "a@b.co", emailVerified: true }, { externalApplicationId: 99 })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("wrong_application")
  })
  it("maps a non-JWT access token to token_exchange_failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "not-a-jwt" })))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("token_exchange_failed")
  })
  it("maps a failed /myself to identity_lookup_failed", async () => {
    mockFetch(new Response("nope", { status: 500 }))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_lookup_failed")
  })
  it("maps a non-JSON /myself to identity_lookup_failed", async () => {
    mockFetch(new Response("<html>", { status: 200 }))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_lookup_failed")
  })
  it("rejects a profile without email", async () => {
    mockFetch({ emailVerified: true })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_no_email")
  })
  it("rejects a username in the email field (demo QA/system users)", async () => {
    mockFetch({ email: "system_1health_carrier-qa-manager", emailVerified: true })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_no_email")
  })
  it("rejects an unverified (or missing emailVerified) email", async () => {
    mockFetch({ email: "a@b.co", emailVerified: false })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("email_not_verified")
    vi.restoreAllMocks()
    mockFetch({ email: "a@b.co" })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("email_not_verified")
  })
  it("maps network failures to stable codes", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("token_exchange_failed")
    vi.restoreAllMocks()
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: fakeJwt({ externalApplicationId: Number(DEMO_APP_ID) }) })))
      .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_lookup_failed")
  })
  it("maps a non-object /myself body to identity_lookup_failed", async () => {
    mockFetch(new Response("null"))
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("identity_lookup_failed")
  })
  it("enforces the tenant allow-list", async () => {
    process.env.ONE_HEALTH_ALLOWED_TENANT_IDS = "demo:8, prod:7"
    mockFetch({ email: "a@b.co", emailVerified: true })
    await expect(p.resolveLaunch(lpl())).rejects.toThrow("tenant_not_allowed")
    process.env.ONE_HEALTH_ALLOWED_TENANT_IDS = "demo:7"
    await expect(p.resolveLaunch(lpl())).resolves.toMatchObject({ tenantId: "7" })
  })
})
