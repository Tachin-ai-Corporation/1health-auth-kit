// End-to-end: drives the real oneHealth plugin through auth.handler with Better Auth's memory adapter and
// mocked 1health endpoints. ADAPT makeAuth() to mirror the repo's lib/auth.ts wherever it matters for 1health:
// sign-up gates (databaseHooks.user.create.before), requireEmailVerification, autoSignIn,
// autoSignInAfterVerification, and the exact plugin options (signInPath / signUpPath / afterLaunchPath). Keep every
// scenario; add repo-specific ones.
import { randomBytes } from "node:crypto"
import { betterAuth } from "better-auth"
import { memoryAdapter } from "better-auth/adapters/memory"
import { APIError, createEmailVerificationToken } from "better-auth/api"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { oneHealth, type OneHealthLaunchEvent as LaunchEvent } from "@/lib/one-health/plugin"
import { DEMO_APP_ID, encryptPayload, fakeJwt, launchPayload } from "./helpers"

const BASE = "http://localhost:3000"
const SIGNUP_DOMAIN = "allowed.example" // stands in for the repo's sign-up gate (e.g. allowed email domains)

function makeAuth(linkPolicy?: "auto-link" | "confirm-first-link") {
  const db: Record<string, Record<string, unknown>[]> = { user: [], account: [], session: [], verification: [] }
  const events: LaunchEvent[] = []
  const auth = betterAuth({
    baseURL: BASE,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true, requireEmailVerification: true, autoSignIn: false },
    emailVerification: { autoSignInAfterVerification: true },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (user.email.split("@").pop() !== SIGNUP_DOMAIN)
              throw new APIError("FORBIDDEN", { message: "Account creation is not available for this email address." })
          },
        },
      },
    },
    plugins: [
      oneHealth({
        linkPolicy,
        signInPath: "/sign-in",
        signUpPath: "/sign-up?invite=open", // a query string here must survive (&source=1health is appended)
        afterLaunchPath: "/",
        onLaunch: (e) => {
          events.push(e)
        },
      }),
    ],
  })
  return { auth, db, events }
}

// 1health mock: each minted code maps to the email /myself returns.
const emailByCode: Record<string, { email: string; verified: boolean }> = {}
const usedCodes = new Set<string>()
function mint(email: string, oneHealthUserId: number, opts: { verified?: boolean; secret?: string } = {}) {
  const code = randomBytes(8).toString("hex")
  emailByCode[code] = { email, verified: opts.verified ?? true }
  return encryptPayload(launchPayload({ code, userId: oneHealthUserId }), opts.secret)
}

beforeAll(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url)
    if (u.endsWith("/user/token")) {
      const { securityCode } = JSON.parse(String(init?.body))
      if (usedCodes.has(securityCode) || !emailByCode[securityCode]) return new Response("{}", { status: 400 })
      usedCodes.add(securityCode) // single-use, like 1health
      const tok = fakeJwt({ externalApplicationId: Number(DEMO_APP_ID), tenantId: 7, code: securityCode })
      return new Response(JSON.stringify({ access_token: tok, expires_in: 3600 }))
    }
    if (u.endsWith("/api/v2/user/myself")) {
      const tok = (init?.headers as Record<string, string>).Authorization.slice(7)
      const { code } = JSON.parse(Buffer.from(tok.split(".")[1], "base64url").toString())
      const { email, verified } = emailByCode[code]
      return new Response(JSON.stringify({ email, emailVerified: verified, firstName: "Jane" }))
    }
    throw new Error(`unexpected fetch ${u}`)
  })
})
afterAll(() => vi.restoreAllMocks())

type Auth = ReturnType<typeof makeAuth>["auth"]
const cookiesOf = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ")
const launch = (auth: Auth, lpl?: string) =>
  auth.handler(new Request(`${BASE}/api/auth/1health/launch${lpl === undefined ? "" : `?lpl=${encodeURIComponent(lpl)}`}`))
const pending = (auth: Auth, cookie: string) => auth.handler(new Request(`${BASE}/api/auth/1health/pending`, { headers: { cookie } }))
const complete = (auth: Auth, cookie: string, body: object) =>
  auth.handler(
    new Request(`${BASE}/api/auth/1health/complete-registration`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    }),
  )
const sessionEmail = async (auth: Auth, r: Response) =>
  (await auth.api.getSession({ headers: new Headers({ cookie: cookiesOf(r) }) }))?.user.email
const oneHealthLinks = (db: ReturnType<typeof makeAuth>["db"]) =>
  db.account.filter((a) => a.providerId === "1health").map((a) => a.accountId)

