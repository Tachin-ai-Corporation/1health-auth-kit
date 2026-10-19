// Only needed if the repo has no test runner yet: `pnpm add -D vitest`, add "test": "vitest run".
// Put the test files under tests/one-health/ and setup-env.ts under tests/.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },  // match tsconfig "paths"
  test: { environment: "node", include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup-env.ts"] },
});
