import { expect, it } from "vitest";
import type { App } from "obsidian";

import { saveThemeDraft } from "../../src/platform/DesktopThemeRuntime";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import { ImportedSkillRepository } from "../../src/skill/ImportedSkillRepository";
import { ObsidianImportedSkillStore } from "../../src/skill/ObsidianImportedSkillStore";
import { SkillArchiveImporter } from "../../src/skill/SkillArchiveImporter";
import type { ThemeDraft } from "../../src/theme-lab/ThemeGenerationService";
import {
  customThemeManifest,
  validComponentLibrary,
  validSkillArchive,
  validThemePreview
} from "../support/phase5Fixtures";
import { MemoryDataAdapter } from "../support/memoryDataAdapter";

it("binds theme save collision checks to the complete active imported Skill namespace", async () => {
  const memory = new MemoryDataAdapter();
  const adapter = memory.asDataAdapter();
  const imported = await new ImportedSkillRepository(
    new ObsidianImportedSkillStore(
      adapter,
      ".obsidian/plugins/galley/skills",
      () => "skill-stage"
    ),
    new SkillArchiveImporter()
  ).import(validSkillArchive());
  const app = {
    vault: { adapter, configDir: ".obsidian" }
  } as unknown as App;
  const settings = normalizeSettings({ activeSkillVersion: imported.version });
  const draft: ThemeDraft = {
    manifest: customThemeManifest(),
    componentLibrary: validComponentLibrary(),
    previewHtml: validThemePreview(),
    skillAudit: {
      skillId: "gzh-design",
      skillVersion: imported.version,
      packageHash: imported.packageHash,
      loadMode: "injected",
      files: []
    },
    validation: { valid: true, issues: [] }
  };
  const saveWithActiveSettings = saveThemeDraft as unknown as (
    app: App,
    draft: ThemeDraft,
    settings: ReturnType<typeof normalizeSettings>
  ) => Promise<void>;

  await expect(
    saveWithActiveSettings(app, draft, settings)
  ).rejects.toMatchObject({ code: "theme_id_collision" });
});
