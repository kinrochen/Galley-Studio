import { readFile } from "node:fs/promises";

import {
  GALLEY_SOURCE_URL,
  loadBundleLicenseInventory,
  renderThirdPartyNotices,
  UPSTREAM_COMMIT
} from "./bundle-license-support.mjs";

const ACCEPTED = new Set([
  "(MPL-2.0 OR Apache-2.0)",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MIT-0"
]);
const failures = [];
const license = await readFile("LICENSE", "utf8");
const notices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const packages = await loadBundleLicenseInventory();
if (!license.includes("GNU AFFERO GENERAL PUBLIC LICENSE")) {
  failures.push("LICENSE is not complete AGPL-3.0 text");
}
if (notices !== await renderThirdPartyNotices()) {
  failures.push("THIRD_PARTY_NOTICES.md is stale or incomplete for the production bundle");
}
for (const packageInfo of packages) {
  if (!ACCEPTED.has(packageInfo.license)) {
    failures.push(`${packageInfo.name}@${packageInfo.version}: ${packageInfo.license}`);
  }
  for (const file of packageInfo.licenseFiles) {
    if (!notices.includes(file.text)) {
      failures.push(`${packageInfo.name}@${packageInfo.version}: missing full ${file.filename}`);
    }
  }
}
for (const required of [
  GALLEY_SOURCE_URL,
  UPSTREAM_COMMIT,
  "Permission is hereby granted, free of charge",
  "Apache License",
  "Mozilla Public License Version 2.0",
  "Copyright"
]) {
  if (!notices.includes(required)) failures.push(`THIRD_PARTY_NOTICES.md is missing ${required}`);
}
if (failures.length > 0) throw new Error(`License audit failed:\n${failures.join("\n")}`);
console.log(`License audit passed for ${packages.length} packages in the production bundle.`);