describe("1health launch (auto-link, repo config)", () => {
  const { auth, db, events } = makeAuth()

  it("existing UNVERIFIED user with a matching email: no link, no session, not marked verified", async () => {
    // Pre-account takeover guard: whoever signed up chose the password, and it may not be the email's owner.
    await auth.api.signUpEmail({ body: { email: `known@${SIGNUP_DOMAIN}`, password: "password123", name: "K" } })
    expect(db.user[0].emailVerified).toBe(false)

    const r = await launch(auth, mint(`Known@${SIGNUP_DOMAIN.toUpperCase()}`, 100))
    expect(r.status).toBe(302)
    expect(r.headers.get("location")).toBe("/sign-in?source=1health")
    expect(r.headers.get("set-cookie") ?? "").not.toMatch(/session_token/)
    expect(oneHealthLinks(db)).toEqual([])
    expect(db.user[0].emailVerified).toBe(false)
    expect(events.at(-1)).toMatchObject({ outcome: "pending_confirm", reason: "account_unverified", oneHealthUserId: "100" })

    // The password alone doesn't link: sign-in is refused until the email is verified.
    const signIn = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { cookie: cookiesOf(r), "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ email: `known@${SIGNUP_DOMAIN}`, password: "password123" }),
      }),
    )
    expect(signIn.status).toBe(403)
    expect(oneHealthLinks(db)).toEqual([])

    // Verifying the email through the normal flow (auto sign-in) links the pending launch.
    const token = await createEmailVerificationToken(process.env.BETTER_AUTH_SECRET!, `known@${SIGNUP_DOMAIN}`)
    const v = await auth.handler(new Request(`${BASE}/api/auth/verify-email?token=${token}`, { headers: { cookie: cookiesOf(r) } }))
    expect(await sessionEmail(auth, v)).toBe(`known@${SIGNUP_DOMAIN}`)
    expect(db.user[0].emailVerified).toBe(true)
    expect(oneHealthLinks(db)).toEqual(["demo:7:100"])
  })

  it("relaunch uses the existing link", async () => {
    const r = await launch(auth, mint(`known@${SIGNUP_DOMAIN}`, 100))
    expect(r.headers.get("location")).toBe("/")
    expect(await sessionEmail(auth, r)).toBe(`known@${SIGNUP_DOMAIN}`)
    expect(oneHealthLinks(db)).toEqual(["demo:7:100"])
  })

  it("linked identity wins even if the 1health email changed", async () => {
    const r = await launch(auth, mint(`renamed@elsewhere.com`, 100))
    expect(await sessionEmail(auth, r)).toBe(`known@${SIGNUP_DOMAIN}`)
  })

  it("unknown email -> sign-up (keeps its query) -> prefilled registration -> signed in and linked", async () => {
    const r = await launch(auth, mint(`new@${SIGNUP_DOMAIN}`, 200))
    expect(r.headers.get("location")).toBe("/sign-up?invite=open&source=1health")
    expect(events.at(-1)).toMatchObject({ outcome: "no_user", oneHealthUserId: "200" })
    const cookie = cookiesOf(r)
    expect(r.headers.get("set-cookie")).toMatch(/oh_pending_link=.*HttpOnly.*Secure.*SameSite=Lax/i)

    const p = await pending(auth, cookie)
    expect(p.status).toBe(200)
    expect(await p.json()).toEqual({ email: `new@${SIGNUP_DOMAIN}`, firstName: "Jane", lastName: "Doe" })

    const c = await complete(auth, cookie, { name: "New User", password: "password123", email: "attacker@evil.com" })
    expect(c.status).toBe(200)
    expect(await c.json()).toEqual({ redirectTo: "/" })
    expect(await sessionEmail(auth, c)).toBe(`new@${SIGNUP_DOMAIN}`) // email comes from the signed cookie, not the body
    const user = db.user.find((u) => u.email === `new@${SIGNUP_DOMAIN}`)!
    expect(user.emailVerified).toBe(true)
    expect(db.account.filter((a) => a.userId === user.id).map((a) => a.providerId).sort()).toEqual(["1health", "credential"])
    expect(c.headers.getSetCookie()).toContainEqual(expect.stringMatching(/^oh_pending_link=;.*Max-Age=0/i))

    // Next launch is silent, and the password works for normal sign-in.
    const again = await launch(auth, mint(`new@${SIGNUP_DOMAIN}`, 200))
    expect(again.headers.get("location")).toBe("/")
    const signIn = await auth.api.signInEmail({ body: { email: `new@${SIGNUP_DOMAIN}`, password: "password123" } })
    expect(signIn.user.email).toBe(`new@${SIGNUP_DOMAIN}`)
  })

  it("unknown email outside the workspace signup domains: the gate's message reaches the form", async () => {
    const r = await launch(auth, mint("outsider@gmail.com", 300))
    expect(r.headers.get("location")).toBe("/sign-up?invite=open&source=1health")
    const c = await complete(auth, cookiesOf(r), { name: "Out", password: "password123" })
    expect(c.status).toBe(403)
    expect((await c.json()).message).toBe("Account creation is not available for this email address.")
    expect(db.user.some((u) => u.email === "outsider@gmail.com")).toBe(false)
  })

  it("registration rejects short passwords and missing pending cookie", async () => {
    const r = await launch(auth, mint(`short@${SIGNUP_DOMAIN}`, 400))
    const short = await complete(auth, cookiesOf(r), { name: "S", password: "123" })
    expect(short.status).toBe(400)
    expect((await short.json()).message).toMatch(/Password must be 8-/)
    const none = await complete(auth, "", { name: "S", password: "password123" })
    expect(none.status).toBe(400)
    expect((await none.json()).message).toMatch(/launch expired/)
    expect((await pending(auth, "")).status).toBe(404)
  })

  it("a different 1health user with an already-linked email -> identity_conflict", async () => {
    const r = await launch(auth, mint(`known@${SIGNUP_DOMAIN}`, 999))
    expect(r.headers.get("location")).toBe("/sign-in?error=identity_conflict")
    expect(r.headers.get("set-cookie") ?? "").not.toMatch(/session_token/)
    expect(events.at(-1)).toMatchObject({ outcome: "failure", reason: "identity_conflict" })
  })

  it("maps bad launches to sign-in error codes without a session", async () => {
    const cases: [string | undefined, string][] = [
      [undefined, "launch_missing"],
      ["AAAA", "payload_invalid"],
      [mint(`known@${SIGNUP_DOMAIN}`, 100, { secret: "some-other-apps-secret-xx" }), "payload_invalid"],
      [mint(`unverified@${SIGNUP_DOMAIN}`, 500, { verified: false }), "email_not_verified"],
    ]
    for (const [lpl, code] of cases) {
      const r = await launch(auth, lpl)
      expect(r.status).toBe(302)
      expect(r.headers.get("location")).toBe(`/sign-in?error=${code}`)
      expect(r.headers.get("set-cookie") ?? "").not.toMatch(/session_token/)
    }
  })

  it("reloading a used launch -> token_exchange_failed", async () => {
    const lpl = mint(`known@${SIGNUP_DOMAIN}`, 100)
    expect((await launch(auth, lpl)).headers.get("location")).toBe("/")
    expect((await launch(auth, lpl)).headers.get("location")).toBe("/sign-in?error=token_exchange_failed")
  })

  it("normal email/password sign-up is unchanged (gate + verification still apply)", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "someone@gmail.com", password: "password123", name: "X" } }),
    ).rejects.toThrow("Account creation is not available")
    await auth.api.signUpEmail({ body: { email: `plain@${SIGNUP_DOMAIN}`, password: "password123", name: "P" } })
    await expect(auth.api.signInEmail({ body: { email: `plain@${SIGNUP_DOMAIN}`, password: "password123" } })).rejects.toThrow()
  })
})

