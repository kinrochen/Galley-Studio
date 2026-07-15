import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { unzipSync } from "fflate";

const IGNORED = new Set([".git", ".worktrees", "node_modules", "coverage", "dist", ".superpowers"]);
const TEXT_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".json", ".md", ".css", ".yml", ".yaml", ".html", ".txt"]);
const PATTERNS = [
  /\bsk-[a-z0-9_-]{20,}\b/iu,
  /\b(?:api[_-]?key|authorization)\s*[:=]\s*["'][a-z0-9._-]{20,}["']/iu,
  /\bBearer\s+[a-z0-9._-]{20,}\b/iu
];
const failures = [];

async function walk(path) {
  for (const name of await readdir(path)) {
    if (IGNORED.has(name)) continue;
    const absolute = join(path, name);
    const info = await stat(absolute);
    if (info.isDirectory()) await walk(absolute);
    else if (TEXT_EXTENSIONS.has(extname(name)) && info.size <= 10 * 1024 * 1024) {
      inspect(relative(process.cwd(), absolute), await readFile(absolute, "utf8"));
    }
  }
}

function inspect(path, text) {
  for (const pattern of PATTERNS) {
    if (pattern.test(text)) failures.push(`${path}: ${pattern.source}`);
  }
}

await walk(process.cwd());
for (const required of ["main.js", "release/galley-0.1.0.zip"]) {
  try {
    const info = await stat(required);
    if (!info.isFile() || info.size === 0) failures.push(`${required}: missing or empty required artifact`);
  } catch (error) {
    if (error?.code === "ENOENT") failures.push(`${required}: missing required artifact`);
    else throw error;
  }
}
try {
  const archive = unzipSync(new Uint8Array(await readFile("release/galley-0.1.0.zip")));
  for (const [path, bytes] of Object.entries(archive)) {
    inspect(`release:${path}`, new TextDecoder().decode(bytes));
  }
} catch (error) {
  if (error?.code !== "ENOENT") failures.push(`release/galley-0.1.0.zip: invalid ZIP (${error instanceof Error ? error.message : String(error)})`);
}
if (failures.length > 0) throw new Error(`Secret audit failed:\n${failures.join("\n")}`);
console.log("Secret audit passed: no API-key-shaped value is present in source, fixtures, docs, or release.");
