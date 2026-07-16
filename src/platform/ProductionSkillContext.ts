import type { App } from "obsidian";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import themeGeneratorProfile from "../../assets/profiles/theme-generator.md?raw";
import { AiError } from "../ai/AiError";
import { validateBaseUrl } from "../ai/BaseUrlPolicy";
import type { ProviderCapabilities } from "../ai/CapabilityProbe";
import { OpenAiCompatibleClient } from "../ai/OpenAiCompatibleClient";
import { LocalCliChatClient } from "../ai/LocalCliChatClient";
import type { ChatClient } from "../ai/AiProtocol";
import type { GenerationModelEvent } from "../generation/GenerationProgress";
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
import { SkillPackageValidator } from "../skill/SkillPackageValidator";
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
  vision = false,
  onModelEvent?: (event: GenerationModelEvent) => void
): Promise<ProductionSkillContext> {
  const active = await loadActiveSkillPackage(app, settings);
  new SkillPackageValidator().validate(active.skillPackage);
  const baseVfs = new SkillVirtualFileSystem(active.skillPackage.files);
  const builtIns = new BuiltInThemeRepository(baseVfs);
  const customThemes = new CustomThemeRepository(
    new ObsidianCustomThemeStore(app.vault.adapter),
    builtIns.list().map(({ id }) => id),
    [...active.skillPackage.files.keys()]
  );
  const merged = await new MergedThemeRepository(
    active.skillPackage,
    builtIns,
    customThemes
  ).mount();
  const skillPackage = profilePackage(merged, profile);
  const vfs = new SkillVirtualFileSystem(skillPackage.files);
  const packageHash = await mountedPackageHash(active.packageHash, skillPackage);
  const skillRoot = settings.generationAgent === "plugin"
    ? undefined
    : await materializeLocalCliSkill(skillPackage, packageHash);
  const { client, target, capabilities } = await generationClient(
    app,
    settings,
    signal,
    vision,
    onModelEvent,
    skillRoot
  );
  return {
    session: new SkillSession({
      client,
      target,
      capabilities,
      skillPackage,
      vfs,
      packageHash,
      nativeSkillAccess: Boolean(skillRoot)
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
  if (settings.generationAgent !== "plugin") return false;
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

export function generationModelLabel(settings: Readonly<GalleySettings>): string {
  if (settings.generationAgent === "codex-cli") return "Codex CLI";
  if (settings.generationAgent === "claude-cli") return "Claude Code CLI";
  return settings.model;
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

export async function loadActiveSkillPackage(
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

async function generationClient(
  app: App,
  settings: Readonly<GalleySettings>,
  signal: AbortSignal,
  vision: boolean,
  onModelEvent?: (event: GenerationModelEvent) => void,
  skillRoot?: string
): Promise<{
  client: ChatClient;
  target: { baseUrl: string; model: string };
  capabilities: ProviderCapabilities;
}> {
  if (settings.generationAgent !== "plugin") {
    const agent = settings.generationAgent;
    const executable = agent === "codex-cli"
      ? settings.codexCliPath
      : settings.claudeCliPath;
    return {
      client: new LocalCliChatClient({
        agent,
        executable,
        cwd: vaultWorkingDirectory(app),
        ...(skillRoot ? { skillPath: join(skillRoot, "SKILL.md") } : {}),
        timeoutMs: settings.timeoutMs,
        ...(onModelEvent ? { onModelEvent } : {})
      }),
      target: {
        baseUrl: `local://${agent}`,
        model: generationModelLabel(settings)
      },
      capabilities: {
        tools: false,
        streaming: false,
        vision: false,
        checkedAt: new Date().toISOString()
      }
    };
  }

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
    secretStore,
    onModelEvent ? { onModelEvent } : {}
  );
  const target = { baseUrl: settings.baseUrl, model: settings.model };
  const capabilities: ProviderCapabilities = {
    tools: true,
    streaming: false,
    vision: false,
    checkedAt: new Date().toISOString()
  };
  if (vision) {
    capabilities.vision = await new VisionCapabilityProbe(client).probe(target, signal);
  }
  return { client, target, capabilities };
}

async function materializeLocalCliSkill(
  skillPackage: SkillPackage,
  packageHash: string
): Promise<string> {
  const root = join(tmpdir(), "galley-skills", packageHash);
  await Promise.all([...skillPackage.files].map(async ([path, content]) => {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, { encoding: "utf8", mode: 0o600 });
  }));
  return root;
}

function vaultWorkingDirectory(app: App): string {
  const adapter = app.vault.adapter as typeof app.vault.adapter & {
    getBasePath?: () => string;
  };
  return adapter.getBasePath?.() ?? process.cwd();
}
