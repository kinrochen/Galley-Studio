import type { App, PluginManifest, TFile } from "obsidian";
import { Platform, WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  generateCurrentArticle,
  type GenerateCurrentArticleContext,
  type GenerationCommandArtifactWriter
} from "../../src/commands/GenerateCurrentArticle";
import { ArtifactRepository } from "../../src/documents/ArtifactRepository";
import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import type { ExportConfiguration } from "../../src/export/ExportConfiguration";
import { ExportService } from "../../src/export/ExportService";
import { ObsidianExportArtifactWriter } from "../../src/export/ObsidianExportArtifactWriter";
import { PortableInlineProfile, StandardWebProfile, WechatProfile } from "../../src/export/profiles";
import { validateWechatHtml } from "../../src/export/WechatValidator";
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";
import GalleyPlugin from "../../src/main";
import {
  GALLEY_PREVIEW_VIEW_TYPE,
  GalleyPreviewView
} from "../../src/preview/GalleyPreviewView";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import {
  contentTurn,
  makeGenerationHarness,
  themeDecision,
  validAuthoringHtml
} from "../support/generationFixtures";
import { memoryVault, type MemoryVaultFile } from "../support/memoryVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";

afterEach(() => { Platform.isMobileApp = false; });

describe("Phase 4 generated artifact workflow", () => {
  it("runs recorded generation, production edit, all exports, historical reservation, and mobile-registered preview", async () => {
    const markdown = "# Generated article\n\nBody from Markdown.\n";
    const source = annotateMarkdown(markdown);
    const generation = makeGenerationHarness([
      contentTurn(themeDecision()),
      contentTurn(validAuthoringHtml(source))
    ]);
    const generationVault = memoryVault({ "notes/article.md": markdown });
    const repository = new ArtifactRepository(generationVault, {
      now: () => new Date("2026-07-15T03:04:04.000Z"),
      randomUUID: uuidSequence("423e4567-e89b-42d3-a456-426614174")
    });
    const generationPipeline = new GenerationPipeline({
      session: generation.session,
      themes: generation.themes
    });
    const generatedPaths = await generateCurrentArticle(
      generationContext(markdown, generationPipeline, repository),
      new AbortController().signal
    );

    expect(generation.client.requests).toHaveLength(2);
    const backing = new PersistentObsidianBacking(
      stringSnapshot(generationVault.snapshot())
    );
    const vault = persistentObsidianVault(backing);
    const opener = new ObsidianDocumentSessionOpener(vault, {
      now: () => new Date("2026-07-15T03:04:05.000Z"),
      randomUUID: uuidSequence("523e4567-e89b-42d3-a456-426614174")
    });
    const session = await opener.open(generatedPaths.html);
    session.updateBody('<article data-galley-article="true"><p style="color:#333">edited generated article</p></article>');
    await session.save("explicit");
    const savedAuthoringBytes = backing.read(generatedPaths.html);
    const repair = vi.fn(async () => { throw new Error("unexpected model repair"); });
    const service = new ExportService({
      profiles: [new StandardWebProfile(), new PortableInlineProfile(), new WechatProfile()],
      writer: new ObsidianExportArtifactWriter(vault),
      recorder: { record: (record, signal) => session.recordExport(record, signal) },
      repairer: { repair },
      now: () => new Date("2026-07-15T03:04:06.000Z"),
      randomUUID: uuidSequence("623e4567-e89b-42d3-a456-426614174")
    });
    const results = [];
    for (const profileId of ["standard-web", "portable-inline", "wechat"] as const) {
      results.push(await service.export({
        source: {
          htmlPath: generatedPaths.html,
          documentId: session.documentId(),
          html: session.html(),
          reservedPaths: session.exportPaths()
        },
        configuration: configuration(profileId)
      }, new AbortController().signal));
    }

    expect(backing.read(generatedPaths.html)).toBe(savedAuthoringBytes);
    expect(repair).not.toHaveBeenCalled();
    expect(results[0]?.html).toMatch(/^<!DOCTYPE html><html/u);
    expect(results[1]?.html).not.toMatch(/<!DOCTYPE|<\/?(?:html|head|body)(?:\s|>)/iu);
    expect(results[1]?.html).not.toMatch(/data-galley-/iu);
    expect(validateWechatHtml(results[2]?.html ?? "").valid).toBe(true);

    const deletedPath = results[0]?.path ?? "";
    const deletedFile = vault.getFileByPath(deletedPath);
    expect(deletedFile).not.toBeNull();
    await vault.delete(deletedFile as TFile);
    const replacement = await service.export({
      source: {
        htmlPath: generatedPaths.html,
        documentId: session.documentId(),
        html: session.html(),
        reservedPaths: session.exportPaths()
      },
      configuration: configuration("standard-web")
    }, new AbortController().signal);
    expect(replacement.path).not.toBe(deletedPath);
    expect(replacement.path).toBe("exports/article.standard-web-2.html");

    const sidecar = GalleySidecarV1Schema.parse(JSON.parse(
      backing.read(generatedPaths.sidecar) ?? ""
    ));
    expect(sidecar.exports).toHaveLength(4);
    expect(new Set(sidecar.exports.map(({ path }) => path)).size).toBe(4);
    expect(backing.read(replacement.path)).toBe(replacement.html);

    Platform.isMobileApp = true;
    const leaf = new WorkspaceLeaf();
    const app = mobileApp(vault, generatedPaths.html, leaf);
    const plugin = new GalleyPlugin(app, {} as PluginManifest);
    await plugin.onload();
    const exposed = plugin as unknown as {
      commands: Array<{
        id: string;
        checkCallback?: (checking: boolean) => boolean;
      }>;
      views: Map<string, (leaf: WorkspaceLeaf) => GalleyPreviewView>;
    };
    expect([...exposed.views.keys()]).toEqual([GALLEY_PREVIEW_VIEW_TYPE]);
    expect(exposed.commands.map(({ id }) => id)).not.toContain(
      "generate-current-article"
    );
    const previewCommand = exposed.commands.find(
      ({ id }) => id === "open-current-galley-preview"
    );
    expect(previewCommand?.checkCallback?.(false)).toBe(true);
    await vi.waitFor(() => expect((leaf as unknown as { state: unknown }).state).toMatchObject({
      type: GALLEY_PREVIEW_VIEW_TYPE,
      state: { path: generatedPaths.html }
    }));
    const preview = exposed.views.get(GALLEY_PREVIEW_VIEW_TYPE)?.(leaf);
    expect(preview).toBeInstanceOf(GalleyPreviewView);
    await preview?.setState({ path: generatedPaths.html });
    const frame = preview?.contentEl.querySelector("iframe") as HTMLIFrameElement;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.srcdoc).toContain("edited generated article");
    expect(preview?.contentEl.querySelector("textarea,[contenteditable=true]")).toBeNull();
  });
});

