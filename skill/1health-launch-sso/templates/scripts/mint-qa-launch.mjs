#!/usr/bin/env node
// Mint a real 1health demo launch for a QA user and print a one-time launch link for your local or
// preview build. The portal only launches the URL registered in 1health; this lets you test any other.
//
// Usage: node --env-file=.env.local scripts/mint-qa-launch.mjs [launchUrl] [role]
//   launchUrl default: http://localhost:3000/api/auth/1health/launch  (Supabase templates: …/1health/launch)
//   role: manager (default) | employee | sys_admin -> reads ONE_HEALTH_QA_<ROLE>_KEY
//   env: ONE_HEALTH_QA_<ROLE>_KEY (or ONE_HEALTH_QA_KEY) — demo QA user API key; never production, never commit
//        ONE_HEALTH_DEMO_APP_ID — the External Application id on demo
//
// Open the printed link immediately; it works once. Demo throttles bursts — don't loop on 401s.
// The target deployment must have ONE_HEALTH_DEMO_APP_ID and ONE_HEALTH_DEMO_LAUNCH_SECRET set.
const launchUrl = process.argv[2] ?? "http://localhost:3000/api/auth/1health/launch"
const role = (process.argv[3] ?? "manager").toUpperCase()
const keyVar = `ONE_HEALTH_QA_${role}_KEY`
const key = process.env[keyVar] ?? process.env.ONE_HEALTH_QA_KEY
const appId = process.env.ONE_HEALTH_DEMO_APP_ID
if (!key || !appId) {
  console.error(`Set ${keyVar} (or ONE_HEALTH_QA_KEY) and ONE_HEALTH_DEMO_APP_ID, e.g. in .env.local.`)
  process.exit(1)
}
const res = await fetch(`https://demo.1health.io/api/v2/external-application/${encodeURIComponent(appId)}/launch-payload`, {
  headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
})
if (!res.ok) {
  console.error(`1health refused the launch payload (${res.status}). A 403 means this key's role may not launch the app;`)
  console.error("check GET /api/v2/token/context/api-access with the same key.")
  process.exit(1)
}
const { launchPayload } = await res.json()
console.log(`${launchUrl}?lpl=${encodeURIComponent(launchPayload)}`)
