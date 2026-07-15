import { describe, expect, it } from "vitest";

import type { ChatTurnResult } from "../../src/ai/AiProtocol";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import { makeProviderCapabilities, TEST_PACKAGE_HASH } from "../support/phase1Factories";

const REQUIRED = [
  "SKILL.md",
  "references/theme-index.md",
  "references/theme-generator.md",
  "references/common-components.md",
  "assets/profiles/theme-generator.md"
] as const;
const completed = (content: string): ChatTurnResult => ({
  content,
  toolCalls: [],
  finishReason: "stop"
});

function session(
  client: ScriptedChatClient,
  tools: boolean
): SkillSession {
  const files = new Map(REQUIRED.map((path) => [path, `recorded:${path}`]));
  const skillPackage = { id: "gzh-design", version: "recorded", files };
  return new SkillSession({
    client,
    target: { baseUrl: "https://recorded.invalid/v1", model: "recorded" },
    capabilities: makeProviderCapabilities({ tools }),
    skillPackage,
    vfs: new SkillVirtualFileSystem(files),
    packageHash: TEST_PACKAGE_HASH
  });
}

describe("recorded Skill loading acceptance", () => {
  it("records tool-first reads of every required Theme Lab file", async () => {
    const client = new ScriptedChatClient([
      {
        content: "",
        toolCalls: REQUIRED.map((path, index) => ({
          id: `recorded-${index}`,
          name: "read_skill_file",
          argumentsJson: JSON.stringify({ path })
        })),
        finishReason: "tool_calls"
      },
      completed("loaded")
    ]);
    const active = session(client, true);
    await active.ensureFiles(REQUIRED, new AbortController().signal);
    expect(active.audit()).toMatchObject({ loadMode: "tool-calls", files: REQUIRED });
  });

  it("records byte-complete injection fallback of every required file", async () => {
    const client = new ScriptedChatClient([completed("generated")]);
    const active = session(client, false);
    await active.ensureFiles(REQUIRED, new AbortController().signal);
    await active.completeScoped("generate", new AbortController().signal);
    for (const path of REQUIRED) {
      expect(client.messagesText()).toContain(
        `<skill-file path="${path}">\nrecorded:${path}\n</skill-file>`
      );
    }
    expect(active.audit()).toMatchObject({ loadMode: "injected", files: REQUIRED });
  });
});
