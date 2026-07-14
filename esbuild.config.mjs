import { builtinModules } from "node:module";

import * as esbuild from "esbuild";

const production = process.argv.includes("production");
const watch = process.argv.includes("--watch");
const nodeBuiltins = builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]);

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...nodeBuiltins],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: "main.js",
  logLevel: "info"
});

if (watch) {
  await context.watch();
} else {
  await context.rebuild();
  await context.dispose();
}
