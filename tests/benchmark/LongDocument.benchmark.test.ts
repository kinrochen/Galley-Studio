import { expect, it } from "vitest";

import type { ChatClient, ChatRequest, ChatTurnResult } from "../../src/ai/AiProtocol";
import {
  ArtifactRepository,
  type ArtifactVault
} from "../../src/documents/ArtifactRepository";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { BUNDLED_SKILL } from "../../src/generated/bundledSkill";
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";
import { BundledSkillLoader } from "../../src/skill/BundledSkillLoader";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import type { SourceBlock } from "../../src/source/SourceAnnotator";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";
import {
  memoryVault,
  type MemoryVault,
  type MemoryVaultFile,
  type MemoryVaultOwnedHandle
} from "../support/memoryVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";
import { makeProviderCapabilities } from "../support/phase1Factories";

class RecordedLongClient implements ChatClient {
  readonly requests: ChatRequest[] = [];

  async complete(request: ChatRequest): Promise<ChatTurnResult> {
    this.requests.push(structuredClone(request));
    const user = [...request.messages].reverse().find(({ role }) => role === "user");
    if (!user || typeof user.content !== "string") throw new Error("Expected text prompt");
    const label = "Structured payload (canonical JSON):\n";
    const payload = JSON.parse(user.content.slice(user.content.lastIndexOf(label) + label.length)) as {
      sourceBlocks?: SourceBlock[];
      currentFragment?: { html: string };
    };
    const content = payload.currentFragment?.html ?? payload.sourceBlocks?.map(renderBlock).join("");
    if (content === undefined) throw new Error("Recorded long request omitted renderable content");
    return { content, toolCalls: [], finishReason: "stop" };
  }
}

it("validates and durably opens an approximately 10,000-character Chinese document while cancel/failure preserve prior artifacts", async () => {
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
  expect(result.html).toContain(paragraph.slice(0, 120));
  const rendered = new DOMParser().parseFromString(result.html, "text/html");
  expect(rendered.querySelector('img[src="assets/local.png"]')).not.toBeNull();
  expect(rendered.querySelector("pre code")?.textContent).toContain("const value = 42;");
  expect(rendered.querySelector("table")?.textContent).toContain("完整性");

  const artifactVault = memoryVault({ "benchmark/long.md": markdown });
  const repository = new ArtifactRepository(artifactVault, {
    now: () => new Date("2026-07-15T03:04:04.000Z"),
    randomUUID: uuidSequence(1)
  });
  const paths = await repository.writeNew({
    sourcePath: "benchmark/long.md",
    markdown,
    document: result,
    model: "recorded-long"
  });
  const sidecar = GalleySidecarV1Schema.parse(JSON.parse(await artifactVault.read(paths.sidecar)));
  expect(sidecar.validation.valid).toBe(true);
  expect(sidecar.themeId).toBe(result.theme.id);
  const backing = new PersistentObsidianBacking(stringSnapshot(artifactVault.snapshot()));
  const opened = await new ObsidianDocumentSessionOpener(persistentObsidianVault(backing), {
    now: () => new Date("2026-07-15T03:04:05.000Z"),
    randomUUID: uuidSequence(2)
  }).open(paths.html);
  expect(opened.html()).toContain(paragraph.slice(0, 120));
  expect(opened.html()).toContain("assets/local.png");

  const stable = artifactVault.snapshot();
  const cancelled = new AbortController();
  const cancelRepository = new ArtifactRepository(
    faultingVault(artifactVault, "cancel-after-first-commit", cancelled),
    { randomUUID: uuidSequence(3) }
  );
  await expect(cancelRepository.writeNew({
    sourcePath: "benchmark/long.md",
    markdown,
    document: result,
    model: "recorded-long"
  }, cancelled.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(artifactVault.snapshot()).toEqual(stable);

  const failureRepository = new ArtifactRepository(
    faultingVault(artifactVault, "fail-second-commit"),
    { randomUUID: uuidSequence(4) }
  );
  await expect(failureRepository.writeNew({
    sourcePath: "benchmark/long.md",
    markdown,
    document: result,
    model: "recorded-long"
  })).rejects.toThrow("Injected sidecar commit failure");
  expect(artifactVault.snapshot()).toEqual(stable);
}, 30_000);

function renderBlock(block: SourceBlock): string {
  const marker = `data-galley-source="${block.id}"`;
  const markdown = block.markdown.trim();
  switch (block.kind) {
    case "heading": {
      const match = /^(#{1,6})\s+(.+)$/u.exec(markdown);
      const level = match?.[1]?.length ?? 2;
      return `<h${level} ${marker}>${escapeHtml(match?.[2] ?? markdown)}</h${level}>`;
    }
    case "code": {
      const match = /^```[^\n]*\n([\s\S]*?)\n```$/u.exec(markdown);
      return `<pre ${marker}><code>${escapeHtml(match?.[1] ?? markdown)}</code></pre>`;
    }
    case "table": {
      const rows = markdown.split("\n").filter((_, index) => index !== 1).map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim()));
      return `<table ${marker}><thead><tr>${rows[0]!.map((cell) => `<th>${escapeHtml(cell)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    case "paragraph": {
      const image = /^!\[([^\]]*)\]\(([^)]+)\)$/u.exec(markdown);
      return image
        ? `<figure ${marker}><img src="${escapeHtml(image[2]!)}" alt="${escapeHtml(image[1]!)}"><figcaption>${escapeHtml(image[1]!)}</figcaption></figure>`
        : `<p ${marker}>${escapeHtml(markdown)}</p>`;
    }
    default:
      return `<section ${marker}>${escapeHtml(markdown)}</section>`;
  }
}

function faultingVault(
  vault: MemoryVault,
  mode: "cancel-after-first-commit" | "fail-second-commit",
  controller?: AbortController
): ArtifactVault<MemoryVaultOwnedHandle> {
  let commits = 0;
  return {
    exists: (path) => vault.exists(path),
    ensureFolder: (path) => vault.ensureFolder(path),
    createOwned: (path, contents) => vault.createOwned(path, contents),
    owns: (handle) => vault.owns(handle),
    removeOwned: (handle) => vault.removeOwned(handle),
    commitOwned: async (handle, path) => {
      commits += 1;
      if (mode === "fail-second-commit" && commits === 2) {
        throw new Error("Injected sidecar commit failure");
      }
      const committed = await vault.commitOwned(handle, path);
      if (mode === "cancel-after-first-commit" && commits === 1) controller?.abort();
      return committed;
    }
  };
}

function stringSnapshot(snapshot: Readonly<Record<string, MemoryVaultFile>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, contents] of Object.entries(snapshot)) {
    if (typeof contents !== "string") throw new Error("Expected text fixture");
    result[path] = contents;
  }
  return result;
}

function uuidSequence(namespace: number): () => string {
  let index = 0;
  return () => `123e4567-e89b-42d3-a${namespace.toString(16).padStart(3, "0")}-${(++index).toString(16).padStart(12, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
