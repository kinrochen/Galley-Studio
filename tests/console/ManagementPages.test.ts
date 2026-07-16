import { describe, expect, it, vi } from "vitest";
import { renderThemePage } from "../../src/console/ThemePage";
import {
  renderExportConfigurationPage,
  type ExportConfigurationFormState
} from "../../src/console/ExportConfigurationPage";
import { renderSettingsPage } from "../../src/console/SettingsPage";
import type { GalleyActions } from "../../src/console/GalleyActions";
import { LocaleStore } from "../../src/i18n/LocaleStore";

const text = new LocaleStore({ language: "en", obsidianLocale: () => "en" });

describe("console management pages", () => {
  it("shows built-in and custom themes with Theme Lab, export, toggle, and delete", async () => {
    const openThemeLab = vi.fn(async () => undefined);
    const setThemeEnabled = vi.fn(async () => undefined);
    const deleteTheme = vi.fn(async () => true);
    const exportTheme = vi.fn(async () => ({
      filename: "custom.galley-theme.zip",
      bytes: new Uint8Array([1, 2, 3])
    }));
    const confirm = vi.fn(() => true);
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const actions = baseActions({
      openThemeLab,
      listThemes: async () => [
        { id: "paper", name: "Paper", builtIn: true, enabled: true },
        { id: "custom", name: "Custom", builtIn: false, enabled: true }
      ],
      exportTheme,
      setThemeEnabled,
      deleteTheme
    });
    const container = document.createElement("div");

    await renderThemePage(container, {
      actions,
      text,
      confirm,
      run: directRun
    });

    expect(container.querySelector('[data-theme-id="paper"]')?.textContent)
      .toContain("PaperpaperBuilt in");
    expect(container.querySelector('[data-action="theme-import"]')).toBeNull();
    container.querySelector<HTMLButtonElement>('[data-action="theme-lab"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-action="theme-toggle"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-action="theme-export"]')?.click();
    container.querySelector<HTMLButtonElement>('[data-action="theme-delete"]')?.click();
    await vi.waitFor(() => expect(deleteTheme).toHaveBeenCalledWith("custom"));
    expect(openThemeLab).toHaveBeenCalledTimes(1);
    expect(setThemeEnabled).toHaveBeenCalledWith("custom", false);
    expect(exportTheme).toHaveBeenCalledWith("custom");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Delete “custom”?");
  });

  it("retains export configuration input after validation errors and exposes three profiles", async () => {
    const state: ExportConfigurationFormState = {
      id: "client",
      name: "Client",
      profileId: "wechat",
      outputFolder: "exports",
      fileNameTemplate: "{stem}.html"
    };
    const saveExportConfiguration = vi.fn(async () => {
      throw new Error("invalid");
    });
    const container = document.createElement("div");
    await renderExportConfigurationPage(container, {
      actions: baseActions({
        listExportConfigurations: async () => [
          {
            id: "source",
            name: "Source",
            profileId: "portable-inline",
            outputFolder: "published",
            fileNameTemplate: "{stem}.portable.html"
          }
        ],
        saveExportConfiguration
      }),
      text,
      state,
      confirm: () => true,
      run: async (_operation, action) => {
        await action(new AbortController().signal).catch(() => undefined);
      }
    });

    container.querySelector<HTMLFormElement>("form")?.dispatchEvent(
      new Event("submit")
    );
    await vi.waitFor(() => expect(saveExportConfiguration).toHaveBeenCalled());
    expect(state).toMatchObject({ id: "client", profileId: "wechat" });
    expect(
      [...container.querySelectorAll<HTMLSelectElement>('select[name="profileId"] option')].map(
        (option) => option.value
      )
    ).toEqual(["standard-web", "portable-inline", "wechat"]);
    container
      .querySelector<HTMLButtonElement>('[data-action="export-config-duplicate"]')
      ?.click();
    expect(container.querySelector<HTMLInputElement>('[name="id"]')?.value).toBe(
      "source-copy"
    );
    expect(container.querySelector<HTMLSelectElement>('[name="profileId"]')?.value).toBe(
      "portable-inline"
    );
  });

  it("edits a complete export configuration and localizes profile labels and duplicate names", async () => {
    const locale = new LocaleStore({ language: "zh-CN", obsidianLocale: () => "zh-CN" });
    const state: ExportConfigurationFormState = {
      id: "draft",
      name: "草稿",
      profileId: "standard-web",
      outputFolder: "drafts",
      fileNameTemplate: "{stem}.html"
    };
    const container = document.createElement("div");
    await renderExportConfigurationPage(container, {
      actions: baseActions({
        listExportConfigurations: async () => [{
          id: "source",
          name: "Source",
          profileId: "portable-inline",
          outputFolder: "published",
          fileNameTemplate: "{stem}.portable.html"
        }]
      }),
      text: locale,
      state,
      confirm: () => true,
      run: directRun
    });

    const profile = container.querySelector<HTMLSelectElement>('[name="profileId"]')!;
    expect([...profile.options].map((option) => option.textContent)).toEqual([
      "标准网页",
      "便携内联",
      "微信编辑器"
    ]);
    expect(profile.closest("label")?.textContent).toContain("导出类型");
    expect(profile.getAttribute("aria-label")).toBe("导出类型");

    container.querySelector<HTMLButtonElement>('[data-action="export-config-edit"]')?.click();
    expect(state).toEqual({
      id: "source",
      name: "Source",
      profileId: "portable-inline",
      outputFolder: "published",
      fileNameTemplate: "{stem}.portable.html"
    });
    expect(container.querySelector<HTMLInputElement>('[name="outputFolder"]')?.value)
      .toBe("published");

    container
      .querySelector<HTMLButtonElement>('[data-action="export-config-duplicate"]')
      ?.click();
    expect(container.querySelector<HTMLInputElement>('[name="name"]')?.value)
      .toBe("Source 副本");
  });

  it("renders only the Agent connection settings and explicit diagnostics", async () => {
    const runDiagnostic = vi.fn(async () => ({
      ok: true,
      model: "model-x"
    }));
    const container = document.createElement("div");
    await renderSettingsPage(container, {
      actions: baseActions({
        readSettings: async () => ({
          generationAgent: "plugin",
          codexCliPath: "codex",
          claudeCliPath: "claude",
          baseUrl: "https://api.example.com/v1",
          model: "model-x",
          secretId: "provider-key",
          temperature: 0.4,
          timeoutMs: 120000,
          contextWindow: 128000,
          outputFolder: "Galley",
          language: "en"
        }),
        listSecrets: async () => ["provider-key", "backup-key"],
        runDiagnostic
      }),
      text,
      state: {},
      run: directRun
    });

    expect(container.querySelectorAll("form input")).toHaveLength(2);
    expect(
      [...container.querySelectorAll<HTMLSelectElement>('[name="generationAgent"] option')]
        .map((option) => option.value)
    ).toEqual(["plugin", "codex-cli", "claude-cli"]);
    for (const removed of ["temperature", "timeoutMs", "contextWindow", "outputFolder"]) {
      expect(container.querySelector(`[name="${removed}"]`)).toBeNull();
    }
    expect(container.querySelector('[name="codexCliPath"]')).toBeNull();
    expect(container.querySelector('[name="claudeCliPath"]')).toBeNull();
    expect(
      [...container.querySelectorAll<HTMLSelectElement>('[name="secretId"] option')].map(
        (option) => option.value
      )
    ).toEqual(["provider-key", "backup-key"]);
    container.querySelector<HTMLButtonElement>('[data-action="diagnostic"]')?.click();
    await vi.waitFor(() => expect(runDiagnostic).toHaveBeenCalledTimes(1));
  });

  it("persists the visible provider configuration as soon as the Agent changes", async () => {
    const saveSettings = vi.fn(async (value) => ({
      generationAgent: value.generationAgent ?? "claude-cli",
      codexCliPath: "codex",
      claudeCliPath: "claude",
      baseUrl: String(value.baseUrl ?? "https://api.openai.com/v1"),
      model: String(value.model ?? ""),
      secretId: String(value.secretId ?? ""),
      temperature: 0.4,
      timeoutMs: 1_800_000,
      contextWindow: 128000,
      outputFolder: "",
      language: "zh-CN" as const
    }));
    const container = document.createElement("div");
    await renderSettingsPage(container, {
      actions: baseActions({
        readSettings: async () => ({
          generationAgent: "claude-cli",
          codexCliPath: "codex",
          claudeCliPath: "claude",
          baseUrl: "https://api.openai.com/v1",
          model: "",
          secretId: "",
          temperature: 0.4,
          timeoutMs: 1_800_000,
          contextWindow: 128000,
          outputFolder: "",
          language: "zh-CN"
        }),
        listSecrets: async () => ["key"],
        saveSettings
      }),
      text,
      state: {},
      run: directRun
    });

    const baseUrl = container.querySelector<HTMLInputElement>('[name="baseUrl"]')!;
    const model = container.querySelector<HTMLInputElement>('[name="model"]')!;
    const secret = container.querySelector<HTMLSelectElement>('[name="secretId"]')!;
    const agent = container.querySelector<HTMLSelectElement>('[name="generationAgent"]')!;
    baseUrl.value = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    model.value = "qwen3.7-plus";
    secret.value = "key";
    agent.value = "plugin";
    agent.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledWith({
      generationAgent: "plugin",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen3.7-plus",
      secretId: "key"
    });
  });

  it("never saves a stale cached language and displays the latest durable language", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    let durableLanguage: "en" | "zh-CN" = "en";
    const saveSettings = vi.fn(async (value) => ({
      generationAgent: "plugin" as const,
      codexCliPath: "codex",
      claudeCliPath: "claude",
      baseUrl: "https://api.example.com/v1",
      model: String(value.model ?? "model-x"),
      secretId: "provider-key",
      temperature: 0.4,
      timeoutMs: 120000,
      contextWindow: 128000,
      outputFolder: "Galley",
      language: durableLanguage
    }));
    const state = {};
    const container = document.createElement("div");
    const actions = baseActions({
      readSettings: async () => ({
        generationAgent: "plugin",
        codexCliPath: "codex",
        claudeCliPath: "claude",
        baseUrl: "https://api.example.com/v1",
        model: "model-x",
        secretId: "provider-key",
        temperature: 0.4,
        timeoutMs: 120000,
        contextWindow: 128000,
        outputFolder: "Galley",
        language: durableLanguage
      }),
      listSecrets: async () => ["provider-key"],
      saveSettings
    });

    await renderSettingsPage(container, { actions, text: locale, state, run: directRun });
    durableLanguage = "zh-CN";
    locale.configure("zh-CN");
    container.replaceChildren();
    await renderSettingsPage(container, { actions, text: locale, state, run: directRun });
    const model = container.querySelector<HTMLInputElement>('[name="model"]')!;
    model.value = "model-y";
    model.dispatchEvent(new Event("input"));
    container.querySelector<HTMLFormElement>("form")?.dispatchEvent(new Event("submit"));

    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings.mock.calls[0]?.[0]).not.toHaveProperty("language");
    expect(saveSettings.mock.calls[0]?.[0]).toMatchObject({ model: "model-y" });
    expect(container.querySelector('[data-setting-language]')?.textContent).toContain("中文");
  });

  it("keeps a redacted diagnostic snapshot and retranslates it after locale changes", async () => {
    const locale = new LocaleStore({ language: "en", obsidianLocale: () => "en" });
    const state = {};
    const container = document.createElement("div");
    const actions = baseActions({
      readSettings: async () => ({
        generationAgent: "plugin",
        codexCliPath: "codex",
        claudeCliPath: "claude",
        baseUrl: "https://api.example.com/v1",
        model: "diagnostic-model",
        secretId: "provider-key",
        temperature: 0.4,
        timeoutMs: 120000,
        contextWindow: 128000,
        outputFolder: "Galley",
        language: "en"
      }),
      listSecrets: async () => ["provider-key"],
      runDiagnostic: async () => ({
        ok: false,
        model: "diagnostic-model",
        errorCode: "invalid_response\nAuthorization: secret"
      })
    });

    await renderSettingsPage(container, { actions, text: locale, state, run: directRun });
    container.querySelector<HTMLButtonElement>('[data-action="diagnostic"]')?.click();
    await vi.waitFor(() =>
      expect(container.querySelector('[data-diagnostic-result]')?.textContent)
        .toContain("diagnostic-model")
    );
    expect(container.querySelector('[data-diagnostic-result]')?.textContent).toContain("diagnostic_failed");
    expect(container.querySelector('[data-diagnostic-result]')?.textContent).not.toContain("Authorization");
    expect(container.querySelector('[data-diagnostic-result]')?.textContent).not.toContain("Skill");

    locale.configure("zh-CN");
    container.replaceChildren();
    await renderSettingsPage(container, { actions, text: locale, state, run: directRun });
    expect(container.querySelector('[data-diagnostic-result]')?.textContent).toContain("不可用");
    expect(container.querySelector('[data-diagnostic-result]')?.textContent).not.toContain("技能");
  });
});

async function directRun(
  _operation: string,
  action: (signal: AbortSignal) => Promise<unknown>
): Promise<void> {
  await action(new AbortController().signal);
}

function baseActions(
  desktop: Partial<NonNullable<GalleyActions["desktop"]>>
): GalleyActions {
  return {
    desktop: {
      openWorkbench: async () => undefined,
      ...desktop
    },
    inspectActiveContext: async () => ({ kind: "empty" }),
    listArticles: async () => ({ documents: [], unavailable: [] }),
    openPreview: async () => undefined,
    generateActiveMarkdown: async () => {
      throw new Error("unused");
    },
    setLanguage: async () => undefined
  };
}
