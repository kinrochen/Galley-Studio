import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { obsidian: fileURLToPath(new URL("./tests/setup/obsidian.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["tests/**/*.test.ts"], restoreMocks: true }
});
