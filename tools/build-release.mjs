import { mkdir, readFile, writeFile } from "node:fs/promises";
import { strToU8, unzipSync, zipSync } from "fflate";

const VERSION = "0.2.5";
const OUTPUT_PATH = "release/galley-studio-0.2.5.zip";
const RELEASE_FILES = Object.freeze([
  "main.js",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
]);
const STABLE_MTIME = new Date("1980-01-01T00:00:00.000Z");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
if (manifest.version !== VERSION) throw new Error("Release manifest version mismatch.");
if (manifest.id !== "galley-studio" || manifest.name !== "Galley Studio") {
  throw new Error("Release manifest identity mismatch.");
}
if (manifest.isDesktopOnly !== false || manifest.minAppVersion !== "1.11.4") {
  throw new Error("Release manifest platform contract mismatch.");
}
if (
  manifest.author !== "Kinrochen" ||
  manifest.fundingUrl !== "https://ifdian.net/a/kinrochen"
) {
  throw new Error("Release manifest author/funding metadata mismatch.");
}

const entries = {};
const originals = new Map();
for (const path of RELEASE_FILES) {
  const bytes = new Uint8Array(await readFile(path));
  originals.set(path, bytes);
  entries[path] = [bytes, { level: 9, mtime: STABLE_MTIME }];
}
const archive = zipSync(entries);
const unpacked = unzipSync(archive);
const actual = Object.keys(unpacked).sort();
const expected = [...RELEASE_FILES].sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(`Release ZIP entries differ: ${actual.join(", ")}`);
}
for (const path of RELEASE_FILES) {
  if (!equalBytes(unpacked[path], originals.get(path))) {
    throw new Error(`Release ZIP verification failed for ${path}.`);
  }
}
const notices = new TextDecoder().decode(unpacked["THIRD_PARTY_NOTICES.md"]);
for (const required of [
  "https://github.com/kinrochen/Galley-Studio",
  "ba1f4175519b481cb3566616c9e5178705067904",
  "Permission is hereby granted, free of charge",
  "Apache License",
  "Mozilla Public License Version 2.0"
]) {
  if (!notices.includes(required)) {
    throw new Error(`Release ZIP lost required source/license notice: ${required}`);
  }
}
const license = new TextDecoder().decode(unpacked.LICENSE);
if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  throw new Error("Release ZIP lost AGPL-3.0 license text.");
}
await mkdir("release", { recursive: true });
await writeFile(OUTPUT_PATH, archive);
console.log(`Release built and verified: ${OUTPUT_PATH} (${archive.byteLength} bytes; ${expected.join(", ")})`);

function equalBytes(left, right) {
  return Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
}
