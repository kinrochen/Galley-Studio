import { describe, expect, it, vi } from "vitest";

import { ArtifactRepository } from "../../src/documents/ArtifactRepository";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { HugeRteAdapter } from "../../src/editor/HugeRteAdapter";
import type { ExportConfiguration } from "../../src/export/ExportConfiguration";
import { ExportService } from "../../src/export/ExportService";
import { ObsidianExportArtifactWriter } from "../../src/export/ObsidianExportArtifactWriter";
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
import { annotateMarkdown, type AnnotatedSource, type SourceBlock } from "../../src/source/SourceAnnotator";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../../src/themes/ThemeIndex";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import { contentTurn } from "../support/generationFixtures";
import { memoryVault, type MemoryVaultFile } from "../support/memoryVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";
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
  "![Architecture diagram](assets/architecture.png)",
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
  it("creates durable artifacts, visually edits them, and records all three exports for every built-in theme", async () => {
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

    for (const [themeIndex, theme] of themes.list().entries()) {
      const client = new ScriptedChatClient([
        contentTurn(recordedThemeHtml(theme, source))
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
          sourcePath: `acceptance/article-${theme.id}.md`,
          markdown: MARKDOWN,
          manualThemeId: theme.id,
          modelContextWindow: 128_000
        },
        new AbortController().signal
      );
      if (generated.status !== "verified") {
        throw new Error(`${theme.id}: ${JSON.stringify(generated.validation.issues)}`);
      }
      expect(client.requests).toHaveLength(1);
      const generatedDocument = new DOMParser().parseFromString(generated.html, "text/html");
      expect(generatedDocument.querySelector(`#theme-${theme.id}`)).not.toBeNull();
      expect(generatedDocument.querySelector("article")?.getAttribute("style")?.toLowerCase()).toContain(
        safeThemeColor(theme).toLowerCase()
      );
      for (const selector of [
        "h1",
        "blockquote",
        "ul li",
        "pre code",
        "table",
        "img",
        '[data-galley-role="toc"]',
        '[data-galley-role="signature"]',
        '[data-galley-role="section-number"]',
        '[data-galley-role="keyword"]'
      ]) {
        expect(generatedDocument.querySelector(selector), `${theme.id}: ${selector}`)
          .not.toBeNull();
      }
      for (const text of [
        "Galley acceptance",
        "A recorded six-theme workflow.",
        "important content",
        "Architecture diagram",
        "first item",
        "const galley = true;",
        "A",
        "B"
      ]) {
        expect(generated.html, `${theme.id}: ${text}`).toContain(text);
      }

      const generationVault = memoryVault();
      const repository = new ArtifactRepository(generationVault, {
        now: () => new Date("2026-07-15T03:04:04.000Z"),
        randomUUID: uuidSequence(themeIndex + 1)
      });
      const paths = await repository.writeNew({
        sourcePath: `acceptance/article-${theme.id}.md`,
        markdown: MARKDOWN,
        document: generated,
        model: "recorded-model"
      });
      const backing = new PersistentObsidianBacking(stringSnapshot(generationVault.snapshot()));
      const vault = persistentObsidianVault(backing);
      const documentSession = await new ObsidianDocumentSessionOpener(vault, {
        now: () => new Date("2026-07-15T03:04:05.000Z"),
        randomUUID: uuidSequence(themeIndex + 11)
      }).open(paths.html);

      const parsed = new DOMParser().parseFromString(documentSession.html(), "text/html");
      const host = document.createElement("div");
      document.body.append(host);
      const editor = new HugeRteAdapter();
      await editor.mount(host, parsed.body.innerHTML, {
        documentBaseUrl: "app://vault/acceptance/",
        onChange: () => undefined
      });
      const visualBody = document.createElement("template");
      visualBody.innerHTML = editor.getHtml();
      const firstBlock = visualBody.content.querySelector(
        `[data-galley-source="${source.blocks[0]!.id}"]`
      );
      if (!firstBlock) throw new Error("Recorded visual edit target is missing.");
      firstBlock.textContent = `visually edited ${theme.id}`;
      editor.setHtml(visualBody.innerHTML);
      documentSession.updateBody(editor.getHtml());
      await documentSession.save("explicit");
      editor.destroy();
      host.remove();
      expect(validateSourceCoverage(source, documentSession.html()), theme.id).toEqual([]);
      expect(documentSession.html()).toContain(`visually edited ${theme.id}`);

      const savedAuthoringBytes = backing.read(paths.html);
      const exportService = new ExportService({
        profiles: [new StandardWebProfile(), new PortableInlineProfile(), new WechatProfile()],
        writer: new ObsidianExportArtifactWriter(vault),
        recorder: {
          record: (record, signal) => documentSession.recordExport(record, signal)
        },
        now: () => new Date("2026-07-15T03:04:06.000Z"),
        randomUUID: uuidSequence(themeIndex + 21)
      });
      const exports = [];
      for (const profileId of ["standard-web", "portable-inline", "wechat"] as const) {
        exports.push(await exportService.export({
          source: {
            htmlPath: paths.html,
            documentId: documentSession.documentId(),
            html: documentSession.html(),
            reservedPaths: documentSession.exportPaths()
          },
          configuration: configuration(profileId)
        }, new AbortController().signal));
      }

      expect(backing.read(paths.html), theme.id).toBe(savedAuthoringBytes);
      expect(exports[0]!.html).toMatch(/^<!DOCTYPE html>/u);
      expect(exports[1]!.html).not.toMatch(/<!DOCTYPE|<script/iu);
      expect(validateWechatHtml(exports[2]!.html), theme.id).toMatchObject({ valid: true });
      for (const artifact of exports) expect(backing.read(artifact.path)).toBe(artifact.html);
      const sidecar = GalleySidecarV1Schema.parse(JSON.parse(backing.read(paths.sidecar) ?? ""));
      expect(sidecar.themeId).toBe(theme.id);
      expect(sidecar.exports.map(({ profileId }) => profileId)).toEqual([
        "standard-web",
        "portable-inline",
        "wechat"
      ]);
      expect(generated.html).not.toContain("visually edited");
    }
    vi.unstubAllGlobals();
  }, 30_000);
});

