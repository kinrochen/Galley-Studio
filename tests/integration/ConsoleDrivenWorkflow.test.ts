import type { App, DataAdapter, TFile, Vault } from "obsidian";
import { WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCurrentArticle } from "../../src/commands/GenerateCurrentArticle";
import { ArticleCatalog } from "../../src/console/ArticleCatalog";
import { createGalleyActions } from "../../src/console/GalleyActions";
import { GalleyConsoleView } from "../../src/console/GalleyConsoleView";
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
import { GenerationPipeline } from "../../src/generation/GenerationPipeline";
import { LocaleStore } from "../../src/i18n/LocaleStore";
import {
  createDesktopActions,
  type DesktopConsoleHost
} from "../../src/platform/DesktopConsoleRuntime";
import * as themeRuntime from "../../src/platform/DesktopThemeRuntime";
import { derivePlatformCapabilities } from "../../src/platform/PlatformCapabilities";
import { normalizeSettings, type GalleySettings } from "../../src/settings/GalleySettings";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import { ThemeLabView } from "../../src/theme-lab/ThemeLabView";
import {
  contentTurn,
  makeGenerationHarness,
  validAuthoringHtml
} from "../support/generationFixtures";
import { MemoryDataAdapter } from "../support/memoryDataAdapter";
import { memoryVault, type MemoryVaultFile } from "../support/memoryVault";
import {
  PersistentObsidianBacking,
  persistentObsidianVault
} from "../support/obsidianVaultFixtures";
import {
  themeComponentLibraryResponse,
  themeConceptResponse,
} from "../support/phase5Fixtures";
import {
  resetRequestUrlHandler,
  setRequestUrlHandler
} from "../setup/obsidian";

