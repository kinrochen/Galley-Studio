import type { App } from "obsidian";

import { WechatRepairService } from "../export/WechatRepairService";
import { GenerationPipeline } from "../generation/GenerationPipeline";
import type { GalleySettings } from "../settings/GalleySettings";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import { createProductionSkillContext } from "./ProductionSkillContext";

export async function createProductionGeneration(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal
): Promise<{ model: string; pipeline: GenerationPipeline }> {
  const { session, vfs } = await createProductionSkillContext(
    app,
    settings,
    signal,
    "generation"
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
    (await createProductionSkillContext(app, settings, signal, "wechat")).session
  );
}
