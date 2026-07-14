import { afterEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

import { AiError } from "../../src/ai/AiError";
import {
  generateCurrentArticle,
  type GenerateCurrentArticleContext,
  type GenerationCommandPipeline
} from "../../src/commands/GenerateCurrentArticle";
import { ArtifactRepository } from "../../src/documents/ArtifactRepository";
import { ArtifactConfigurationError } from "../../src/documents/ArtifactRepository";
import { GalleySidecarV1Schema } from "../../src/documents/GalleySidecar";
import type { GeneratedDocument } from "../../src/generation/GenerationPipeline";
import GalleyPlugin, { ObsidianArtifactVault } from "../../src/main";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import {
  GRAPHITE_THEME,
  validAuthoringHtml
} from "../support/generationFixtures";
import { memoryVault } from "../support/memoryVault";
import { TEST_PACKAGE_HASH } from "../support/phase1Factories";
import { validateSourceCoverage } from "../../src/validation/SourceCoverageValidator";
import {
  notices,
  Platform,
  resetRequestUrlHandler,
  setRequestUrlHandler
} from "../setup/obsidian";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

afterEach(() => {
  vi.useRealTimers();
  Platform.isMobileApp = false;
  notices.length = 0;
  resetRequestUrlHandler();
});

describe("generateCurrentArticle", () => {
  it("reads once, uses one immutable settings/source snapshot, and emits stable stages plus both paths", async () => {
    const markdown = "# Immutable source\r\n\r\nBody.\n";
    const settingsInput = {
      baseUrl: "https://api.example/v1/",
      model: "configured-model",
      secretId: "secret-id",
      contextWindow: 64_000,
      outputFolder: "generated"
    };
    const read = vi.fn(async () => markdown);
    const generate = vi.fn(async () => makeDocument("verified"));
    const writeNew = vi.fn(async () => ({
      html: "generated/note.galley.html",
      sidecar: "generated/note.galley.json"
    }));
    const noticesSeen: string[] = [];
    const context = makeContext({
      read,
      getSettings: () => settingsInput,
      createPipeline: async (settings) => {
        settingsInput.model = "mutated-after-snapshot";
        settingsInput.outputFolder = "wrong-folder";
        expect(Object.isFrozen(settings)).toBe(true);
        return {
          model: "configured-model",
          pipeline: { generate }
        };
      },
      createRepository: (settings) => {
        expect(settings).toMatchObject({
          baseUrl: "https://api.example/v1",
          model: "configured-model",
          outputFolder: "generated"
        });
        return { writeNew };
      },
      notice: (message) => noticesSeen.push(message)
    });

    const paths = await generateCurrentArticle(
      context,
      new AbortController().signal
    );

    expect(paths).toEqual({
      html: "generated/note.galley.html",
      sidecar: "generated/note.galley.json"
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      {
        sourcePath: "notes/note.md",
        markdown,
        modelContextWindow: 64_000
      },
      expect.any(AbortSignal)
    );
    expect(writeNew).toHaveBeenCalledWith(
      {
        sourcePath: "notes/note.md",
        markdown,
        document: expect.objectContaining({ status: "verified" }),
        model: "configured-model"
      },
      expect.any(AbortSignal)
    );
    expect(noticesSeen).toEqual([
      "Galley: Reading current Markdown.",
      "Galley: Loading generation dependencies.",
      "Galley: Generating article.",
      "Galley: Validating generated article.",
      "Galley: Saving independent artifacts.",
      "Galley: Generated generated/note.galley.html and generated/note.galley.json."
    ]);
  });

  it("clearly reports an unverified draft in both paths and the final Notice", async () => {
    const noticesSeen: string[] = [];
    const writeNew = vi.fn(async () => ({
      html: "note.unverified.galley.html",
      sidecar: "note.unverified.galley.json"
    }));
    const context = makeContext({
      createPipeline: async () => ({
        model: "test-model",
        pipeline: {
          generate: async () => makeDocument("unverified")
        }
      }),
      createRepository: () => ({ writeNew }),
      notice: (message) => noticesSeen.push(message)
    });

    await generateCurrentArticle(context, new AbortController().signal);

    expect(noticesSeen.at(-1)).toBe(
      "Galley: Saved UNVERIFIED DRAFT note.unverified.galley.html and note.unverified.galley.json."
    );
  });

  it.each([
    [null, "Galley: Open one Markdown file before generating."],
    [
      { path: "notes/not-markdown.txt", extension: "txt" },
      "Galley: Open one Markdown file before generating."
    ]
  ])("requires exactly one active Markdown file", async (activeFile, message) => {
    const read = vi.fn();
    const notice = vi.fn();
    await expect(
      generateCurrentArticle(
        makeContext({ getActiveFile: () => activeFile, read, notice }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "missing_markdown" });

    expect(read).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(message);
  });

  it("fails before reading when the configured model is empty", async () => {
    const read = vi.fn();
    const notice = vi.fn();
    await expect(
      generateCurrentArticle(
        makeContext({
          getSettings: () => ({ model: "   ", secretId: "secret-id" }),
          read,
          notice
        }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "missing_model" });

    expect(read).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      "Galley: Configure a model before generating."
    );
  });

  it("fails actionably before reading when the output folder cannot be prepared", async () => {
    const read = vi.fn();
    const notice = vi.fn();
    await expect(
      generateCurrentArticle(
        makeContext({
          read,
          createRepository: () => ({
            prepare: async () => {
              throw new ArtifactConfigurationError();
            },
            writeNew: vi.fn()
          }),
          notice
        }),
        new AbortController().signal
      )
    ).rejects.toBeInstanceOf(ArtifactConfigurationError);

    expect(read).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledWith(
      "Galley: Configure a valid vault-relative output folder."
    );
  });

  it("propagates cancellation and never asks the repository to save", async () => {
    const controller = new AbortController();
    const writeNew = vi.fn();
    const notice = vi.fn();
    const context = makeContext({
      createPipeline: async () => ({
        model: "test-model",
        pipeline: {
          generate: async (_input, signal) => {
            controller.abort();
            if (signal.aborted) {
              throw new AiError("aborted");
            }
            return makeDocument("verified");
          }
        }
      }),
      createRepository: () => ({ writeNew }),
      notice
    });

    await expect(
      generateCurrentArticle(context, controller.signal)
    ).rejects.toMatchObject({ code: "aborted" });

    expect(writeNew).not.toHaveBeenCalled();
    expect(notice).toHaveBeenLastCalledWith("Galley: Generation cancelled.");
  });

  it.each([
    [new AiError("missing_secret"), "Galley: Configure an API key before generating."],
    [new AiError("invalid_base_url"), "Galley: Check the configured provider Base URL."],
    [new AiError("timeout"), "Galley: The AI request timed out."],
    [new AiError("http_error", { status: 401 }), "Galley: The provider rejected the API key or permissions."],
    [new AiError("http_error", { status: 429 }), "Galley: The provider is temporarily unavailable; try again."],
    [new Error("Authorization: Bearer top-secret; markdown and <html>raw</html>"), "Galley: Generation failed. Check settings and try again."]
  ])("shows only an allowlisted error for %s", async (failure, safeMessage) => {
    const notice = vi.fn();
    const context = makeContext({
      createPipeline: async () => {
        throw failure;
      },
      notice
    });

    await expect(
      generateCurrentArticle(context, new AbortController().signal)
    ).rejects.toBe(failure);

    const visible = notice.mock.calls.flat().join("\n");
    expect(visible).toContain(safeMessage);
    expect(visible).not.toContain("top-secret");
    expect(visible).not.toContain("Authorization");
    expect(visible).not.toContain("<html>");
  });

  it("integrates with the repository without changing source bytes and writes matching hashes", async () => {
    const markdown = "# Source\r\n\r\nByte exact.\n";
    const document = makeDocument("verified");
    const vault = memoryVault({ "folder/source.md": markdown });
    const repository = new ArtifactRepository(vault, {
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      randomUUID: () => UUID
    });
    const context = makeContext({
      read: async () => vault.read("folder/source.md"),
      getActiveFile: () => ({ path: "folder/source.md", extension: "md" }),
      createPipeline: async () => ({
        model: "test-model",
        pipeline: { generate: async () => document }
      }),
      createRepository: () => repository
    });

    const paths = await generateCurrentArticle(
      context,
      new AbortController().signal
    );

    const sidecar = JSON.parse(await vault.read(paths.sidecar)) as {
      sourceHash: string;
      htmlHash: string;
    };
    expect(await vault.read("folder/source.md")).toBe(markdown);
    expect(sidecar.sourceHash).toBe(await sha256(markdown));
    expect(sidecar.htmlHash).toBe(await sha256(await vault.read(paths.html)));
  });

  it("saves a real empty-marker validator report as an unmistakable unverified pair", async () => {
    const markdown = "# Empty marker\n";
    const document = makeEmptyMarkerDocument(markdown);
    const vault = memoryVault({ "folder/source.md": markdown });
    const repository = new ArtifactRepository(vault, {
      now: () => new Date("2026-07-14T00:00:00.000Z"),
      randomUUID: () => UUID
    });
    const noticesSeen: string[] = [];
    const context = makeContext({
      read: async () => vault.read("folder/source.md"),
      getActiveFile: () => ({ path: "folder/source.md", extension: "md" }),
      createPipeline: async () => ({
        model: "test-model",
        pipeline: { generate: async () => document }
      }),
      createRepository: () => repository,
      notice: (message) => noticesSeen.push(message)
    });

    const paths = await generateCurrentArticle(
      context,
      new AbortController().signal
    );

    expect(paths).toEqual({
      html: "folder/source.unverified.galley.html",
      sidecar: "folder/source.unverified.galley.json"
    });
    const html = await vault.read(paths.html);
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(await vault.read(paths.sidecar))
    );
    expect(await vault.read("folder/source.md")).toBe(markdown);
    expect(sidecar.sourceHash).toBe(await sha256(markdown));
    expect(sidecar.htmlHash).toBe(await sha256(html));
    expect(sidecar.validation.issues).toContainEqual({
      code: "source_invalid",
      severity: "error",
      message: "A generated source marker is invalid."
    });
    expect(noticesSeen.at(-1)).toContain("UNVERIFIED DRAFT");
  });
});

describe("plugin command registration", () => {
  it("registers Galley generation only on desktop", async () => {
    const desktop = new GalleyPlugin(makePluginApp(), {} as PluginManifest);
    await desktop.onload();
    expect(commandIds(desktop)).toContain("generate-current-article");
    expect(commandNames(desktop)).toContain("Galley: AI layout current article");

    Platform.isMobileApp = true;
    const mobile = new GalleyPlugin(makePluginApp(), {} as PluginManifest);
    await mobile.onload();
    expect(commandIds(mobile)).not.toContain("generate-current-article");
  });

  it("aborts every retained command controller when the plugin unloads", async () => {
    const plugin = new GalleyPlugin(makePluginApp(), {} as PluginManifest);
    await plugin.onload();
    plugin.settings = normalizeSettings({
      model: "test-model",
      secretId: "secret-id"
    });
    const command = commandEntries(plugin).find(
      ({ id }) => id === "generate-current-article"
    );
    const invocation = command?.callback?.();

    plugin.onunload();
    await invocation;

    expect(notices).toContain("Galley: Generation cancelled.");
  });

  it("runs the real desktop dependency graph and commits an exact independent pair", async () => {
    const markdown = "# Production path\r\n\r\nBody bytes.\n";
    const source = annotateMarkdown(markdown);
    const harness = makeProductionPluginApp(markdown);
    const providerResponses = [
      openAiContent("tool calls not available"),
      openAiContent(
        JSON.stringify({
          themeId: "graphite-minimal",
          articleType: "tutorial",
          reason: "Matches the article."
        })
      ),
      openAiContent(validAuthoringHtml(source))
    ];
    setRequestUrlHandler(async () => {
      const response = providerResponses.shift();
      if (!response) {
        throw new Error("Unexpected provider request");
      }
      return response;
    });
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    plugin.settings = normalizeSettings({
      baseUrl: "https://api.example/v1",
      model: "production-model",
      secretId: "secret-id",
      outputFolder: "generated"
    });
    const command = commandEntries(plugin).find(
      ({ id }) => id === "generate-current-article"
    );

    await command?.callback?.();

    expect(providerResponses).toEqual([]);
    expect(harness.contents.get("note.md")).toBe(markdown);
    const html = harness.contents.get("generated/note.galley.html");
    const sidecarText = harness.contents.get("generated/note.galley.json");
    expect(html).toBe(validAuthoringHtml(source));
    expect(sidecarText).toBeTypeOf("string");
    const sidecar = JSON.parse(sidecarText ?? "") as {
      sourceHash: string;
      htmlHash: string;
      model: string;
      skillLoadMode: string;
      skillFiles: string[];
    };
    expect(sidecar.sourceHash).toBe(await sha256(markdown));
    expect(sidecar.htmlHash).toBe(await sha256(html ?? ""));
    expect(sidecar.model).toBe("production-model");
    expect(sidecar.skillLoadMode).toBe("injected");
    expect(sidecar.skillFiles).toEqual(
      expect.arrayContaining([
        "SKILL.md",
        "references/theme-index.md",
        "references/common-components.md",
        "references/theme-graphite-minimal.md"
      ])
    );
    expect(notices.at(-1)).toBe(
      "Galley: Generated generated/note.galley.html and generated/note.galley.json."
    );
    expect(harness.renameCalls.count).toBe(0);
    expect(harness.createCalls).toHaveLength(2);
    expect(harness.createCalls.every((path) => path.includes("galley-tmp"))).toBe(
      true
    );
    expect(harness.copyCalls.map(({ to }) => to)).toEqual([
      "generated/note.galley.html",
      "generated/note.galley.json"
    ]);
  });

  it("uses exclusive adapter copies when a production destination appears between pair probe and commit", async () => {
    const markdown = "# Production race\n";
    const source = annotateMarkdown(markdown);
    const harness = makeProductionPluginApp(markdown, {
      raceFirstHtmlFinal: true
    });
    const providerResponses = [
      openAiContent("tool calls not available"),
      openAiContent(
        JSON.stringify({
          themeId: "graphite-minimal",
          articleType: "tutorial",
          reason: "Matches the article."
        })
      ),
      openAiContent(validAuthoringHtml(source))
    ];
    setRequestUrlHandler(async () => {
      const response = providerResponses.shift();
      if (!response) throw new Error("Unexpected provider request");
      return response;
    });
    const plugin = new GalleyPlugin(harness.app, {} as PluginManifest);
    await plugin.onload();
    plugin.settings = normalizeSettings({
      baseUrl: "https://api.example/v1",
      model: "production-model",
      secretId: "secret-id",
      outputFolder: "generated"
    });
    const command = commandEntries(plugin).find(
      ({ id }) => id === "generate-current-article"
    );

    await command?.callback?.();

    expect(harness.renameCalls.count).toBe(0);
    expect(harness.contents.get("generated/note.galley.html")).toBe(
      "replacement HTML"
    );
    expect(harness.contents.get("generated/note-2.galley.html")).toBe(
      validAuthoringHtml(source)
    );
    expect(harness.contents.has("generated/note-2.galley.json")).toBe(true);
    expect(harness.createCalls).toHaveLength(4);
    expect(harness.createCalls.every((path) => path.includes("galley-tmp"))).toBe(
      true
    );
    expect(harness.copyCalls.map(({ to }) => to)).toEqual([
      "generated/note.galley.html",
      "generated/note-2.galley.html",
      "generated/note-2.galley.json"
    ]);
  });

  it("allows exactly one of two concurrent production adapter commits to claim an absent destination", async () => {
    const harness = makeProductionPluginApp("", {
      coordinateCopiesTo: "shared.galley.html"
    });
    const artifacts = new ObsidianArtifactVault(harness.app.vault);
    const first = await artifacts.createOwned(".first.tmp", "first exact bytes\n");
    const second = await artifacts.createOwned(".second.tmp", "second exact bytes\r\n");

    expect(await Promise.all([
      artifacts.exists("shared.galley.html"),
      artifacts.exists("shared.galley.html")
    ])).toEqual([false, false]);

    const [firstResult, secondResult] = await Promise.all([
      artifacts.commitOwned(first, "shared.galley.html"),
      artifacts.commitOwned(second, "shared.galley.html")
    ]);
    const winner =
      firstResult.status === "committed"
        ? "first exact bytes\n"
        : "second exact bytes\r\n";

    expect([firstResult.status, secondResult.status].sort()).toEqual([
      "collision",
      "committed"
    ]);
    expect(harness.copyInitialPresence).toEqual([false, false]);
    expect(harness.copyCalls).toEqual([
      { from: ".first.tmp", to: "shared.galley.html" },
      { from: ".second.tmp", to: "shared.galley.html" }
    ]);
    expect(harness.createCalls).toEqual([".first.tmp", ".second.tmp"]);
    expect(harness.renameCalls.count).toBe(0);
    expect(harness.contents.get("shared.galley.html")).toBe(winner);
    expect(await sha256(harness.contents.get("shared.galley.html") ?? "")).toBe(
      await sha256(winner)
    );
  });

  it("does not claim or path-delete a copied final whose TFile identity never becomes observable", async () => {
    vi.useFakeTimers();
    const harness = makeProductionPluginApp("", {
      suppressCopyIndexFor: "unindexed.galley.html"
    });
    const artifacts = new ObsidianArtifactVault(harness.app.vault);
    const temp = await artifacts.createOwned(".unindexed.tmp", "orphan bytes");

    const commit = artifacts
      .commitOwned(temp, "unindexed.galley.html")
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await commit).toEqual(
      expect.objectContaining({
        message: "Galley final artifact identity was not observed."
      })
    );
    expect(harness.contents.get("unindexed.galley.html")).toBe("orphan bytes");
    expect(harness.deleteCalls).toEqual([]);
    expect(harness.renameCalls.count).toBe(0);
  });

  it("binds the exact final handle when vault indexing arrives after adapter copy", async () => {
    vi.useFakeTimers();
    const harness = makeProductionPluginApp("", {
      delayCopyIndexFor: "delayed.galley.html"
    });
    const artifacts = new ObsidianArtifactVault(harness.app.vault);
    const temp = await artifacts.createOwned(".delayed.tmp", "delayed bytes\r\n");

    const commit = artifacts.commitOwned(temp, "delayed.galley.html");
    await vi.advanceTimersByTimeAsync(10);
    const result = await commit;

    expect(result.status).toBe("committed");
    if (result.status === "committed") {
      expect(await artifacts.owns(result.handle)).toBe(true);
    }
    expect(harness.contents.get("delayed.galley.html")).toBe(
      "delayed bytes\r\n"
    );
    expect(harness.createCalls).toEqual([".delayed.tmp"]);
    expect(harness.copyCalls).toEqual([
      { from: ".delayed.tmp", to: "delayed.galley.html" }
    ]);
    expect(harness.renameCalls.count).toBe(0);
  });

  it("aborts a copied final identity wait without claiming or path-deleting it", async () => {
    const harness = makeProductionPluginApp("", {
      suppressCopyIndexFor: "aborted.galley.html"
    });
    const artifacts = new ObsidianArtifactVault(harness.app.vault);
    const temp = await artifacts.createOwned(".aborted.tmp", "aborted bytes");
    const controller = new AbortController();
    const commit = artifacts
      .commitOwned(temp, "aborted.galley.html", controller.signal)
      .catch((error: unknown) => error);
    await vi.waitFor(() => {
      expect(harness.copyCalls).toHaveLength(1);
    });

    controller.abort();

    expect(await commit).toEqual(expect.objectContaining({ name: "AbortError" }));
    expect(harness.contents.get("aborted.galley.html")).toBe("aborted bytes");
    expect(harness.deleteCalls).toEqual([]);
    expect(harness.renameCalls.count).toBe(0);
  });
});

function makeContext(
  overrides: Partial<GenerateCurrentArticleContext> = {}
): GenerateCurrentArticleContext {
  return {
    getActiveFile: () => ({ path: "notes/note.md", extension: "md" }),
    read: async () => "# Source\n",
    getSettings: () =>
      normalizeSettings({
        baseUrl: "https://api.example/v1",
        model: "test-model",
        secretId: "secret-id"
      }),
    createPipeline: async () => ({
      model: "test-model",
      pipeline: {
        generate: async () => makeDocument("verified")
      }
    }),
    createRepository: () => ({
      writeNew: async () => ({
        html: "notes/note.galley.html",
        sidecar: "notes/note.galley.json"
      })
    }),
    notice: () => undefined,
    ...overrides
  };
}

function makeDocument(status: GeneratedDocument["status"]): GeneratedDocument {
  const markdown = "# Source\n";
  return {
    status,
    html:
      "<!DOCTYPE html><html><head><title>Article</title></head><body><article>safe</article></body></html>",
    theme: GRAPHITE_THEME,
    source: annotateMarkdown(markdown),
    validation:
      status === "verified"
        ? { valid: true, issues: [] }
        : {
            valid: false,
            issues: [
              {
                code: "source_missing",
                severity: "error",
                message: "A source block is missing."
              }
            ]
          },
    skillAudit: {
      skillId: "gzh-design",
      skillVersion: "test-version",
      packageHash: TEST_PACKAGE_HASH,
      loadMode: "injected",
      files: ["SKILL.md", "references/theme-index.md"]
    },
    diagnostics: []
  };
}

function makeEmptyMarkerDocument(markdown: string): GeneratedDocument {
  const source = annotateMarkdown(markdown);
  const html =
    '<!DOCTYPE html><html><head><title>Article</title></head><body><article><section data-galley-source="">empty</section></article></body></html>';
  return {
    ...makeDocument("unverified"),
    html,
    source,
    validation: {
      valid: false,
      issues: validateSourceCoverage(source, html)
    }
  };
}

function commandEntries(plugin: GalleyPlugin): Array<{
  id: string;
  name: string;
  callback?: () => Promise<void> | void;
}> {
  return (plugin as unknown as { commands: unknown[] }).commands as Array<{
    id: string;
    name: string;
    callback?: () => Promise<void> | void;
  }>;
}

function commandIds(plugin: GalleyPlugin): string[] {
  return commandEntries(plugin).map(({ id }) => id);
}

function commandNames(plugin: GalleyPlugin): string[] {
  return commandEntries(plugin).map(({ name }) => name);
}

function makePluginApp(): App {
  const activeFile = { path: "note.md", extension: "md" };
  return {
    secretStorage: {
      getSecret: () => "secret",
      listSecrets: () => ["secret-id"],
      setSecret: () => undefined
    },
    workspace: { getActiveFile: () => activeFile },
    vault: {
      read: async () => "# Source\n",
      getAbstractFileByPath: () => null,
      create: async () => activeFile,
      createFolder: async () => activeFile,
      rename: async () => undefined,
      delete: async () => undefined
    }
  } as unknown as App;
}

function makeProductionPluginApp(
  markdown: string,
  options: {
    raceFirstHtmlFinal?: boolean;
    coordinateCopiesTo?: string;
    suppressCopyIndexFor?: string;
    delayCopyIndexFor?: string;
  } = {}
): {
  app: App;
  contents: Map<string, string>;
  renameCalls: { count: number };
  createCalls: string[];
  copyCalls: Array<{ from: string; to: string }>;
  copyInitialPresence: boolean[];
  deleteCalls: string[];
} {
  type MemoryObsidianFile = {
    path: string;
    name: string;
    extension?: string;
    basename?: string;
    children?: MemoryObsidianFile[];
  };
  const source: MemoryObsidianFile = {
    path: "note.md",
    name: "note.md",
    basename: "note",
    extension: "md"
  };
  const files = new Map<string, MemoryObsidianFile>([[source.path, source]]);
  const contents = new Map<string, string>([[source.path, markdown]]);
  const renameCalls = { count: 0 };
  const createCalls: string[] = [];
  const copyCalls: Array<{ from: string; to: string }> = [];
  const copyInitialPresence: boolean[] = [];
  const deleteCalls: string[] = [];
  const createListeners = new Map<object, (file: MemoryObsidianFile) => unknown>();
  let racedFirstHtmlFinal = false;
  let coordinatedCopyCount = 0;
  let releaseCoordinatedCopies: (() => void) | undefined;
  const coordinatedCopies = new Promise<void>((resolve) => {
    releaseCoordinatedCopies = resolve;
  });
  const emitCreate = (file: MemoryObsidianFile): void => {
    for (const listener of createListeners.values()) {
      listener(file);
    }
  };
  const vault = {
    adapter: {
      exists: async (path: string) => contents.has(path),
      copy: async (from: string, to: string) => {
        copyCalls.push({ from, to });
        copyInitialPresence.push(contents.has(to));
        if (
          options.raceFirstHtmlFinal &&
          !racedFirstHtmlFinal &&
          to === "generated/note.galley.html"
        ) {
          racedFirstHtmlFinal = true;
          const replacement = { path: to, name: "note.galley.html" };
          files.set(to, replacement);
          contents.set(to, "replacement HTML");
          emitCreate(replacement);
          throw new Error("Destination raced exclusive copy");
        }
        if (to === options.coordinateCopiesTo) {
          coordinatedCopyCount += 1;
          if (coordinatedCopyCount === 2) {
            releaseCoordinatedCopies?.();
          }
          await coordinatedCopies;
        }
        if (contents.has(to)) throw new Error("Exists");
        const value = contents.get(from);
        if (value === undefined) throw new Error("Missing copy source");
        contents.set(to, value);
        if (to === options.suppressCopyIndexFor) return;
        const indexCopy = (): void => {
          const file = {
            path: to,
            name: to.slice(to.lastIndexOf("/") + 1)
          };
          files.set(to, file);
          emitCreate(file);
        };
        if (to === options.delayCopyIndexFor) {
          window.setTimeout(indexCopy, 10);
          return;
        }
        indexCopy();
      }
    },
    getAbstractFileByPath: (path: string) => files.get(path) ?? null,
    read: async (file: MemoryObsidianFile) => {
      const value = contents.get(file.path);
      if (value === undefined) throw new Error("Missing file");
      return value;
    },
    create: async (path: string, value: string) => {
      createCalls.push(path);
      if (files.has(path)) throw new Error("Exists");
      const file = {
        path,
        name: path.slice(path.lastIndexOf("/") + 1)
      };
      files.set(path, file);
      contents.set(path, value);
      emitCreate(file);
      return file;
    },
    createFolder: async (path: string) => {
      if (files.has(path)) throw new Error("Exists");
      const folder = {
        path,
        name: path.slice(path.lastIndexOf("/") + 1),
        children: []
      };
      files.set(path, folder);
      return folder;
    },
    rename: async (file: MemoryObsidianFile, to: string) => {
      renameCalls.count += 1;
      files.delete(to);
      contents.delete(to);
      const value = contents.get(file.path);
      files.delete(file.path);
      contents.delete(file.path);
      file.path = to;
      file.name = to.slice(to.lastIndexOf("/") + 1);
      files.set(to, file);
      if (value !== undefined) contents.set(to, value);
    },
    delete: async (file: MemoryObsidianFile) => {
      deleteCalls.push(file.path);
      files.delete(file.path);
      contents.delete(file.path);
    },
    on: (name: string, listener: (file: MemoryObsidianFile) => unknown) => {
      if (name !== "create") throw new Error("Unexpected event");
      const ref = {};
      createListeners.set(ref, listener);
      return ref;
    },
    offref: (ref: object) => {
      createListeners.delete(ref);
    }
  };
  const app = {
    secretStorage: {
      getSecret: (id: string) => (id === "secret-id" ? "secret" : null),
      listSecrets: () => ["secret-id"],
      setSecret: () => undefined
    },
    workspace: { getActiveFile: () => source },
    vault
  } as unknown as App;
  return {
    app,
    contents,
    renameCalls,
    createCalls,
    copyCalls,
    copyInitialPresence,
    deleteCalls
  };
}

function openAiContent(content: string): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: "stop"
        }
      ]
    }
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const _pipelineTypeCheck: GenerationCommandPipeline | undefined = undefined;
void _pipelineTypeCheck;
