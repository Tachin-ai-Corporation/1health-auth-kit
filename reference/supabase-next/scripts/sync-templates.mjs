// Copies the skill templates into this app (Next/Turbopack resolve symlinks to their real path, so symlinked
// templates couldn't find this app's node_modules). `node scripts/sync-templates.mjs --check` fails on drift.
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const T = join(root, "../../skill/1health-launch-sso/templates");
const MAP = {
  "ts/protocol.ts": "lib/one-health/protocol.ts",
  "supabase-next/session.ts": "lib/one-health/session.ts",
  "supabase-next/users.ts": "lib/one-health/users.ts",
  "supabase-next/pending-cookie.ts": "lib/one-health/pending-cookie.ts",
  "supabase-next/launch-route.ts": "lib/one-health/launch-route.ts",
  "supabase-next/registration-routes.ts": "lib/one-health/registration-routes.ts",
  "supabase-next/confirm-link-route.ts": "lib/one-health/confirm-link-route.ts",
  "supabase-next/config.ts": "lib/one-health/config.ts",
  "supabase-next/rate-limit.ts": "lib/one-health/rate-limit.ts",
  "shared/messages.ts": "lib/one-health/messages.ts",
  "shared/OneHealthRegistration.tsx": "components/OneHealthRegistration.tsx",
};
const check = process.argv.includes("--check");
let drift = 0;
for (const [src, dst] of Object.entries(MAP)) {
  const a = join(T, src), b = join(root, dst);
  if (check) {
    let same = false;
    try { same = readFileSync(a, "utf8") === readFileSync(b, "utf8"); } catch {}
    if (!same) { console.error(`drift: ${dst} != templates/${src}`); drift++; }
  } else copyFileSync(a, b);
}
if (check && drift) process.exit(1);
console.log(check ? "templates in sync" : `copied ${Object.keys(MAP).length} template files`);
