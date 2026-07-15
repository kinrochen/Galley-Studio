import { expect, it } from "vitest";

import type { ChatClient, ChatRequest, ChatTurnResult } from "../../src/ai/AiProtocol";
import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";
import { BundledSkillLoader } from "../../src/skill/BundledSkillLoader";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";
import { makeProviderCapabilities } from "../support/phase1Factories";

class RecordedLongClient implements ChatClient {
  readonly requests: ChatRequest[] = [];

  async complete(request: ChatRequest): Promise<ChatTurnResult> {
    this.requests.push(structuredClone(request));
    const user = [...request.messages].reverse().find(({ role }) => role === "user");
    if (!user || typeof user.content !== "string") throw new Error("Expected text prompt");
    const payload = JSON.parse(
      user.content.slice(user.content.lastIndexOf("Structured payload (canonical JSON):\n") + 37)
    ) as {
      expectedSourceIds?: string[];
      sourceBlocks?: Array<{ id: string }>;
      currentFragment?: { html: string };
    };
    const content = payload.currentFragment?.html ?? (payload.expectedSourceIds ?? payload.sourceBlocks?.map(({ id }) => id) ?? [])
      .map((id) => `<section data-galley-source="${id}"><span>${id}</span></section>`)
      .join("");
    return { content, toolCalls: [], finishReason: "stop" };
  }
}

it("validates an approximately 10,000-character Chinese long document with zero missing or duplicate source ids", async () => {
  const paragraph = "这是用于验证长文分批生成、内容来源标识、图片代码表格和章节一致性的中文段落。".repeat(22);
  const markdown = [
    "# 长文基准",
    ...Array.from({ length: 12 }, (_, index) => [
      `## 第${index + 1}章`,
      paragraph,
      index === 1 ? "![本地图片](assets/local.png)" : "",
      index === 2 ? "```ts\nconst value = 42;\n```" : "",
      index === 3 ? "| 指标 | 数值 |\n| --- | --- |\n| 完整性 | 100% |" : ""
    ].filter(Boolean).join("\n\n"))
  ].join("\n\n");
  expect(Array.from(markdown).length).toBeGreaterThanOrEqual(10_000);

  const skillPackage = await new BundledSkillLoader().load();
  const vfs = new SkillVirtualFileSystem(skillPackage.files);
  const themes = new BuiltInThemeRepository(vfs);
  const client = new RecordedLongClient();
  const session = new SkillSession({
    client,
    target: { baseUrl: "https://recorded.invalid/v1", model: "recorded-long" },
    capabilities: makeProviderCapabilities({ tools: false }),
    skillPackage,
    vfs,
    packageHash: BUNDLED_SKILL.archiveSha256
  });
  const result = await new GenerationPipeline({ session, themes }).generate(
    {
      sourcePath: "benchmark/long.md",
      markdown,
      manualThemeId: themes.list()[0]!.id,
      modelContextWindow: 8_000
    },
    new AbortController().signal
  );

  expect(result.status).toBe("verified");
  expect(validateSourceCoverage(result.source, result.html)).toEqual([]);
  const ids = [...new DOMParser().parseFromString(result.html, "text/html")
    .querySelectorAll("[data-galley-source]")]
    .map((element) => element.getAttribute("data-galley-source"));
  expect(new Set(ids).size).toBe(result.source.blocks.length);
  expect(ids).toHaveLength(result.source.blocks.length);
  expect(client.requests.length).toBeGreaterThan(1);
}, 30_000);