function recordedThemeHtml(theme: ThemeDefinition, source: AnnotatedSource): string {
  const blocks = source.blocks.map(renderBlock).join("");
  return [
    "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">",
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(theme.name)} acceptance</title></head><body>`,
    `<article id="theme-${theme.id}" style="color:${safeThemeColor(theme)};padding:24px">`,
    '<nav data-galley-role="toc"><strong>Contents</strong></nav>',
    blocks,
    '<footer data-galley-role="signature">Galley recorded acceptance</footer>',
    "</article></body></html>"
  ].join("");
}

function safeThemeColor(theme: ThemeDefinition): string {
  return /#[0-9a-f]{3,8}/iu.exec(theme.primaryColor)?.[0] ?? "#333333";
}

function renderBlock(block: SourceBlock): string {
  const marker = `data-galley-source="${block.id}"`;
  const markdown = block.markdown.trim();
  switch (block.kind) {
    case "heading": {
      const match = /^(#{1,6})\s+(.+)$/u.exec(markdown);
      const level = match?.[1]?.length ?? 2;
      return `<h${level} ${marker}><span data-galley-role="section-number">${block.id}</span> ${escapeHtml(match?.[2] ?? markdown)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote ${marker}>${escapeHtml(markdown.replace(/^>\s?/u, ""))}</blockquote>`;
    case "list":
      return `<ul ${marker}>${markdown.split("\n").map((line) => `<li>${escapeHtml(line.replace(/^[-*+]\s+/u, ""))}</li>`).join("")}</ul>`;
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
      if (image) {
        return `<figure ${marker}><img src="${escapeHtml(image[2]!)}" alt="${escapeHtml(image[1]!)}"><figcaption>${escapeHtml(image[1]!)}</figcaption></figure>`;
      }
      const emphasized = escapeHtml(markdown).replace(
        /\*\*([^*]+)\*\*/gu,
        '<strong data-galley-role="keyword">$1</strong>'
      );
      return `<p ${marker}>${emphasized}</p>`;
    }
    default:
      return `<section ${marker}>${escapeHtml(markdown)}</section>`;
  }
}

function configuration(profileId: "standard-web" | "portable-inline" | "wechat"): ExportConfiguration {
  return {
    id: profileId,
    name: profileId,
    profileId,
    outputFolder: "exports",
    fileNameTemplate: `{stem}.${profileId}.html`
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
