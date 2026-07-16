import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const failures = [];
if (packageJson.version !== "0.2.2" || lock.version !== "0.2.2" || manifest.version !== "0.2.2") {
  failures.push("package, lockfile, and manifest versions must all be 0.2.2");
}
if (
  packageJson.name !== "galley-studio-obsidian" ||
  lock.name !== "galley-studio-obsidian" ||
  manifest.id !== "galley-studio" ||
  manifest.name !== "Galley Studio"
) {
  failures.push("package and manifest identities must match Galley Studio");
}
if (packageJson.repository?.url !== "https://github.com/kinrochen/Galley-Studio.git") {
  failures.push("package repository must point to kinrochen/Galley-Studio");
}
if (manifest.minAppVersion !== "1.11.4" || manifest.isDesktopOnly !== false) {
  failures.push("manifest platform contract changed");
}
if (manifest.author !== "Kinrochen") {
  failures.push("manifest author must be Kinrochen");
}
if (manifest.fundingUrl !== "https://ifdian.net/a/kinrochen") {
  failures.push("manifest fundingUrl changed");
}
if (
  packageJson.author !== manifest.author ||
  packageJson.funding?.url !== manifest.fundingUrl ||
  packageJson.license !== "AGPL-3.0-or-later"
) {
  failures.push("package metadata does not match manifest author/funding/license");
}
for (const [name, version] of Object.entries({
  ...packageJson.dependencies,
  ...packageJson.devDependencies
})) {
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(String(version))) {
    failures.push(`${name} is not pinned exactly: ${version}`);
  }
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (locked !== version) failures.push(`${name} lock mismatch: ${locked} != ${version}`);
}
if (failures.length > 0) throw new Error(`Package audit failed:\n${failures.join("\n")}`);
console.log("Package audit passed: versions and direct dependencies are pinned.");
