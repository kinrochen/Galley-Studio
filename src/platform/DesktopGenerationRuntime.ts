import type { App } from "obsidian";

import { AiError } from "../ai/AiError";
import { validateBaseUrl } from "../ai/BaseUrlPolicy";
import { CapabilityProbe } from "../ai/CapabilityProbe";
import { OpenAiCompatibleClient } from "../ai/OpenAiCompatibleClient";
import { createObsidianTransport } from "../diagnostics/ObsidianTransport";
import { WechatRepairService } from "../export/WechatRepairService";
import { createWechatRepairSkillPackage } from "../export/WechatRepairSkillPackage";
import { BUNDLED_SKILL } from "../generated/bundledSkill";
import { GenerationPipeline } from "../generation/GenerationPipeline";
import { ObsidianSecretStore } from "../secrets/SecretStore";
import type { GalleySettings } from "../settings/GalleySettings";
import { BundledSkillLoader } from "../skill/BundledSkillLoader";
import { SkillSession } from "../skill/SkillSession";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";

export async function createProductionGeneration(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal
): Promise<{ model: string; pipeline: GenerationPipeline }> {
  const { session, vfs } = await createProductionSkillSession(
    app,
    settings,
    signal,
    false
  );
  return {
    model: settings.model,
    pipeline: new GenerationPipeline({
      session,
      themes: new BuiltInThemeRepository(vfs)
    })
  };
}

export function createProductionWechatRepairer(
  app: App,
  settings: Readonly<GalleySettings>
): WechatRepairService {
  return new WechatRepairService(async (signal) =>
    (await createProductionSkillSession(app, settings, signal, true)).session
  );
}

async function createProductionSkillSession(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal,
  includeWechatProfile: boolean
): Promise<{ session: SkillSession; vfs: SkillVirtualFileSystem }> {
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
    settings,
    secretStore
  );
  const target = { baseUrl: settings.baseUrl, model: settings.model };
  const capabilities = await new CapabilityProbe(client).probe(target, signal);
  const bundled = await new BundledSkillLoader().load();
  const skillPackage = includeWechatProfile
    ? createWechatRepairSkillPackage(bundled)
    : bundled;
  const vfs = new SkillVirtualFileSystem(skillPackage.files);
  return {
    session: new SkillSession({
      client,
      target,
      capabilities,
      skillPackage,
      vfs,
      packageHash: BUNDLED_SKILL.archiveSha256
    }),
    vfs
  };
}
