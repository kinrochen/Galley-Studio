import { writeFile } from "node:fs/promises";

import { renderThirdPartyNotices } from "./bundle-license-support.mjs";

await writeFile("THIRD_PARTY_NOTICES.md", await renderThirdPartyNotices());
console.log("Generated THIRD_PARTY_NOTICES.md from the production bundle dependency graph.");
