import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mobile static startup boundary", () => {
  it("keeps HugeRTE and model/Skill repair behind desktop-only dynamic imports", () => {
    const main = readFileSync(resolve("src/main.ts"), "utf8");
    const editorFactory = readFileSync(resolve("src/editor/EditorFactory.ts"), "utf8");

    expect(main).not.toMatch(/from\s+["'][^"']*HugeRteAdapter["']/u);
    expect(main).not.toMatch(/from\s+["']\.\/platform\/DesktopGenerationRuntime["']/u);
    expect(main).not.toMatch(/from\s+["'][^"']*(?:OpenAiCompatibleClient|SkillSession|WechatRepairService)["']/u);
    expect(main).toContain('import("./platform/DesktopConsoleRuntime")');
    expect(editorFactory).not.toMatch(/from\s+["']\.\/HugeRteAdapter["']/u);
    expect(editorFactory).toContain('import("./HugeRteAdapter")');
  });
});
