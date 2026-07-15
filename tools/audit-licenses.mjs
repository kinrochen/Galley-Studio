import { readFile } from "node:fs/promises";

const ACCEPTED = new Set([
  "(MPL-2.0 OR Apache-2.0)",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MIT-0"
]);
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const failures = [];
for (const [path, entry] of Object.entries(lock.packages ?? {})) {
  if (!path) continue;
  if (typeof entry.license !== "string" || !ACCEPTED.has(entry.license)) {
    failures.push(`${path}: ${String(entry.license ?? "missing")}`);
  }
}
const license = await readFile("LICENSE", "utf8");
const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  failures.push("LICENSE is not AGPL-3.0 text");
}
for (const required of [
  "ba1f4175519b481cb3566616c9e5178705067904",
  "dompurify",
  "fflate",
  "hugerte",
  "zod"
]) {
  if (!notices.toLowerCase().includes(required.toLowerCase())) {
    failures.push(`THIRD_PARTY_NOTICES.md is missing ${required}`);
  }
}
if (failures.length > 0) {
  throw new Error(`License audit failed:\n${failures.join("\n")}`);
}
console.log(`License audit passed for ${Object.keys(lock.packages).length - 1} locked packages.`);