describe("link policy configuration", () => {
  it("an unknown ONE_HEALTH_LINK_POLICY fails at startup instead of defaulting to auto-link", () => {
    vi.stubEnv("ONE_HEALTH_LINK_POLICY", "confirm-first")
    try {
      expect(() => oneHealth()).toThrow(/ONE_HEALTH_LINK_POLICY must be/)
      vi.stubEnv("ONE_HEALTH_LINK_POLICY", "")
      expect(() => oneHealth()).not.toThrow() // empty = unset = auto-link
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("1health launch (confirm-first-link)", () => {
  const { auth, db, events } = makeAuth("confirm-first-link")

  it("first launch asks for sign-in, sign-in links, next launch is silent", async () => {
    await auth.api.signUpEmail({ body: { email: `pat@${SIGNUP_DOMAIN}`, password: "password123", name: "Pat" } })
    db.user[0].emailVerified = true // verified through the normal email flow

    const r = await launch(auth, mint(`pat@${SIGNUP_DOMAIN}`, 600))
    expect(r.headers.get("location")).toBe("/sign-in?source=1health")
    expect(r.headers.get("set-cookie") ?? "").not.toMatch(/session_token/)
    expect(oneHealthLinks(db)).toEqual([])
    expect(events.at(-1)).toMatchObject({ outcome: "pending_confirm" })

    const signIn = await auth.handler(
      new Request(`${BASE}/api/auth/sign-in/email`, {
        method: "POST",
        headers: { cookie: cookiesOf(r), "content-type": "application/json", origin: BASE },
        body: JSON.stringify({ email: `pat@${SIGNUP_DOMAIN}`, password: "password123" }),
      }),
    )
    expect(signIn.status).toBe(200)
    expect(oneHealthLinks(db)).toEqual(["demo:7:600"])

    const again = await launch(auth, mint(`pat@${SIGNUP_DOMAIN}`, 600))
    expect(again.headers.get("location")).toBe("/")
    expect(await sessionEmail(auth, again)).toBe(`pat@${SIGNUP_DOMAIN}`)
  })
})

describe("unexpected server errors", () => {
  it("a database failure during launch -> friendly launch_failed redirect, not a 500", async () => {
    const { auth, db } = makeAuth()
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    Object.defineProperty(db, "account", { get() { throw new Error("db down") } })
    const r = await launch(auth, mint(`dbdown@${SIGNUP_DOMAIN}`, 700))
    expect(r.status).toBe(302)
    expect(r.headers.get("location")).toBe("/sign-in?error=launch_failed")
    expect(err).toHaveBeenCalledWith("[1health] launch failed", expect.anything())
    err.mockRestore()
  })
})
