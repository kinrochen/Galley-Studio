import { spawnSync } from "node:child_process";

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", "tests/benchmark/LongDocument.benchmark.test.ts"],
  { cwd: process.cwd(), encoding: "utf8", stdio: "inherit" }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
