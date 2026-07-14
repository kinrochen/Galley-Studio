import { describe, expect, it } from "vitest";

import { AiError } from "../../src/ai/AiError";
import type { ChatTurnResult } from "../../src/ai/AiProtocol";
import {
  READ_SKILL_FILE_TOOL,
  SkillSession
} from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import {
  makeProviderCapabilities,
  makeSession,
  makeSkillPackage,
  TEST_PACKAGE_HASH
} from "../support/phase1Factories";

const signal = (): AbortSignal => new AbortController().signal;

const completed = (
  overrides: Partial<ChatTurnResult> = {}
): ChatTurnResult => ({
  content: "",
  toolCalls: [],
  finishReason: "stop",
  ...overrides
});

const read = (id: string, path: string): ChatTurnResult =>
  completed({
    toolCalls: [
      {
        id,
        name: "read_skill_file",
        argumentsJson: JSON.stringify({ path })
      }
    ],
    finishReason: "tool_calls"
  });

it("records files actually loaded through read_skill_file", async () => {
  const client = new ScriptedChatClient([
    read("1", "SKILL.md"),
    read("2", "references/theme-index.md"),
    completed({ content: "loaded" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());

  expect(session.audit()).toEqual({
    skillId: "gzh-design",
    skillVersion: "test-skill-version",
    packageHash: TEST_PACKAGE_HASH,
    loadMode: "tool-calls",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.remainingSteps()).toBe(0);
  expect(client.requestsWithTools()).toHaveLength(3);
  expect(client.requestsWithTools()[0]?.tools).toEqual([
    READ_SKILL_FILE_TOOL
  ]);
  expect(client.requests.at(-1)?.messages).toEqual(
    expect.arrayContaining([
      {
        role: "tool",
        toolCallId: "1",
        content: "Complete workflow instructions."
      },
      {
        role: "tool",
        toolCallId: "2",
        content: "Complete theme index."
      }
    ])
  );
});

it("injects every still-required file in full after two ignored tool rounds", async () => {
  const client = new ScriptedChatClient([
    completed({ content: "continue" }),
    completed({ content: "continue" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    loadMode: "injected",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.requestsWithTools()).toHaveLength(2);
  expect(client.messagesText()).toContain(
    '<skill-file path="SKILL.md">\nComplete workflow instructions.\n</skill-file>'
  );
  expect(client.messagesText()).toContain(
    '<skill-file path="references/theme-index.md">\nComplete theme index.\n</skill-file>'
  );
});

it("injects immediately without a request when the endpoint has no tool capability", async () => {
  const client = new ScriptedChatClient([]);
  const session = makeSession(client, { tools: false });

  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    loadMode: "injected",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.requests).toHaveLength(0);
  expect(client.requestsWithTools()).toHaveLength(0);
});

it("downgrades only its capability and retries once through full injection", async () => {
  const callerCapabilities = makeProviderCapabilities();
  const client = new ScriptedChatClient([
    new AiError("tools_unsupported"),
    completed({ content: "accepted injected Skill" })
  ]);
  const skillPackage = makeSkillPackage();
  const session = new SkillSession({
    client,
    target: { baseUrl: "https://api.example/v1", model: "test-model" },
    capabilities: callerCapabilities,
    skillPackage,
    vfs: new SkillVirtualFileSystem(skillPackage.files),
    packageHash: TEST_PACKAGE_HASH
  });

  await session.bootstrap(signal());

  expect(callerCapabilities.tools).toBe(true);
  expect(session.audit().loadMode).toBe("injected");
  expect(client.requests).toHaveLength(2);
  expect(client.requests[0]?.tools).toEqual([READ_SKILL_FILE_TOOL]);
  expect(client.requests[1]?.tools).toBeUndefined();
  expect(client.requests[1]?.messages.map((message) => message.content)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('<skill-file path="SKILL.md">'),
      expect.stringContaining(
        '<skill-file path="references/theme-index.md">'
      )
    ])
  );
});

it("records mixed mode when only some required files are read before fallback", async () => {
  const client = new ScriptedChatClient([
    read("1", "SKILL.md"),
    completed({ content: "ignored once" }),
    completed({ content: "ignored twice" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    loadMode: "mixed",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.messagesText()).toContain(
    '<skill-file path="references/theme-index.md">\nComplete theme index.\n</skill-file>'
  );
});

describe("tool-call validation", () => {
  it("rejects unknown tools with a normalized secret-free error", async () => {
    const client = new ScriptedChatClient([
      completed({
        toolCalls: [
          { id: "bad", name: "run_skill_script", argumentsJson: "{}" }
        ],
        finishReason: "tool_calls"
      })
    ]);

    await expect(makeSession(client).bootstrap(signal())).rejects.toEqual(
      expect.objectContaining({ code: "invalid_response", diagnostic: null })
    );
  });

  it.each([
    "{",
    "null",
    "[]",
    "{}",
    '{"path":1}',
    '{"path":"SKILL.md","extra":true}'
  ])("rejects malformed read arguments %j", async (argumentsJson) => {
    const client = new ScriptedChatClient([
      completed({
        toolCalls: [
          { id: "bad", name: "read_skill_file", argumentsJson }
        ],
        finishReason: "tool_calls"
      })
    ]);

    await expect(makeSession(client).bootstrap(signal())).rejects.toMatchObject({
      code: "invalid_response",
      diagnostic: null
    });
  });

  it.each([
    "./SKILL.md",
    "references\\theme-index.md",
    "../secret",
    "/etc/passwd",
    "https://example.com/secret",
    "references/not-registered.md"
  ])("rejects non-canonical or unregistered tool path %j", async (path) => {
    const client = new ScriptedChatClient([read("bad", path)]);

    await expect(makeSession(client).bootstrap(signal())).rejects.toMatchObject({
      code: "invalid_response",
      diagnostic: null
    });
    expect(client.messagesText()).not.toContain("must never execute");
  });

  it("validates a whole tool-call batch before exposing any file", async () => {
    const client = new ScriptedChatClient([
      completed({
        toolCalls: [
          {
            id: "valid",
            name: "read_skill_file",
            argumentsJson: '{"path":"SKILL.md"}'
          },
          {
            id: "invalid",
            name: "read_skill_file",
            argumentsJson: '{"path":"../secret"}'
          }
        ],
        finishReason: "tool_calls"
      })
    ]);
    const session = makeSession(client);

    await expect(session.bootstrap(signal())).rejects.toMatchObject({
      code: "invalid_response"
    });
    expect(session.audit().files).toEqual([]);
  });

  it("rejects duplicate or empty tool-call ids", async () => {
    const client = new ScriptedChatClient([
      completed({
        toolCalls: [
          {
            id: "same",
            name: "read_skill_file",
            argumentsJson: '{"path":"SKILL.md"}'
          },
          {
            id: "same",
            name: "read_skill_file",
            argumentsJson: '{"path":"references/theme-index.md"}'
          }
        ],
        finishReason: "tool_calls"
      })
    ]);

    await expect(makeSession(client).bootstrap(signal())).rejects.toMatchObject({
      code: "invalid_response"
    });
  });
});

it.each(["./SKILL.md", "../secret", "references/not-registered.md"])(
  "rejects invalid required path %j before making a request",
  async (path) => {
    const client = new ScriptedChatClient([]);

    await expect(
      makeSession(client).ensureFiles([path], signal())
    ).rejects.toMatchObject({ code: "invalid_response", diagnostic: null });
    expect(client.requests).toHaveLength(0);
  }
);

it("returns final content only after bootstrap requirements and tool results", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    completed({ content: "bootstrap complete" }),
    read("components", "references/common-components.md"),
    completed({ content: "components loaded" }),
    completed({ content: "final answer" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await session.ensureFiles(["references/common-components.md"], signal());
  await expect(session.complete("format this article", signal())).resolves.toBe(
    "final answer"
  );

  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md",
    "references/common-components.md"
  ]);
  expect(client.requests.at(-1)?.messages).toEqual(
    expect.arrayContaining([
      { role: "user", content: "format this article" },
      {
        role: "tool",
        toolCallId: "components",
        content: "Complete common components."
      }
    ])
  );
});

it("loads bootstrap requirements before accepting complete() content", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    completed({ content: "bootstrap complete" }),
    completed({ content: "final answer" })
  ]);
  const session = makeSession(client);

  await expect(session.complete("format this article", signal())).resolves.toBe(
    "final answer"
  );
  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md"
  ]);
});

it("throws tool_round_limit before processing a ninth complete() tool round", async () => {
  const completionToolRounds = Array.from({ length: 9 }, (_, index) =>
    read(`repeat-${index + 1}`, "SKILL.md")
  );
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    completed({ content: "bootstrap complete" }),
    ...completionToolRounds
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await expect(session.complete("loop", signal())).rejects.toEqual(
    expect.objectContaining({ code: "tool_round_limit" })
  );
  expect(client.requests).toHaveLength(12);
});

it("injects full required files and retries complete() without tools after downgrade", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    completed({ content: "bootstrap complete" }),
    new AiError("tools_unsupported"),
    completed({ content: "fallback answer" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await expect(session.complete("prompt-secret", signal())).resolves.toBe(
    "fallback answer"
  );

  expect(session.audit()).toMatchObject({
    loadMode: "mixed",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.requests.at(-1)?.tools).toBeUndefined();
  expect(client.requests.at(-1)?.messages.map((message) => message.content)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('<skill-file path="SKILL.md">'),
      expect.stringContaining(
        '<skill-file path="references/theme-index.md">'
      )
    ])
  );
});

it("keeps audit evidence deterministic, immutable, and free of prompts or content", async () => {
  const client = new ScriptedChatClient([]);
  const session = makeSession(client, { tools: false }, {
    files: new Map([
      ["SKILL.md", "super-secret-file-content"],
      ["references/theme-index.md", "private-theme-content"]
    ])
  });

  await session.bootstrap(signal());
  const first = session.audit();
  first.files.push("mutated.md");
  const second = session.audit();

  expect(second).toEqual({
    skillId: "gzh-design",
    skillVersion: "test-skill-version",
    packageHash: TEST_PACKAGE_HASH,
    loadMode: "injected",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  const auditJson = JSON.stringify(second);
  expect(auditJson).not.toContain("super-secret");
  expect(auditJson).not.toContain("private-theme-content");
  expect(auditJson).not.toContain("messages");
  expect(Object.keys(second)).toEqual([
    "skillId",
    "skillVersion",
    "packageHash",
    "loadMode",
    "files"
  ]);
});

it("snapshots package identity so caller mutation cannot rewrite audit evidence", async () => {
  const client = new ScriptedChatClient([]);
  const skillPackage = makeSkillPackage();
  const session = new SkillSession({
    client,
    target: { baseUrl: "https://api.example/v1", model: "test-model" },
    capabilities: makeProviderCapabilities({ tools: false }),
    skillPackage,
    vfs: new SkillVirtualFileSystem(skillPackage.files),
    packageHash: TEST_PACKAGE_HASH
  });

  skillPackage.id = "spoofed-after-construction";
  skillPackage.version = "spoofed-version";
  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    skillId: "gzh-design",
    skillVersion: "test-skill-version",
    packageHash: TEST_PACKAGE_HASH
  });
});

it("returns Skill script files as inert text when the model reads them", async () => {
  const client = new ScriptedChatClient([
    read("script", "scripts/component_lint.py"),
    completed({ content: "read as text" })
  ]);
  const session = makeSession(client);

  await session.ensureFiles(["scripts/component_lint.py"], signal());

  expect(client.requests.at(-1)?.messages).toContainEqual({
    role: "tool",
    toolCallId: "script",
    content: "raise RuntimeError('must never execute')"
  });
  expect(session.audit().files).toEqual(["scripts/component_lint.py"]);
});
