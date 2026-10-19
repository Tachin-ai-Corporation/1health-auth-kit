// Not a symlink: the templates' config resolves "@" relative to itself. preserveSymlinks keeps the symlinked
// templates resolving "./protocol" and node_modules from this directory, as they would inside an app.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) }, preserveSymlinks: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"], setupFiles: ["tests/setup-env.ts"] },
});
