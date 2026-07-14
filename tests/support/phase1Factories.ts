import type { ChatClient, HttpTransport } from "../../src/ai/AiProtocol";
import type { ProviderCapabilities } from "../../src/ai/CapabilityProbe";
import type { ConnectionDiagnosticDeps } from "../../src/diagnostics/ConnectionDiagnostic";
import { MemorySecretStore } from "../../src/secrets/SecretStore";
import { normalizeSettings } from "../../src/settings/GalleySettings";
import type { SkillPackage } from "../../src/skill/SkillPackage";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";

export const TEST_PACKAGE_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

export const TEST_SKILL_FILES = new Map<string, string>([
  ["SKILL.md", "Complete workflow instructions."],
  ["references/theme-index.md", "Complete theme index."],
  ["references/common-components.md", "Complete common components."],
  ["scripts/component_lint.py", "raise RuntimeError('must never execute')"]
]);

export function makeProviderCapabilities(
  overrides: Partial<ProviderCapabilities> = {}
): ProviderCapabilities {
  return {
    tools: true,
    streaming: false,
    vision: false,
    checkedAt: "2026-07-14T00:00:00.000Z",
    ...overrides
  };
}

export function makeSkillPackage(
  overrides: Partial<SkillPackage> = {}
): SkillPackage {
  return {
    id: "gzh-design",
    version: "test-skill-version",
    files: TEST_SKILL_FILES,
    ...overrides
  };
}

export function makeSession(
  client: ChatClient,
  capabilityOverrides: Partial<ProviderCapabilities> = {},
  packageOverrides: Partial<SkillPackage> = {}
): SkillSession {
  const skillPackage = makeSkillPackage(packageOverrides);
  return new SkillSession({
    client,
    target: {
      baseUrl: "https://api.example/v1",
      model: "test-model"
    },
    capabilities: makeProviderCapabilities(capabilityOverrides),
    skillPackage,
    vfs: new SkillVirtualFileSystem(skillPackage.files),
    packageHash: TEST_PACKAGE_HASH
  });
}

export function makeDiagnosticDeps(
  overrides: Partial<ConnectionDiagnosticDeps> = {}
): ConnectionDiagnosticDeps {
  const responses = [
    openAiToolCall("capability", "galley_capability_echo", "{}"),
    openAiContent("galley_stream_probe"),
    openAiToolCall(
      "skill-root",
      "read_skill_file",
      JSON.stringify({ path: "SKILL.md" })
    ),
    openAiToolCall(
      "skill-themes",
      "read_skill_file",
      JSON.stringify({ path: "references/theme-index.md" })
    ),
    openAiContent("Skill loaded")
  ];
  const transport: HttpTransport = {
    post: async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected diagnostic request");
      }
      return response;
    }
  };

  return {
    settings: normalizeSettings({
      baseUrl: "https://api.example/v1",
      model: "diagnostic-model",
      secretId: "provider-key"
    }),
    secretStore: new MemorySecretStore(
      new Map([["provider-key", "super-secret"]])
    ),
    transport,
    ...overrides
  };
}

function openAiContent(content: string): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      choices: [
        {
          message: { role: "assistant", content },
          finish_reason: "stop"
        }
      ]
    }
  };
}

function openAiToolCall(
  id: string,
  name: string,
  argumentsJson: string
): { status: number; json: unknown } {
  return {
    status: 200,
    json: {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id,
                type: "function",
                function: { name, arguments: argumentsJson }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    }
  };
}
