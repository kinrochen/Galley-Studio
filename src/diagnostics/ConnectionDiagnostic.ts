import { AiError } from "../ai/AiError";
import type { HttpTransport } from "../ai/AiProtocol";
import { validateBaseUrl } from "../ai/BaseUrlPolicy";
import { OpenAiCompatibleClient } from "../ai/OpenAiCompatibleClient";
import type { SecretStore } from "../secrets/SecretStore";
import {
  type GalleySettings,
  normalizeSettings
} from "../settings/GalleySettings";

export interface ConnectionDiagnosticResult {
  ok: boolean;
  model: string;
  errorCode?: string;
}

export interface ConnectionDiagnosticDeps {
  settings: Readonly<GalleySettings>;
  secretStore: SecretStore;
  transport: HttpTransport;
}

export async function runConnectionDiagnostic(
  deps: ConnectionDiagnosticDeps,
  signal: AbortSignal
): Promise<ConnectionDiagnosticResult> {
  const settings = normalizeSettings(deps.settings);
  const model = settings.model;

  try {
    if (signal.aborted) {
      throw new AiError("aborted");
    }
    if (!model.trim()) {
      return failureResult(model, "missing_model");
    }
    try {
      validateBaseUrl(settings.baseUrl);
    } catch {
      return failureResult(model, "invalid_base_url");
    }

    let hasSecret = false;
    try {
      hasSecret = Boolean(deps.secretStore.get(settings.secretId));
    } catch {
      return failureResult(model, "missing_secret");
    }
    if (!hasSecret) {
      return failureResult(model, "missing_secret");
    }

    const client = OpenAiCompatibleClient.fromSettings(
      deps.transport,
      settings,
      deps.secretStore
    );
    const response = await client.complete({
      baseUrl: settings.baseUrl,
      model,
      messages: [{ role: "user", content: "Reply with exactly OK." }]
    }, signal);
    if (!response.content.trim()) throw new AiError("invalid_response");

    return {
      ok: true,
      model
    };
  } catch (error) {
    return failureResult(model, errorCode(error));
  }
}

function failureResult(
  model: string,
  errorCode: string
): ConnectionDiagnosticResult {
  return {
    ok: false,
    model,
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
