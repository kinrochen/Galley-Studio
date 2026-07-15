import { describe, expect, it, vi } from "vitest";

import { HugeRteAdapter } from "../../src/editor/HugeRteAdapter";
import {
  PortableInlineProfile,
  StandardWebProfile,
  WechatProfile
} from "../../src/export/profiles";
import { validateWechatHtml } from "../../src/export/WechatValidator";
import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";
import { BundledSkillLoader } from "../../src/skill/BundledSkillLoader";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import { contentTurn, validAuthoringHtmlForIds } from "../support/generationFixtures";
import { makeProviderCapabilities } from "../support/phase1Factories";

const MARKDOWN = [
  "# Galley acceptance",
  "",
  "> A recorded six-theme workflow.",
  "",
  "## Section one",
  "",
  "A paragraph with **important content**.",
  "",
  "- first item",
  "- second item",
  "",
  "```ts",
  "const galley = true;",
  "```",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |"
].join("\n");

describe("recorded six-theme first-release workflow", () => {
  it("generates, visually edits, and exports all three profiles for every built-in theme", async () => {
    vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    })));
    const skillPackage = await new BundledSkillLoader().load();
    const vfs = new SkillVirtualFileSystem(skillPackage.files);
    const themes = new BuiltInThemeRepository(vfs);
    expect(themes.list()).toHaveLength(6);
    const source = annotateMarkdown(MARKDOWN);

    for (const theme of themes.list()) {
      const client = new ScriptedChatClient([
        contentTurn(validAuthoringHtmlForIds(source.blocks.map(({ id }) => id)))
      ]);
      const session = new SkillSession({
        client,
        target: { baseUrl: "https://recorded.invalid/v1", model: "recorded-model" },
        capabilities: makeProviderCapabilities({ tools: false }),
        skillPackage,
        vfs,
        packageHash: BUNDLED_SKILL.archiveSha256
      });
      const generated = await new GenerationPipeline({ session, themes }).generate(
        {
          sourcePath: "acceptance/article.md",
          markdown: MARKDOWN,
          manualThemeId: theme.id,
          modelContextWindow: 128_000
        },
        new AbortController().signal
      );
      expect(generated.status, theme.id).toBe("verified");

      const parsed = new DOMParser().parseFromString(generated.html, "text/html");
      const host = document.createElement("div");
      document.body.append(host);
      const editor = new HugeRteAdapter();
      await editor.mount(host, parsed.body.innerHTML, {
        documentBaseUrl: "app://vault/",
        onChange: () => undefined
      });
      const visualBody = document.createElement("template");
      visualBody.innerHTML = parsed.body.innerHTML;
      const firstBlock = visualBody.content.querySelector(
        `[data-galley-source="${source.blocks[0]!.id}"]`
      );
      if (!firstBlock) throw new Error("Recorded visual edit target is missing.");
      firstBlock.textContent = `visually edited ${theme.id}`;
      editor.setHtml(visualBody.innerHTML);
      parsed.body.innerHTML = editor.getHtml();
      editor.destroy();
      host.remove();
      const edited = `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
      expect(validateSourceCoverage(source, edited), theme.id).toEqual([]);
      expect(edited).toContain(`visually edited ${theme.id}`);

      const input = {
        html: edited,
        provenance: {
          documentId: "123e4567-e89b-42d3-a456-426614174000",
          sourceHtmlHash: "a".repeat(64)
        }
      };
      const [web, inline, wechat] = await Promise.all([
        new StandardWebProfile().transform(input),
        new PortableInlineProfile().transform(input),
        new WechatProfile().transform(input)
      ]);
      expect(web.html, theme.id).toMatch(/^<!DOCTYPE html>/u);
      expect(inline.html, theme.id).not.toMatch(/<!DOCTYPE|<script/iu);
      expect(validateWechatHtml(wechat.html), theme.id).toMatchObject({ valid: true });
      expect(generated.html).not.toContain("visually edited");
    }
    vi.unstubAllGlobals();
  }, 30_000);
});