function generationContext(
  markdown: string,
  pipeline: GenerationPipeline,
  repository: GenerationCommandArtifactWriter
): GenerateCurrentArticleContext {
  return {
    getActiveFile: () => ({ path: "notes/article.md", extension: "md" }),
    read: async () => markdown,
    getSettings: () => normalizeSettings({
      model: "recorded-model",
      secretId: "recorded-secret"
    }),
    createPipeline: async () => ({ model: "recorded-model", pipeline }),
    createRepository: () => repository,
    notice: () => undefined
  };
}

function mobileApp(vault: App["vault"], path: string, leaf: WorkspaceLeaf): App {
  const active = vault.getFileByPath(path) as TFile;
  return {
    vault,
    workspace: {
      getActiveFile: () => active,
      getLeaf: () => leaf,
      revealLeaf: vi.fn(),
      on: vi.fn(() => ({}))
    },
    secretStorage: {
      getSecret: () => null,
      listSecrets: () => [],
      setSecret: () => undefined
    }
  } as unknown as App;
}

function stringSnapshot(
  snapshot: Readonly<Record<string, MemoryVaultFile>>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, contents] of Object.entries(snapshot)) {
    if (typeof contents !== "string") throw new Error("Expected text fixture");
    result[path] = contents;
  }
  return result;
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

function uuidSequence(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}${(++index).toString(16).padStart(3, "0")}`;
}
