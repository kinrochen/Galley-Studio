import type { App } from "obsidian";

import type { GalleySettings } from "../settings/GalleySettings";
import { ImportedSkillRepository } from "../skill/ImportedSkillRepository";
import { SkillPackageSettings } from "../skill/SkillPackageSettings";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import { ThemeGenerationService, type ThemeDraft, type ThemeGenerationInput } from "../theme-lab/ThemeGenerationService";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import { CustomThemeRepository } from "../themes/CustomThemeRepository";
import { ObsidianCustomThemeStore } from "../themes/ObsidianCustomThemeStore";
import { ThemeArchive } from "../themes/ThemeArchive";
import {
  createProductionSkillContext,
  importedSkillRepository,
  loadActiveSkillPackage,
  probeProductionVision
} from "./ProductionSkillContext";

export async function supportsThemeVision(
  app: App,
  settings: Readonly<GalleySettings>
): Promise<boolean> {
  return probeProductionVision(app, settings, new AbortController().signal);
}

export async function generateThemeDraft(
  app: App,
  settings: Readonly<GalleySettings>,
  input: ThemeGenerationInput,
  signal: AbortSignal
): Promise<ThemeDraft> {
  const context = await createProductionSkillContext(
    app,
    settings,
    signal,
    "theme",
    input.referenceImage !== undefined
  );
  return new ThemeGenerationService({
    session: context.session,
    capabilities: context.capabilities,
    repository: context.customThemes
  }).generate(input, signal);
}

export async function saveThemeDraft(
  app: App,
  draft: ThemeDraft,
  settings: Readonly<GalleySettings>
): Promise<void> {
  if (!draft.validation.valid) throw new Error("Theme draft validation failed.");
  const repository = await customThemeRepository(app, settings);
  await repository.save({
    manifest: draft.manifest,
    componentLibrary: draft.componentLibrary,
    previewHtml: draft.previewHtml
  });
}

export async function importThemeArchive(
  app: App,
  bytes: Uint8Array,
  settings: Readonly<GalleySettings>
): Promise<string> {
  const repository = await customThemeRepository(app, settings);
  const archive = new ThemeArchive();
  const files = archive.import(bytes);
  await repository.save(files);
  return files.manifest.id;
}

export async function exportThemeArchive(
  app: App,
  id: string,
  settings: Readonly<GalleySettings>
): Promise<{ readonly filename: string; readonly bytes: Uint8Array }> {
  const repository = await customThemeRepository(app, settings);
  return {
    filename: `${id}.galley-theme.zip`,
    bytes: await repository.export(id, new ThemeArchive())
  };
}

export async function listCustomThemes(
  app: App,
  settings: Readonly<GalleySettings>
): Promise<readonly { readonly id: string; readonly name: string; readonly enabled: boolean }[]> {
  return (await (await customThemeRepository(app, settings)).list()).map(({ manifest }) => ({
    id: manifest.id,
    name: manifest.name,
    enabled: manifest.enabled
  }));
}

export async function setCustomThemeEnabled(
  app: App,
  id: string,
  enabled: boolean,
  settings: Readonly<GalleySettings>
): Promise<void> {
  await (await customThemeRepository(app, settings)).setEnabled(id, enabled);
}

export async function deleteCustomTheme(
  app: App,
  id: string,
  settings: Readonly<GalleySettings>
): Promise<boolean> {
  return (await customThemeRepository(app, settings)).delete(id);
}

export async function importSkillArchive(
  app: App,
  bytes: Uint8Array
): Promise<string> {
  const imported = await importedSkillRepository(app).import(bytes);
  return imported.version;
}

export async function listImportedSkills(app: App): Promise<readonly string[]> {
  return importedSkillRepository(app).list();
}

export async function activateImportedSkill(
  app: App,
  version: string,
  currentVersion: string,
  persist: ((version: string) => Promise<void>) & {
    readonly read?: () => Promise<string>;
  }
): Promise<void> {
  const repository: ImportedSkillRepository = importedSkillRepository(app);
  const transaction = Object.assign(
    async (next: SkillPackageSettings) => persist(next.activeVersion),
    persist.read
      ? {
          read: async () => new SkillPackageSettings(await persist.read!())
        }
      : {}
  );
  await repository.activate(
    version,
    new SkillPackageSettings(currentVersion),
    transaction
  );
}

async function customThemeRepository(
  app: App,
  settings: Readonly<GalleySettings>
): Promise<CustomThemeRepository> {
  const active = await loadActiveSkillPackage(app, settings);
  const builtIns = new BuiltInThemeRepository(
    new SkillVirtualFileSystem(active.skillPackage.files)
  );
  return new CustomThemeRepository(
    new ObsidianCustomThemeStore(app.vault.adapter),
    builtIns.list().map(({ id }) => id),
    [...active.skillPackage.files.keys()]
  );
}