afterEach(() => {
  document.body.replaceChildren();
  resetRequestUrlHandler();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("production services behind typed console actions", () => {
  it("drives the lower production chain for generation, editing, management, exports, Theme Lab, and locale safety", async () => {
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
    const prompt = vi.spyOn(window, "prompt").mockReturnValue(null);
    const markdown = "# Console article\n\nGenerated from the primary UI.\n";
    const source = annotateMarkdown(markdown);
    const generation = makeGenerationHarness([
      contentTurn(validAuthoringHtml(source))
    ]);
    const generationVault = memoryVault({ "notes/console.md": markdown });
    const repository = new ArtifactRepository(generationVault, {
      outputFolder: "Galley",
      now: () => new Date("2026-07-15T09:00:00.000Z"),
      randomUUID: uuidSequence(1)
    });
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const generationActions = createGalleyActions({
      inspectActiveContext: async () => ({
        kind: "markdown",
        path: "notes/console.md",
        name: "console.md"
      }),
      listArticles: async () => ({ documents: [], unavailable: [] }),
      openPreview: async () => undefined,
      generate: async (input, signal) => {
        const paths = await generateCurrentArticle(
          {
            getActiveFile: () => ({ path: "notes/console.md", extension: "md" }),
            read: () => generationVault.read("notes/console.md"),
            getSettings: () => normalizeSettings({
              model: "recorded-model",
              outputFolder: "Galley"
            }),
            ...(input.themeId ? { manualThemeId: input.themeId } : {}),
            createPipeline: async () => ({
              model: "recorded-model",
              pipeline: new GenerationPipeline({
                session: generation.session,
                themes: generation.themes
              })
            }),
            createRepository: () => repository,
            notice: () => undefined
          },
          signal
        );
        return {
          status: "committed",
          htmlPath: paths.html,
          sidecarPath: paths.sidecar
        };
      },
      saveLanguage: async () => undefined,
      publishLanguage: () => undefined,
      desktop: {
        openWorkbench: async () => undefined,
        listThemes: async () => [
          {
            id: "graphite-minimal",
            name: "Graphite Minimal",
            builtIn: true,
            enabled: true
          }
        ],
        listSecrets: async () => ["recorded-key"],
        readSettings: async () => ({
          generationAgent: "plugin",
          codexCliPath: "codex",
          claudeCliPath: "claude",
          baseUrl: "https://api.example/v1",
          model: "recorded-model",
          secretId: "recorded-key",
          temperature: 0.4,
          timeoutMs: 120000,
          contextWindow: 128000,
          outputFolder: "Galley",
          language: "en",
          activeSkillVersion: "bundled"
        })
      }
    });
    const generationConsole = new GalleyConsoleView(new WorkspaceLeaf(), {
      actions: generationActions,
      locale,
      mobile: false
    });
    document.body.append(generationConsole.containerEl);
    await generationConsole.onOpen();
    const theme = generationConsole.contentEl.querySelector<HTMLInputElement>(
      '[name="themeId"]'
    );
    if (!theme) throw new Error("missing theme field");
    theme.click();
    generationConsole.contentEl
      .querySelector<HTMLButtonElement>('[data-action="generate"]')
      ?.click();

    await vi.waitFor(
      async () =>
        expect(await generationVault.exists("Galley/console.galley.json")).toBe(true),
      { timeout: 3_000 }
    );
    expect(generation.client.requests).toHaveLength(1);
    const generatedSidecar = GalleySidecarV1Schema.parse(
      JSON.parse(await generationVault.read("Galley/console.galley.json"))
    );
    expect(generatedSidecar.themeId).toBe("graphite-minimal");
    expect(await generationVault.read("notes/console.md")).toBe(markdown);

    const backing = new PersistentObsidianBacking(
      stringSnapshot(generationVault.snapshot())
    );
    const documentVault = persistentObsidianVault(backing);
    const packageAdapter = new MemoryDataAdapter();
    installConsoleVaultPorts(documentVault, backing, packageAdapter);
    const leaves: WorkspaceLeaf[] = [];
    const revealLeaf = vi.fn();
    const executeCommandById = vi.fn();
    const app = {
      vault: documentVault,
      workspace: {
        getActiveFile: () => documentVault.getFileByPath("Galley/console.galley.html"),
        getLeaf: () => {
          const leaf = new WorkspaceLeaf();
          leaves.push(leaf);
          return leaf;
        },
        revealLeaf,
        on: () => ({})
      },
      commands: { executeCommandById },
      secretStorage: {
        getSecret: (id: string) => (id === "provider-key" ? "secret" : null),
        listSecrets: () => ["provider-key"],
        setSecret: () => undefined
      }
    } as unknown as App;
    let durable = normalizeSettings({
      language: "en",
      baseUrl: "https://api.example.test/v1",
      model: "recorded-model",
      secretId: "provider-key",
      outputFolder: "Galley"
    });
    let current = durable;
    const host: DesktopConsoleHost = {
      app,
      capabilities: derivePlatformCapabilities(false),
      locale,
      getSettings: () => current,
      replaceSettings: (settings) => {
        current = normalizeSettings(settings);
      },
      loadData: async () => durable,
      saveData: async (value) => {
        durable = normalizeSettings(value);
      },
      saveSettings: async () => {
        durable = normalizeSettings(current);
      }
    };
    const desktop = createDesktopActions(host);
    const catalog = new ArticleCatalog(documentVault as never);
    const actions = createGalleyActions({
      inspectActiveContext: async () => ({
        kind: "galley",
        path: "Galley/console.galley.html",
        name: "console.galley.html"
      }),
      listArticles: () => catalog.snapshot(),
      openPreview: async (path) => {
        const leaf = app.workspace.getLeaf("tab");
        await leaf.setViewState({ type: "galley-preview", state: { path }, active: true });
      },
      saveLanguage: async (language) => {
        host.replaceSettings(normalizeSettings({ ...host.getSettings(), language }));
        await host.saveSettings();
      },
      publishLanguage: (language) => locale.configure(language),
      desktop
    });
    const consoleView = new GalleyConsoleView(new WorkspaceLeaf(), {
      actions,
      locale,
      mobile: false
    });
    document.body.append(consoleView.containerEl);
    await consoleView.onOpen();

    await consoleView.navigate("articles");
    const edit = consoleView.contentEl.querySelector<HTMLButtonElement>(
      '[data-action="edit"]'
    );
    expect(edit).not.toBeNull();
    edit?.click();
    await vi.waitFor(() =>
      expect(leafState(leaves.at(-1))).toMatchObject({
        type: "galley-workbench",
        state: { path: "Galley/console.galley.html" }
      })
    );

    const documentSession = await new ObsidianDocumentSessionOpener(documentVault, {
      now: () => new Date("2026-07-15T09:01:00.000Z"),
      randomUUID: uuidSequence(2)
    }).open("Galley/console.galley.html");
    const editorHost = document.createElement("div");
    document.body.append(editorHost);
    const editor = new HugeRteAdapter();
    await editor.mount(editorHost, documentSession.bodyHtml(), {
      documentBaseUrl: "app://vault/Galley/",
      onChange: () => undefined
    });
    const visualBody = document.createElement("template");
    visualBody.innerHTML = editor.getHtml();
    const firstBlock = visualBody.content.querySelector(
      `[data-galley-source="${source.blocks[0]!.id}"]`
    );
    if (!firstBlock) throw new Error("visual edit target missing");
    firstBlock.textContent = "visually edited through HugeRTE";
    editor.setHtml(visualBody.innerHTML);
    documentSession.updateBody(editor.getHtml());
    await documentSession.save("explicit");
    editor.destroy();
    editorHost.remove();
    expect(documentSession.html()).toContain("visually edited through HugeRTE");

    expect(
      [...consoleView.contentEl.querySelectorAll('[role="tab"]')]
        .map((tab) => tab.textContent)
    ).not.toContain("Export configurations");
    host.replaceSettings({
      ...host.getSettings(),
      exportConfigurations: managedConfigurations()
    });
    await host.saveSettings();
    expect(durable.exportConfigurations).toEqual(managedConfigurations());

    const savedAuthoringBytes = backing.read("Galley/console.galley.html");
    const exportService = new ExportService({
      profiles: [new StandardWebProfile(), new PortableInlineProfile(), new WechatProfile()],
      writer: new ObsidianExportArtifactWriter(documentVault),
      recorder: {
        record: (record, signal) => documentSession.recordExport(record, signal)
      },
      now: () => new Date("2026-07-15T09:02:00.000Z"),
      randomUUID: uuidSequence(3)
    });
    const exported = [];
    for (const configuration of durable.exportConfigurations) {
      exported.push(
        await exportService.export(
          {
            source: {
              htmlPath: "Galley/console.galley.html",
              documentId: documentSession.documentId(),
              html: documentSession.html(),
              reservedPaths: documentSession.exportPaths()
            },
            configuration
          },
          new AbortController().signal
        )
      );
    }
    expect(backing.read("Galley/console.galley.html")).toBe(savedAuthoringBytes);
    expect(exported.map(({ record }) => record.profileId)).toEqual([
      "standard-web",
      "portable-inline",
      "wechat"
    ]);
    expect(exported[0]?.html).toMatch(/^<!DOCTYPE html>/u);
    expect(exported[1]?.html).not.toMatch(/<!DOCTYPE|<script/iu);
    expect(validateWechatHtml(exported[2]?.html ?? "").valid).toBe(true);
    for (const artifact of exported) {
      expect(backing.read(artifact.path)).toBe(artifact.html);
    }

    const providerResponses = [
      openAiContent("unsupported"),
      openAiContent(themeConceptResponse()),
      openAiContent(themeComponentLibraryResponse())
    ];
    setRequestUrlHandler(async () => {
      const response = providerResponses.shift();
      if (!response) throw new Error("Unexpected provider request");
      return response;
    });
    await consoleView.navigate("themes");
    consoleView.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-lab"]')
      ?.click();
    await vi.waitFor(() =>
      expect(leafState(leaves.at(-1))).toMatchObject({ type: "galley-theme-lab" })
    );
    let themeSaveError: unknown;
    const themeLab = new ThemeLabView(leaves.at(-1)!, {
      supportsVision: () =>
        themeRuntime.supportsThemeVision(app, host.getSettings()),
      generate: (input, signal) =>
        themeRuntime.generateThemeDraft(app, host.getSettings(), input, signal),
      save: async (draft, signal, progress) => {
        try {
          return await themeRuntime.finalizeAndSaveThemeDraft(
            app,
            draft,
            host.getSettings(),
            signal,
            progress
          );
        } catch (error) {
          themeSaveError = error;
          throw error;
        }
      },
      report: () => undefined,
      locale
    });
    await themeLab.onOpen();
    const description = themeLab.contentEl.querySelector<HTMLTextAreaElement>("textarea");
    if (!description) throw new Error("Theme Lab description missing");
    description.value = "A calm ocean research notebook";
    themeLab.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-generate"]')
      ?.click();
    await vi.waitFor(() =>
      expect(
        themeLab.contentEl
          .querySelector<HTMLButtonElement>('[data-action="theme-save"]')
          ?.disabled
      ).toBe(false)
    );
    expect((await desktop.listThemes?.())?.some(({ id }) => id === "ocean-notes")).toBe(false);
    themeLab.contentEl
      .querySelector<HTMLButtonElement>('[data-action="theme-save"]')
      ?.click();
    await vi.waitFor(() =>
      expect(
        themeLab.contentEl.querySelector(".galley-theme-lab__status")?.textContent
      ).not.toBe("Draft is valid. Review the full page, then save explicitly.")
    );
    if (themeSaveError) throw themeSaveError;
    await vi.waitFor(() =>
      expect(
        themeLab.contentEl.querySelector(".galley-theme-lab__status")?.textContent
      ).toBe("Theme saved and available to new Skill sessions.")
    );
    await vi.waitFor(async () =>
      expect((await desktop.listThemes?.())?.some(({ id }) => id === "ocean-notes")).toBe(true)
    );
    expect(providerResponses).toEqual([]);

    const beforeLanguageSwitch = backingSnapshot(backing);
    const language = consoleView.contentEl.querySelector<HTMLSelectElement>(
      '[aria-label="Language"]'
    );
    if (!language) throw new Error("Language selector missing");
    language.value = "zh-CN";
    language.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(consoleView.contentEl.textContent).toContain("主题"));
    expect(durable.language).toBe("zh-CN");
    expect(backingSnapshot(backing)).toEqual(beforeLanguageSwitch);
    expect(executeCommandById).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();

    const finalSidecar = GalleySidecarV1Schema.parse(
      JSON.parse(backing.read("Galley/console.galley.json") ?? "")
    );
    expect(finalSidecar.exports.map(({ profileId }) => profileId)).toEqual([
      "standard-web",
      "portable-inline",
      "wechat"
    ]);
    await themeLab.onClose();
    await consoleView.onClose();
    catalog.dispose();
  }, 30_000);
});

function installConsoleVaultPorts(
  vault: Vault,
  backing: PersistentObsidianBacking,
  packageAdapter: MemoryDataAdapter
): void {
  packageAdapter.folders.add(".galley");
  const documentAdapter = vault.adapter;
  const packages = packageAdapter.asDataAdapter();
  const adapter = new Proxy(documentAdapter as object, {
    get(target, property) {
      if (property === "getName") return () => "console-integration-vault";
      const documentValue = Reflect.get(target, property);
      const packageValue = Reflect.get(packages as object, property);
      if (
        typeof documentValue !== "function" &&
        typeof packageValue !== "function"
      ) return documentValue;
      return (...args: unknown[]) => {
        const path = typeof args[0] === "string" ? args[0] : "";
        const selected = isPackagePath(path) ? packages : documentAdapter;
        const operation = Reflect.get(selected as object, property);
        if (typeof operation !== "function") {
          throw new Error(`Adapter operation unavailable: ${String(property)}`);
        }
        return Reflect.apply(operation, selected, args);
      };
    }
  }) as DataAdapter;
  Object.assign(vault as object, {
    adapter,
    configDir: ".obsidian",
    getFiles: () =>
      backing
        .paths()
        .map((path) => vault.getFileByPath(path))
        .filter((file): file is TFile => file !== null),
    on: () => ({}),
    offref: () => undefined,
    getResourcePath: (file: TFile) => `app://vault/${file.path}`
  });
}

function leafState(leaf: WorkspaceLeaf | undefined): unknown {
  return (leaf as unknown as { state?: unknown } | undefined)?.state;
}

function isPackagePath(path: string): boolean {
  return (
    path === ".obsidian" ||
    path.startsWith(".obsidian/") ||
    path === ".galley/themes" ||
    path.startsWith(".galley/themes/")
  );
}

function fillExportConfiguration(
  container: HTMLElement,
  configuration: ExportConfiguration
): void {
  for (const [name, value] of [
    ["id", configuration.id],
    ["name", configuration.name],
    ["outputFolder", configuration.outputFolder],
    ["fileNameTemplate", configuration.fileNameTemplate]
  ] as const) {
    const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
    if (!input) throw new Error(`Missing export field: ${name}`);
    input.value = value;
    input.dispatchEvent(new Event("input"));
  }
  const profile = container.querySelector<HTMLSelectElement>('[name="profileId"]');
  if (!profile) throw new Error("Missing export profile");
  profile.value = configuration.profileId;
  profile.dispatchEvent(new Event("change"));
}

function managedConfigurations(): GalleySettings["exportConfigurations"] {
  return Object.freeze([
    {
      id: "standard-web",
      name: "Standard web",
      profileId: "standard-web" as const,
      outputFolder: "exports",
      fileNameTemplate: "{stem}.standard-web.html"
    },
    {
      id: "portable-inline",
      name: "Portable inline",
      profileId: "portable-inline" as const,
      outputFolder: "exports",
      fileNameTemplate: "{stem}.portable.html"
    },
    {
      id: "wechat",
      name: "WeChat editor",
      profileId: "wechat" as const,
      outputFolder: "exports",
      fileNameTemplate: "{stem}.wechat.html"
    }
  ]);
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

function backingSnapshot(backing: PersistentObsidianBacking): Record<string, string> {
  return Object.fromEntries(
    backing.paths().map((path) => [path, backing.read(path) ?? ""])
  );
}

function uuidSequence(namespace: number): () => string {
  let index = 0;
  return () =>
    `123e4567-e89b-42d3-a${namespace
      .toString(16)
      .padStart(3, "0")}-${(++index).toString(16).padStart(12, "0")}`;
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
