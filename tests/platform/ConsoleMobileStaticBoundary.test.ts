import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("console mobile static boundary", () => {
  it("keeps every desktop console dependency behind DesktopConsoleRuntime", () => {
    const main = readFileSync(resolve("src/main.ts"), "utf8");
    const forbiddenStatic = [
      "GalleyWorkbenchView",
      "ThemeLabView",
      "EditorFactory",
      "GenerationPipeline",
      "DesktopGenerationRuntime",
      "DesktopThemeRuntime",
      "SkillArchiveImporter",
      "ImportedSkillRepository",
      "WechatRepairService",
      "RichTextClipboard",
      "ExportService",
      "ConnectionDiagnostic",
      "SecretStore"
    ];

    for (const dependency of forbiddenStatic) {
      expect(main, dependency).not.toMatch(
        new RegExp(`from\\s+["'][^"']*${dependency}[^"']*["']`, "u")
      );
    }
    expect(main).toContain('import("./platform/DesktopConsoleRuntime")');
    expect(main).not.toContain("window.prompt(");
  });

  it("keeps mobile pages free of forbidden action selectors", () => {
    const view = readFileSync(resolve("src/console/GalleyConsoleView.ts"), "utf8");
    expect(view).toContain("MOBILE_CONSOLE_ROUTES");
    expect(view).not.toContain("executeCommandById");
    expect(view).not.toContain("window.prompt");
  });
});
