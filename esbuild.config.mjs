import { builtinModules } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import * as esbuild from "esbuild";

const production = process.argv.includes("production");
const watch = process.argv.includes("--watch");
const nodeBuiltins = builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]);
const deferredEditorBoundary = {
  name: "galley-deferred-editor-boundary",
  setup(build) {
    build.onLoad({ filter: /src\/main\.ts$/ }, async ({ path }) => ({
      contents: `${await readFile(path, "utf8")}\nexport const __loadBundledEditorBoundary = () => import("./editor/EditorFactory");\n`,
      loader: "ts"
    }));
  }
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", ...nodeBuiltins],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  loader: { ".md": "text" },
  plugins: [deferredEditorBoundary],
  sourcemap: production ? false : "inline",
  minify: production,
  metafile: production,
  outfile: "main.js",
  logLevel: "info"
});

if (watch) {
  await context.watch();
} else {
  const result = await context.rebuild();
  if (production && result.metafile) {
    await mkdir("release", { recursive: true });
    await writeFile(
      "release/.galley-esbuild-meta.json",
      `${JSON.stringify(result.metafile, null, 2)}\n`
    );
  }
  await context.dispose();
}
