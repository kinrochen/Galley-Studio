import { describe, expect, it, vi } from "vitest";
import { renderThemePage } from "../../src/console/ThemePage";
import { renderSkillPage } from "../../src/console/SkillPage";
import {
  renderExportConfigurationPage,
  type ExportConfigurationFormState
} from "../../src/console/ExportConfigurationPage";
import { renderSettingsPage } from "../../src/console/SettingsPage";
import type { GalleyActions } from "../../src/console/GalleyActions";
import { LocaleStore } from "../../src/i18n/LocaleStore";

const text = new LocaleStore({ language: "en", obsidianLocale: () => "en" });

describe("console management pages", () => {
  it("shows built-in and custom themes with import/export/toggle/delete and Theme Lab", async () => {
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

    expect(container.textContent).toContain("Paper (paper)");
    expect(container.querySelector('[data-action="theme-import"]')).not.toBeNull();
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

  it("rejects oversized theme and Skill files before allocating bytes", async () => {
    const themeArrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const skillArrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const importTheme = vi.fn(async () => "theme");
    const importSkill = vi.fn(async () => "skill");
    const failures: string[] = [];
    const run = async (
      operation: string,
      action: (signal: AbortSignal) => Promise<unknown>
    ) => {
      try {
        await action(new AbortController().signal);
      } catch {
        failures.push(operation);
      }
    };
    const theme = document.createElement("div");
    await renderThemePage(theme, {
      actions: baseActions({ importTheme, listThemes: async () => [] }),
      text,
      confirm: () => true,
      run
    });
    const themeInput = theme.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(themeInput, "files", {
      configurable: true,
      value: [{ size: 12 * 1024 * 1024 + 1, arrayBuffer: themeArrayBuffer }]
    });
    themeInput.dispatchEvent(new Event("change"));

    const skill = document.createElement("div");
    await renderSkillPage(skill, {
      actions: baseActions({ importSkill, listSkills: async () => [] }),
      text,
      confirm: () => true,
      run
    });
    const skillInput = skill.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(skillInput, "files", {
      configurable: true,
      value: [{ size: 25 * 1024 * 1024 + 1, arrayBuffer: skillArrayBuffer }]
    });
    skillInput.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(failures).toEqual(["theme-import", "skill-import"]));
    expect(themeArrayBuffer).not.toHaveBeenCalled();
    expect(skillArrayBuffer).not.toHaveBeenCalled();
    expect(importTheme).not.toHaveBeenCalled();
    expect(importSkill).not.toHaveBeenCalled();
  });

  it("imports Skills inactive and requires explicit confirmed activation", async () => {
    const activateSkill = vi.fn(async () => undefined);
    const confirm = vi.fn(() => true);
    const container = document.createElement("div");
    await renderSkillPage(container, {
      actions: baseActions({
        listSkills: async () => [
          { version: "bundled", source: "bundled", active: true, valid: true },
          { version: "2026.7", source: "imported", active: false, valid: true }
        ],
        activateSkill
      }),
      text,
      confirm,
      run: directRun
    });

    container.querySelector<HTMLButtonElement>('[data-action="skill-activate"]')?.click();
    await vi.waitFor(() => expect(activateSkill).toHaveBeenCalledWith("2026.7"));
    expect(confirm).toHaveBeenCalledWith("Activate “2026.7”?");
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

  it("renders every desktop setting, SecretStorage choices, and explicit diagnostics", async () => {
    const runDiagnostic = vi.fn(async () => ({ ok: true }));
    const container = document.createElement("div");
    await renderSettingsPage(container, {
      actions: baseActions({
        readSettings: async () => ({
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

    expect(container.querySelectorAll("form input")).toHaveLength(6);
    expect(
      [...container.querySelectorAll<HTMLSelectElement>('[name="secretId"] option')].map(
        (option) => option.value
      )
    ).toEqual(["provider-key", "backup-key"]);
    container.querySelector<HTMLButtonElement>('[data-action="diagnostic"]')?.click();
    await vi.waitFor(() => expect(runDiagnostic).toHaveBeenCalledTimes(1));
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
