// vitest setupFiles: runs before each test file's imports, because lib/one-health/protocol.ts reads its env at
// import time. (Don't set env with top-level await or vi.hoisted: TLA fails `tsc` when tsconfig targets ES6, and
// vi.hoisted can't reference imports.)
import { DEMO_APP_ID, DEMO_SECRET } from "./one-health/helpers";

process.env.ONE_HEALTH_DEMO_LAUNCH_SECRET = DEMO_SECRET;
process.env.ONE_HEALTH_DEMO_APP_ID = DEMO_APP_ID;
process.env.BETTER_AUTH_SECRET = "x".repeat(40);
delete process.env.ONE_HEALTH_PROD_LAUNCH_SECRET;
delete process.env.ONE_HEALTH_PROD_APP_ID;
delete process.env.ONE_HEALTH_ALLOWED_TENANT_IDS;
delete process.env.ONE_HEALTH_LINK_POLICY;
