import { describe, expect, it } from "vitest";

import {
  LocalCliStructuredOutputParser,
  localCliArguments,
  localCliApplicationCandidates,
  localCliEnvironment,
  resolveLocalCliExecutable,
  serializeConversation
} from "../../src/ai/LocalCliChatClient";

describe("LocalCliChatClient", () => {
  it("runs Codex non-interactively with an ephemeral read-only session", () => {
    expect(localCliArguments("codex-cli", "/vault")).toEqual([
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--color",
      "never",
      "--json",
      "--cd",
      "/vault",
      "-"
    ]);
  });

  it("runs Claude in print-only plan mode with read-only Skill access", () => {
    expect(localCliArguments("claude-cli", "/vault")).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "--tools",
      "Read,Glob"
    ]);
  });

  it("serializes the injected Skill conversation into one stdin prompt", () => {
    const prompt = serializeConversation([
      { role: "system", content: "Skill rules" },
      { role: "user", content: "Return HTML" }
    ], "/tmp/galley/SKILL.md");

    expect(prompt).toContain('Read "/tmp/galley/SKILL.md" completely');
    expect(prompt).toContain("Do not create article files yourself");
    expect(prompt).toContain('"content":"Skill rules"');
    expect(prompt).toContain('"content":"Return HTML"');
  });

  it("parses Codex JSONL agent messages without exposing protocol events", () => {
    const chunks: string[] = [];
    const parser = new LocalCliStructuredOutputParser("codex-cli", (text) => {
      chunks.push(text);
    });
    parser.push('{"type":"thread.started"}\n{"type":"item.completed","item":');
    parser.push('{"type":"agent_message","text":"<article>Hi</article>"}}\n');

    expect(parser.finish()).toBe("<article>Hi</article>");
    expect(chunks).toEqual(["<article>Hi</article>"]);
  });

  it("parses only visible Claude text deltas and ignores thinking", () => {
    const chunks: string[] = [];
    const parser = new LocalCliStructuredOutputParser("claude-cli", (text) => {
      chunks.push(text);
    });
    parser.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hidden"}}}\n');
    parser.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"<article>"}}}\n');
    parser.push('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi</article>"}}}\n');

    expect(parser.finish()).toBe("<article>Hi</article>");
    expect(chunks).toEqual(["<article>", "Hi</article>"]);
  });

  it("adds common macOS CLI locations when Obsidian starts with a system-only PATH", () => {
    expect(localCliEnvironment({
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      HOME: "/Users/example"
    }).PATH?.split(":")).toEqual([
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Users/example/.local/bin",
      "/Users/example/.npm-global/bin",
      "/Users/example/.volta/bin"
    ]);
  });

  it("finds Codex in a common install directory when Obsidian PATH is restricted", () => {
    expect(resolveLocalCliExecutable(
      "codex-cli",
      "codex",
      { PATH: "/usr/bin:/bin", HOME: "/Users/example" },
      (path) => path === "/usr/local/bin/codex"
    )).toBe("/usr/local/bin/codex");
  });

  it("prefers the Codex bundled with the desktop app over a stale PATH install", () => {
    expect(resolveLocalCliExecutable(
      "codex-cli",
      "/usr/local/bin/codex",
      { PATH: "/usr/local/bin:/usr/bin", HOME: "/Users/example" },
      (path) => [
        "/usr/local/bin/codex",
        "/Applications/ChatGPT.app/Contents/Resources/codex"
      ].includes(path)
    )).toBe("/Applications/ChatGPT.app/Contents/Resources/codex");
  });

  it("does not treat the Claude desktop app as the Claude Code CLI", () => {
    expect(localCliApplicationCandidates("claude-cli", "/Users/example")).toEqual([]);
  });

  it("falls back from a stale configured path to automatic Claude discovery", () => {
    expect(resolveLocalCliExecutable(
      "claude-cli",
      "/old/location/claude",
      { PATH: "/usr/bin:/bin", HOME: "/Users/example" },
      (path) => path === "/Users/example/.local/bin/claude"
    )).toBe("/Users/example/.local/bin/claude");
  });
});
