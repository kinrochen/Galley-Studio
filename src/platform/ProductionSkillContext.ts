import type { App } from "obsidian";

import themeGeneratorProfile from "../../assets/profiles/theme-generator.md?raw";
import { AiError } from "../ai/AiError";
import { validateBaseUrl } from "../ai/BaseUrlPolicy";
import { CapabilityProbe, type ProviderCapabilities } from "../ai/CapabilityProbe";
import { OpenAiCompatibleClient } from "../ai/OpenAiCompatibleClient";
import { VisionCapabilityProbe } from "../ai/VisionCapabilityProbe";
import { createObsidianTransport } from "../diagnostics/ObsidianTransport";
import { createWechatRepairSkillPackage } from "../export/WechatRepairSkillPackage";
import { BUNDLED_SKILL } from "../generated/bundledSkill";
import { ObsidianSecretStore } from "../secrets/SecretStore";
import type { GalleySettings } from "../settings/GalleySettings";
import { BundledSkillLoader } from "../skill/BundledSkillLoader";
import { ImportedSkillRepository } from "../skill/ImportedSkillRepository";
import { ObsidianImportedSkillStore } from "../skill/ObsidianImportedSkillStore";
import type { SkillPackage } from "../skill/SkillPackage";
import { SkillArchiveImporter } from "../skill/SkillArchiveImporter";
import { SkillSession } from "../skill/SkillSession";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import { CustomThemeRepository } from "../themes/CustomThemeRepository";
import { MergedThemeRepository } from "../themes/MergedThemeRepository";
import { ObsidianCustomThemeStore } from "../themes/ObsidianCustomThemeStore";

export type ProductionSkillProfile = "generation" | "theme" | "wechat";

export interface ProductionSkillContext {
  readonly session: SkillSession;
  readonly vfs: SkillVirtualFileSystem;
  readonly capabilities: ProviderCapabilities;
  readonly customThemes: CustomThemeRepository;
}

export async function createProductionSkillContext(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal,
  profile: ProductionSkillProfile,
  vision = false
): Promise<ProductionSkillContext> {
  const secretStore = new ObsidianSecretStore(app);
  if (!settings.secretId || !secretStore.get(settings.secretId)) {
    throw new AiError("missing_secret");
  }
  try {
    validateBaseUrl(settings.baseUrl);
  } catch {
    throw new AiError("invalid_base_url");
  }
  const client = OpenAiCompatibleClient.fromSettings(
    createObsidianTransport(),
    settings as GalleySettings,
    secretStore
  );
  const target = { baseUrl: settings.baseUrl, model: settings.model };
  const capabilities = await new CapabilityProbe(client).probe(target, signal);
  if (vision) {
    capabilities.vision = await new VisionCapabilityProbe(client).probe(target, signal);
  }

  const active = await loadActiveSkill(app, settings);
  const baseVfs = new SkillVirtualFileSystem(active.skillPackage.files);
  const builtIns = new BuiltInThemeRepository(baseVfs);
  const customThemes = new CustomThemeRepository(
    new ObsidianCustomThemeStore(app.vault.adapter),
    builtIns.list().map(({ id }) => id)
  );
  const merged = await new MergedThemeRepository(
    active.skillPackage,
    builtIns,
    customThemes
  ).mount();
  const skillPackage = profilePackage(merged, profile);
  const vfs = new SkillVirtualFileSystem(skillPackage.files);
  const packageHash = await mountedPackageHash(active.packageHash, skillPackage);
  return {
    session: new SkillSession({
      client,
      target,
      capabilities,
      skillPackage,
      vfs,
      packageHash
    }),
    vfs,
    capabilities,
    customThemes
  };
}

export async function probeProductionVision(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal
): Promise<boolean> {
  const secretStore = new ObsidianSecretStore(app);
  if (!settings.secretId || !secretStore.get(settings.secretId)) return false;
  try {
    validateBaseUrl(settings.baseUrl);
  } catch {
    return false;
  }
  const client = OpenAiCompatibleClient.fromSettings(
    createObsidianTransport(),
    settings as GalleySettings,
    secretStore
  );
  return new VisionCapabilityProbe(client).probe(
    { baseUrl: settings.baseUrl, model: settings.model },
    signal
  );
}

export function importedSkillRepository(app: App): ImportedSkillRepository {
  return new ImportedSkillRepository(
    new ObsidianImportedSkillStore(
      app.vault.adapter,
      `${app.vault.configDir}/plugins/galley/skills`
    ),
    new SkillArchiveImporter()
  );
}

async function loadActiveSkill(
  app: App,
  settings: Readonly<GalleySettings>
): Promise<{ skillPackage: SkillPackage; packageHash: string }> {
  if (settings.activeSkillVersion === "bundled") {
    return {
      skillPackage: await new BundledSkillLoader().load(),
      packageHash: BUNDLED_SKILL.archiveSha256
    };
  }
  const imported = await importedSkillRepository(app).load(settings.activeSkillVersion);
  return { skillPackage: imported.skillPackage, packageHash: imported.packageHash };
}

function profilePackage(
  skillPackage: SkillPackage,
  profile: ProductionSkillProfile
): SkillPackage {
  if (profile === "wechat") return createWechatRepairSkillPackage(skillPackage);
  if (profile === "theme") {
    const files = new Map(skillPackage.files);
    files.set("assets/profiles/theme-generator.md", themeGeneratorProfile);
    return { ...skillPackage, files };
  }
  return skillPackage;
}

async function mountedPackageHash(
  baseHash: string,
  skillPackage: SkillPackage
): Promise<string> {
  const custom = [...skillPackage.files]
    .filter(([path]) => path === "references/theme-index.md" || /^references\/theme-[a-z0-9-]+\.md$/u.test(path))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => `${path.length}:${path}${content.length}:${content}`)
    .join("\n");
  const bytes = new TextEncoder().encode(`${baseHash}\n${custom}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
