import { readFile } from "node:fs/promises";

const main = await readFile("src/main.ts", "utf8");
const capabilities = await readFile("src/platform/PlatformCapabilities.ts", "utf8");
const failures = [];
for (const forbidden of [
  "ThemeGenerationService",
  "SkillArchiveImporter",
  "ImportedSkillRepository",
  "DesktopThemeRuntime"
]) {
  const staticImport = new RegExp(`from\\s+["'][^"']*${forbidden}[^"']*["']`, "u");
  if (staticImport.test(main)) failures.push(`main.ts statically imports ${forbidden}`);
}
if (!main.includes('import("./platform/DesktopThemeRuntime")')) {
  failures.push("desktop Theme runtime is not dynamically isolated");
}
if (!/canGenerate:\s*!isMobile/u.test(capabilities) || !/canImportSkill:\s*!isMobile/u.test(capabilities)) {
  failures.push("mobile capability gates for generation/import are missing");
}
if (!/canPreview:\s*true/u.test(capabilities)) {
  failures.push("mobile safe preview capability is missing");
}
const desktopGuard = main.indexOf("if (this.canGenerate)");
for (const command of [
  "open-theme-lab",
  "theme-import-zip",
  "theme-export-zip",
  "theme-toggle-enabled",
  "theme-delete",
  "skill-import-zip",
  "skill-activate-imported"
]) {
  const position = main.indexOf(`id: "${command}"`);
  if (position < desktopGuard) failures.push(`${command} is outside the desktop registration guard`);
}
if (failures.length > 0) throw new Error(`Mobile/static audit failed:\n${failures.join("\n")}`);
console.log("Mobile/static audit passed: preview-only mobile boundary is preserved.");
