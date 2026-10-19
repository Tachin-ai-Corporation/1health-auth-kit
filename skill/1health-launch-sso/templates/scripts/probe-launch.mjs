#!/usr/bin/env node
// Check a deployment's 1health configuration WITHOUT a 1health login, QA key or real launch.
// Encrypts a well-formed payload with your local launch secret but a FAKE one-time code, sends it to the launch
// URL, and reads where the app redirects:
//   ?error=token_exchange_failed → the deployment has the SAME secret, decrypted it, and reached 1health
//                                  (which rejected the fake code). Configuration is good.
//   ?error=payload_invalid       → the deployment has no secret for this environment, or a different one
//                                  (e.g. Vercel var scoped to Production only, or not redeployed after setting it).
//   ?error=launch_missing / 404  → route not deployed here (wrong branch/host, or proxy intercepts it).
//
// Usage: node --env-file=.env.local scripts/probe-launch.mjs <launchUrl> [demo|prod]
// One request; safe to run against production. The fake code is never valid.
import { createCipheriv, hkdfSync, randomBytes } from "node:crypto";

const [launchUrl, env = "demo"] = process.argv.slice(2);
const secret = process.env[`ONE_HEALTH_${env.toUpperCase()}_LAUNCH_SECRET`];
if (!launchUrl || !secret) {
  console.error("Usage: node --env-file=.env.local scripts/probe-launch.mjs <launchUrl> [demo|prod]  (needs ONE_HEALTH_<ENV>_LAUNCH_SECRET)");
  process.exit(1);
}
const key = Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), Buffer.alloc(0), 32));
const iv = randomBytes(12);
const c = createCipheriv("aes-256-gcm", key, iv);
const pt = JSON.stringify({ required: { apiKey: { name: "probe" }, tenant: { id: 0 }, user: { id: 0 }, oneTimeCode: { value: "PROBEprobe000000" } } });
const lpl = Buffer.concat([iv, c.update(pt), c.final(), c.getAuthTag()]).toString("base64");

const res = await fetch(`${launchUrl}?lpl=${encodeURIComponent(lpl)}`, { redirect: "manual" });
const location = res.headers.get("location") ?? "";
const code = new URL(location || "http://x/", launchUrl).searchParams.get("error");
const verdict = {
  token_exchange_failed: "OK: secret matches and 1health is reachable.",
  payload_invalid: "Secret missing or different on this deployment (check env var scope and redeploy).",
  launch_missing: "Route reached but lpl was dropped (proxy/rewrite stripping the query?).",
}[code ?? ""] ?? (res.status === 404 ? "Launch route not deployed at this URL." : "Unexpected; inspect the response.");
console.log(`${res.status} ${location || "(no redirect)"}\n${verdict}`);
process.exit(code === "token_exchange_failed" ? 0 : 2);
