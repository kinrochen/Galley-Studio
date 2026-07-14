import { AiError } from "../ai/AiError";
import type { ChatClient, HttpTransport } from "../ai/AiProtocol";
import { validateBaseUrl } from "../ai/BaseUrlPolicy";
import {
  CapabilityProbe,
  type ProviderCapabilities
} from "../ai/CapabilityProbe";
import { OpenAiCompatibleClient } from "../ai/OpenAiCompatibleClient";
import { BUNDLED_SKILL } from "../generated/bundledSkill";
import type { SecretStore } from "../secrets/SecretStore";
import type { GalleySettings } from "../settings/GalleySettings";
import {
  BundledSkillLoader,
  PINNED_GZH_DESIGN_VERSION
} from "../skill/BundledSkillLoader";
import type { SkillLoadMode } from "../skill/SkillAudit";
import { SkillSession } from "../skill/SkillSession";
import { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";

export interface ConnectionDiagnosticResult {
  ok: boolean;
  model: string;
  capabilities: { tools: boolean; streaming: boolean; vision: boolean };
  skillVersion: string;
  skillLoadMode: "tool-calls" | "injected" | "mixed";
  skillFiles: string[];
  errorCode?: string;
}

export interface ConnectionDiagnosticDeps {
  settings: Readonly<GalleySettings>;
  secretStore: SecretStore;
  transport: HttpTransport;
}

const EMPTY_CAPABILITIES = {
  tools: false,
  streaming: false,
  vision: false
} as const;

export async function runConnectionDiagnostic(
  deps: ConnectionDiagnosticDeps,
  signal: AbortSignal
): Promise<ConnectionDiagnosticResult> {
  const model = deps.settings.model;
  let capabilities: ConnectionDiagnosticResult["capabilities"] = {
    ...EMPTY_CAPABILITIES
  };

  try {
    if (signal.aborted) {
      throw new AiError("aborted");
    }
    if (!model.trim()) {
      return failureResult(model, "missing_model", capabilities);
    }
    try {
      validateBaseUrl(deps.settings.baseUrl);
    } catch {
      return failureResult(model, "invalid_base_url", capabilities);
    }

    let hasSecret = false;
    try {
      hasSecret = Boolean(deps.secretStore.get(deps.settings.secretId));
    } catch {
      return failureResult(model, "missing_secret", capabilities);
    }
    if (!hasSecret) {
      return failureResult(model, "missing_secret", capabilities);
    }

    const providerClient = OpenAiCompatibleClient.fromSettings(
      deps.transport,
      deps.settings,
      deps.secretStore
    );
    let connected = false;
    let connectionErrorCode = "diagnostic_failed";
    const client: ChatClient = {
      complete: async (request, requestSignal) => {
        try {
          const result = await providerClient.complete(request, requestSignal);
          connected = true;
          return result;
        } catch (error) {
          connectionErrorCode = errorCode(error);
          throw error;
        }
      }
    };
    const observed = await new CapabilityProbe(client).probe(
      { baseUrl: deps.settings.baseUrl, model },
      signal,
      { streaming: true, vision: true }
    );
    capabilities = selectCapabilities(observed);
    if (!connected) {
      return failureResult(model, connectionErrorCode, capabilities);
    }

    const skillPackage = await new BundledSkillLoader().load();
    const session = new SkillSession({
      client,
      target: { baseUrl: deps.settings.baseUrl, model },
      capabilities: observed,
      skillPackage,
      vfs: new SkillVirtualFileSystem(skillPackage.files),
      packageHash: BUNDLED_SKILL.archiveSha256
    });
    await session.bootstrap(signal);
    const audit = session.audit();

    return {
      ok: true,
      model,
      capabilities,
      skillVersion: audit.skillVersion,
      skillLoadMode: audit.loadMode,
      skillFiles: audit.files
    };
  } catch (error) {
    return failureResult(model, errorCode(error), capabilities);
  }
}

function selectCapabilities(
  capabilities: ProviderCapabilities
): ConnectionDiagnosticResult["capabilities"] {
  return {
    tools: capabilities.tools,
    streaming: capabilities.streaming,
    vision: capabilities.vision
  };
}

function failureResult(
  model: string,
  errorCode: string,
  capabilities: ConnectionDiagnosticResult["capabilities"],
  skillLoadMode: SkillLoadMode = "tool-calls"
): ConnectionDiagnosticResult {
  return {
    ok: false,
    model,
    capabilities: { ...capabilities },
    skillVersion: PINNED_GZH_DESIGN_VERSION,
    skillLoadMode,
    skillFiles: [],
    errorCode
  };
}

function errorCode(error: unknown): string {
  if (error instanceof AiError) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  ) {
    return "aborted";
  }
  return "diagnostic_failed";
}
