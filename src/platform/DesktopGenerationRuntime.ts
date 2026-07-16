import type { App } from "obsidian";

import { WechatRepairService } from "../export/WechatRepairService";
import { SkillDrivenGenerationPipeline } from "../generation/SkillDrivenGenerationPipeline";
import type { GalleySettings } from "../settings/GalleySettings";
import type { GenerationModelEvent } from "../generation/GenerationProgress";
import { BuiltInThemeRepository } from "../themes/BuiltInThemeRepository";
import {
  createProductionSkillContext,
  generationModelLabel
} from "./ProductionSkillContext";

export async function createProductionGeneration(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal,
  onModelEvent?: (event: GenerationModelEvent) => void
): Promise<{ model: string; pipeline: SkillDrivenGenerationPipeline }> {
  const { session, vfs } = await createProductionSkillContext(
    app,
    settings,
    signal,
    "generation",
    false,
    onModelEvent
  );
  return {
    model: generationModelLabel(settings),
    pipeline: new SkillDrivenGenerationPipeline({
      session,
      themes: new BuiltInThemeRepository(vfs),
      ...(onModelEvent ? { onModelEvent } : {})
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
