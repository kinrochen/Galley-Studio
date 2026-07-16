import { describe, expect, it, vi } from "vitest";

import { SkillDrivenGenerationPipeline } from "../../src/generation/SkillDrivenGenerationPipeline";
import type { SkillSession } from "../../src/skill/SkillSession";
import type { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../../src/themes/ThemeIndex";

const THEME: ThemeDefinition = {
  id: "test-theme",
  name: "Test theme",
  primaryColor: "#111111",
  useCases: "Tests",
  file: "references/theme-test-theme.md",
  underlineCss: "border-bottom: 1px solid #111"
};

describe("SkillDrivenGenerationPipeline", () => {
  it("persists only the HTML artifact when the Agent adds conversational context", async () => {
    const response = [
      "I have everything I need. I will now produce the article. ```html",
      '<section style="max-width: 677px"><p>final article</p></section>',
      "```",
      "Finished."
    ].join("\n");
    const completeScopedWithRequiredFiles = vi.fn(async () => response);
    const onModelEvent = vi.fn();
    const pipeline = new SkillDrivenGenerationPipeline({
      session: {
        completeScopedWithRequiredFiles,
        audit: () => ({
          skillId: "gzh-design",
          skillVersion: "test",
          packageHash: "hash",
          loadMode: "injected",
          files: ["SKILL.md"]
        })
      } as unknown as SkillSession,
      themes: {
        get: (id: string) => id === THEME.id ? THEME : undefined,
        list: () => [THEME]
      } as unknown as BuiltInThemeRepository,
      onModelEvent
    });

    const result = await pipeline.generate(
      {
        sourcePath: "notes/article.md",
        markdown: "# Article\n\nBody",
        manualThemeId: THEME.id,
        modelContextWindow: 128_000
      },
      new AbortController().signal
    );

    expect(result.html).toBe(
      '<section style="max-width: 677px"><p>final article</p></section>'
    );
    expect(result.html).not.toContain("I have everything");
    expect(result.html).not.toContain("```");
    expect(onModelEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "prompt",
        text: expect.stringContaining("Markdown source:")
      })
    );
    expect(completeScopedWithRequiredFiles).toHaveBeenCalledWith(
      expect.stringContaining("Markdown source:"),
      ["references/common-components.md", THEME.file],
      expect.any(AbortSignal)
    );
    expect(completeScopedWithRequiredFiles).toHaveBeenCalledWith(
      expect.stringContaining("Do not ask the user to provide article text"),
      ["references/common-components.md", THEME.file],
      expect.any(AbortSignal)
    );
  });

  it("rejects a response that contains no usable article HTML", async () => {
    const pipeline = new SkillDrivenGenerationPipeline({
      session: {
        completeScopedWithRequiredFiles: async () =>
          "I need more context before I can continue.",
        audit: vi.fn()
      } as unknown as SkillSession,
      themes: {
        get: () => THEME,
        list: () => [THEME]
      } as unknown as BuiltInThemeRepository
    });

    await expect(
      pipeline.generate(
        {
          sourcePath: "notes/article.md",
          markdown: "# Article",
          manualThemeId: THEME.id,
          modelContextWindow: 128_000
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "generation_empty" });
  });
});
