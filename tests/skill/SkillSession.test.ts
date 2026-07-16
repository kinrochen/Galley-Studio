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
    read("2", "references/theme-index.md")
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
  expect(client.requestsWithTools()).toHaveLength(2);
  expect(client.requestsWithTools()[0]?.tools).toEqual([
    READ_SKILL_FILE_TOOL
  ]);
  expect(client.requests.at(-1)?.messages).toEqual(
    expect.arrayContaining([
      {
        role: "tool",
        toolCallId: "1",
        content: "Complete workflow instructions."
      }
    ])
  );
});

it("records each provider request as an immutable transition snapshot", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    completed({ content: "loaded" })
  ]);

  await makeSession(client).bootstrap(signal());

  expect(client.requests[0]?.messages).toEqual([
    {
      role: "system",
      content:
        'Before replying, call read_skill_file once for every missing required Skill path: ["SKILL.md","references/theme-index.md"]'
    }
  ]);
  expect(client.requests[1]?.messages).toContainEqual({
    role: "tool",
    toolCallId: "root",
    content: "Complete workflow instructions."
  });
  expect(client.requests[1]?.messages).not.toContainEqual(
    expect.objectContaining({ toolCallId: "themes" })
  );
});

it("injects every still-required file in full after two ignored tool rounds", async () => {
  const client = new ScriptedChatClient([
    completed({ content: "continue" }),
    completed({ content: "continue" }),
    completed({ content: "final after injection" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    loadMode: "injected",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.requestsWithTools()).toHaveLength(2);
  await expect(session.complete("continue", signal())).resolves.toBe(
    "final after injection"
  );
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

it("lets a native local Agent read the materialized Skill without duplicating it in messages", async () => {
  const client = new ScriptedChatClient([completed({ content: "<section>done</section>" })]);
  const skillPackage = makeSkillPackage();
  const session = new SkillSession({
    client,
    target: { baseUrl: "local://codex-cli", model: "Codex CLI" },
    capabilities: makeProviderCapabilities({ tools: false }),
    skillPackage,
    vfs: new SkillVirtualFileSystem(skillPackage.files),
    packageHash: TEST_PACKAGE_HASH,
    nativeSkillAccess: true
  });

  await expect(session.completeScoped("format this article", signal())).resolves.toBe(
    "<section>done</section>"
  );

  expect(session.audit()).toMatchObject({
    loadMode: "filesystem",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  expect(client.requests).toHaveLength(1);
  expect(client.requests[0]?.messages).toEqual([
    { role: "user", content: "format this article" }
  ]);
  expect(client.messagesText()).not.toContain("<skill-file");
});

it("downgrades only its capability and injects without an empty retry request", async () => {
  const callerCapabilities = makeProviderCapabilities();
  const client = new ScriptedChatClient([new AiError("tools_unsupported")]);
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
  expect(client.requests).toHaveLength(1);
  expect(client.requests[0]?.tools).toEqual([READ_SKILL_FILE_TOOL]);
  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md"
  ]);
});

it("records mixed mode when only some required files are read before fallback", async () => {
  const client = new ScriptedChatClient([
    read("1", "SKILL.md"),
    completed({ content: "ignored once" }),
    completed({ content: "ignored twice" }),
    completed({ content: "final after mixed loading" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());

  expect(session.audit()).toMatchObject({
    loadMode: "mixed",
    files: ["SKILL.md", "references/theme-index.md"]
  });
  await expect(session.complete("continue", signal())).resolves.toBe(
    "final after mixed loading"
  );
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

  it("rejects a cross-round duplicate atomically without reserving new batch ids", async () => {
    const client = new ScriptedChatClient([
      read("seen", "SKILL.md"),
      completed({
        toolCalls: [
          {
            id: "new",
            name: "read_skill_file",
            argumentsJson: '{"path":"references/theme-index.md"}'
          },
          {
            id: "seen",
            name: "read_skill_file",
            argumentsJson: '{"path":"references/common-components.md"}'
          }
        ],
        finishReason: "tool_calls"
      }),
      read("new", "references/theme-index.md"),
      completed({ content: "recovered" })
    ]);
    const session = makeSession(client);

    await expect(session.bootstrap(signal())).rejects.toMatchObject({
      code: "invalid_response"
    });
    expect(session.audit().files).toEqual(["SKILL.md"]);

    await session.ensureFiles(["references/theme-index.md"], signal());
    expect(session.audit().files).toEqual([
      "SKILL.md",
      "references/theme-index.md"
    ]);
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
    read("components", "references/common-components.md"),
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

it("reloads an accumulated requirement after an earlier ensureFiles failure", async () => {
  const customPath = "references/common-components.md";
  const client = new ScriptedChatClient([
    new AiError("aborted"),
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    (request) => {
      const lastMessage = request.messages.at(-1);
      return lastMessage?.role === "system" &&
        lastMessage.content.includes(customPath)
        ? read("recovered-custom", customPath)
        : completed({ content: "final answer" });
    },
    completed({ content: "final answer" })
  ]);
  const session = makeSession(client);

  await expect(
    session.ensureFiles([customPath], signal())
  ).rejects.toMatchObject({ code: "aborted" });
  await expect(session.complete("format this article", signal())).resolves.toBe(
    "final answer"
  );

  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md",
    customPath
  ]);
  expect(client.requests.at(-1)?.messages).toContainEqual({
    role: "tool",
    toolCallId: "recovered-custom",
    content: "Complete common components."
  });
  expect(client.remainingSteps()).toBe(0);
});

it("rejects a tool-free terminal that claims an empty tool-call turn", async () => {
  const client = new ScriptedChatClient([
    completed({
      content: "must not be accepted",
      finishReason: "tool_calls"
    })
  ]);
  const session = makeSession(client, { tools: false });

  await expect(session.complete("format", signal())).rejects.toMatchObject({
    code: "invalid_response"
  });
});

it("throws tool_round_limit before processing a ninth complete() tool round", async () => {
  const completionToolRounds = Array.from({ length: 8 }, (_, index) =>
    read(`repeat-${index + 1}`, "SKILL.md")
  );
  const ninth = read("repeat-9", "scripts/component_lint.py");
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    ...completionToolRounds,
    ninth
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await expect(session.complete("loop", signal())).rejects.toEqual(
    expect.objectContaining({ code: "tool_round_limit" })
  );
  expect(client.requests).toHaveLength(11);
  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md"
  ]);
  expect(
    client.requests.flatMap((request) => request.messages)
  ).not.toContainEqual(
    expect.objectContaining({ role: "tool", toolCallId: "repeat-9" })
  );
  expect(client.messagesText()).not.toContain("must never execute");
});

it("injects full required files and retries complete() without tools after downgrade", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
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

it("rejects an empty tool-call terminal returned by a downgrade retry", async () => {
  const client = new ScriptedChatClient([
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    new AiError("tools_unsupported"),
    completed({
      content: "must not be accepted",
      finishReason: "tool_calls"
    })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await expect(session.complete("format", signal())).rejects.toMatchObject({
    code: "invalid_response"
  });
  expect(client.requests.at(-1)?.tools).toBeUndefined();
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
    read("root", "SKILL.md"),
    read("themes", "references/theme-index.md"),
    read("script", "scripts/component_lint.py"),
    completed({ content: "read as text" })
  ]);
  const session = makeSession(client);

  await session.bootstrap(signal());
  await session.ensureFiles(["scripts/component_lint.py"], signal());
  await expect(session.complete("continue", signal())).resolves.toBe(
    "read as text"
  );

  expect(client.requests.at(-1)?.messages).toContainEqual({
    role: "tool",
    toolCallId: "script",
    content: "raise RuntimeError('must never execute')"
  });
  expect(session.audit().files).toEqual([
    "SKILL.md",
    "references/theme-index.md",
    "scripts/component_lint.py"
  ]);
});

describe("completeScoped", () => {
  it("reuses an injected Skill baseline without accumulating scoped turns", async () => {
    const client = new ScriptedChatClient([
      completed({ content: "FIRST_OUTPUT_SENTINEL" }),
      completed({ content: "SECOND_OUTPUT" })
    ]);
    const session = makeSession(client, { tools: false });

    await expect(
      session.completeScoped("FIRST_PROMPT_SENTINEL", signal())
    ).resolves.toBe("FIRST_OUTPUT_SENTINEL");
    await expect(
      session.completeScoped("SECOND_PROMPT", signal())
    ).resolves.toBe("SECOND_OUTPUT");

    expect(client.requests).toHaveLength(2);
    const secondText = client.requests[1]!.messages
      .map(({ content }) => content)
      .join("\n");
    expect(secondText).toContain("SECOND_PROMPT");
    expect(secondText).toContain('<skill-file path="SKILL.md">');
    expect(secondText).toContain(
      '<skill-file path="references/theme-index.md">'
    );
    expect(secondText).not.toContain("FIRST_PROMPT_SENTINEL");
    expect(secondText).not.toContain("FIRST_OUTPUT_SENTINEL");
    expect(session.audit()).toMatchObject({
      loadMode: "injected",
      files: ["SKILL.md", "references/theme-index.md"]
    });
  });

  it("reuses a compact tool-loaded baseline without stale load instructions", async () => {
    const client = new ScriptedChatClient([
      read("root", "SKILL.md"),
      read("themes", "references/theme-index.md"),
      completed({ content: "FIRST_OUTPUT_SENTINEL" }),
      completed({ content: "SECOND_OUTPUT" })
    ]);
    const session = makeSession(client);

    await session.bootstrap(signal());
    await session.completeScoped("FIRST_PROMPT_SENTINEL", signal());
    await session.completeScoped("SECOND_PROMPT", signal());

    const secondScoped = client.requests[3]!;
    expect(secondScoped.tools).toEqual([READ_SKILL_FILE_TOOL]);
    expect(secondScoped.messages).toContainEqual({
      role: "system",
      content:
        '<skill-file path="SKILL.md">\nComplete workflow instructions.\n</skill-file>'
    });
    expect(secondScoped.messages).toContainEqual({
      role: "system",
      content:
        '<skill-file path="references/theme-index.md">\nComplete theme index.\n</skill-file>'
    });
    const secondText = secondScoped.messages
      .map(({ content }) => content)
      .join("\n");
    expect(secondText).toContain("SECOND_PROMPT");
    expect(secondText).not.toContain("FIRST_PROMPT_SENTINEL");
    expect(secondText).not.toContain("FIRST_OUTPUT_SENTINEL");
    expect(secondText).not.toContain("Before replying, call read_skill_file");
    expect(session.audit()).toMatchObject({
      loadMode: "tool-calls",
      files: ["SKILL.md", "references/theme-index.md"]
    });
  });

  it("sends the Skill and scoped article prompt together in the first request", async () => {
    const client = new ScriptedChatClient([
      (request) => {
        expect(request.messages.at(-1)).toEqual({
          role: "user",
          content: "ARTICLE_MARKDOWN_SENTINEL"
        });
        expect(
          request.messages.some(
            (message) =>
              message.role === "assistant" &&
              message.content.includes("provide")
          )
        ).toBe(false);
        expect(request.messages).toContainEqual({
          role: "system",
          content:
            '<skill-file path="SKILL.md">\nComplete workflow instructions.\n</skill-file>'
        });
        expect(request.messages).toContainEqual({
          role: "system",
          content:
            '<skill-file path="references/theme-index.md">\nComplete theme index.\n</skill-file>'
        });
        return completed({ content: "<section>FINAL_HTML</section>" });
      }
    ]);
    const session = makeSession(client);

    await expect(
      session.completeScoped("ARTICLE_MARKDOWN_SENTINEL", signal())
    ).resolves.toBe("<section>FINAL_HTML</section>");

    expect(client.requests).toHaveLength(1);
    expect(session.audit()).toMatchObject({
      loadMode: "injected",
      files: ["SKILL.md", "references/theme-index.md"]
    });
  });

  it("injects explicitly required generation files and disables tool calls", async () => {
    const client = new ScriptedChatClient([
      (request) => {
        expect(request.tools).toBeUndefined();
        expect(request.messages).toContainEqual({
          role: "system",
          content:
            '<skill-file path="references/common-components.md">\nComplete common components.\n</skill-file>'
        });
        expect(request.messages.at(-1)).toEqual({
          role: "user",
          content: "GENERATE_WITHOUT_TOOLS"
        });
        return completed({ content: "<section>FINAL_HTML</section>" });
      }
    ]);
    const session = makeSession(client);

    await expect(
      session.completeScopedWithRequiredFiles(
        "GENERATE_WITHOUT_TOOLS",
        ["references/common-components.md"],
        signal()
      )
    ).resolves.toBe("<section>FINAL_HTML</section>");

    expect(session.audit()).toMatchObject({
      loadMode: "injected",
      files: [
        "SKILL.md",
        "references/theme-index.md",
        "references/common-components.md"
      ]
    });
  });

  it("treats provider tool-call ids as request-scoped across bootstrap and independent calls", async () => {
    const client = new ScriptedChatClient([
      read("provider-reused-id", "SKILL.md"),
      read("themes", "references/theme-index.md"),
      read("provider-reused-id", "scripts/component_lint.py"),
      completed({ content: "FIRST_OUTPUT" }),
      read("provider-reused-id", "scripts/component_lint.py"),
      completed({ content: "SECOND_OUTPUT" })
    ]);
    const session = makeSession(client);

    await session.bootstrap(signal());
    await expect(
      session.completeScoped("FIRST_PROMPT", signal())
    ).resolves.toBe("FIRST_OUTPUT");
    await expect(
      session.completeScoped("SECOND_PROMPT", signal())
    ).resolves.toBe("SECOND_OUTPUT");

    expect(client.remainingSteps()).toBe(0);
    expect(session.audit().files).toEqual([
      "SKILL.md",
      "references/theme-index.md",
      "scripts/component_lint.py"
    ]);
  });

  it("makes a scoped voluntary read visible to later regular complete calls", async () => {
    const client = new ScriptedChatClient([
      read("root", "SKILL.md"),
      read("themes", "references/theme-index.md"),
      read("scoped-script", "scripts/component_lint.py"),
      completed({ content: "SCOPED_OUTPUT_SENTINEL" }),
      completed({ content: "REGULAR_OUTPUT" })
    ]);
    const session = makeSession(client);

    await session.bootstrap(signal());
    await session.completeScoped("SCOPED_PROMPT_SENTINEL", signal());
    await expect(
      session.complete("REGULAR_PROMPT", signal())
    ).resolves.toBe("REGULAR_OUTPUT");

    const regularText = client.requests.at(-1)!.messages
      .map(({ content }) => content)
      .join("\n");
    expect(regularText).toContain("REGULAR_PROMPT");
    expect(regularText).toContain("raise RuntimeError('must never execute')");
    expect(regularText).not.toContain("SCOPED_PROMPT_SENTINEL");
    expect(regularText).not.toContain("SCOPED_OUTPUT_SENTINEL");
  });

  it("keeps regular complete conversation accumulation unchanged", async () => {
    const client = new ScriptedChatClient([
      completed({ content: "FIRST_REGULAR_OUTPUT" }),
      completed({ content: "SECOND_REGULAR_OUTPUT" })
    ]);
    const session = makeSession(client, { tools: false });

    await session.complete("FIRST_REGULAR_PROMPT", signal());
    await session.complete("SECOND_REGULAR_PROMPT", signal());

    const secondText = client.requests[1]!.messages
      .map(({ content }) => content)
      .join("\n");
    expect(secondText).toContain("FIRST_REGULAR_PROMPT");
    expect(secondText).toContain("FIRST_REGULAR_OUTPUT");
    expect(secondText).toContain("SECOND_REGULAR_PROMPT");
  });

  it("preserves scoped downgrade fallback, invalid-response, and abort behavior", async () => {
    const downgradeClient = new ScriptedChatClient([
      read("root", "SKILL.md"),
      read("themes", "references/theme-index.md"),
      new AiError("tools_unsupported"),
      completed({ content: "fallback answer" })
    ]);
    const downgraded = makeSession(downgradeClient);
    await downgraded.bootstrap(signal());
    await expect(
      downgraded.completeScoped("SCOPED_PROMPT", signal())
    ).resolves.toBe("fallback answer");
    expect(downgradeClient.requests.at(-1)?.tools).toBeUndefined();
    expect(downgradeClient.requests.at(-1)?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "SCOPED_PROMPT" }),
        expect.objectContaining({
          content: expect.stringContaining('<skill-file path="SKILL.md">')
        })
      ])
    );
    expect(downgraded.audit().loadMode).toBe("mixed");

    const invalidClient = new ScriptedChatClient([
      completed({ content: "invalid", finishReason: "tool_calls" })
    ]);
    await expect(
      makeSession(invalidClient, { tools: false }).completeScoped(
        "prompt",
        signal()
      )
    ).rejects.toMatchObject({ code: "invalid_response" });

    const aborted = new AbortController();
    aborted.abort();
    const unusedClient = new ScriptedChatClient([]);
    await expect(
      makeSession(unusedClient, { tools: false }).completeScoped(
        "prompt",
        aborted.signal
      )
    ).rejects.toMatchObject({ code: "aborted" });
    expect(unusedClient.requests).toEqual([]);
  });
});
