import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { ChatRequest, ChatTurnResult } from "../../src/ai/AiProtocol";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import type { AnnotatedSource } from "../../src/source/SourceAnnotator";
import { BuiltInThemeRepository } from "../../src/themes/BuiltInThemeRepository";
import type { ThemeDefinition } from "../../src/themes/ThemeIndex";
import {
  ScriptedChatClient,
  type ScriptedChatStep
} from "./ScriptedChatClient";
import {
  makeProviderCapabilities,
  TEST_PACKAGE_HASH
} from "./phase1Factories";

const FIXTURE_DIRECTORY = resolve(process.cwd(), "tests/fixtures");

export function loadFixture(name: string): string {
  const fixturePath = resolve(FIXTURE_DIRECTORY, name);
  if (!fixturePath.startsWith(`${FIXTURE_DIRECTORY}${sep}`)) {
    throw new Error(`Fixture path escapes tests/fixtures: ${name}`);
  }
  return readFileSync(fixturePath, "utf8");
}

export function makeLongDocumentMarkdown(sectionCount = 10): string {
  return Array.from(
    { length: sectionCount },
    (_, index) => `## Section ${index + 1}\n\nBody ${index + 1}.`
  ).join("\n\n");
}

export const GRAPHITE_THEME: ThemeDefinition = {
  id: "graphite-minimal",
  name: "Graphite Minimal",
  primaryColor: "#52525B",
  useCases: "technical articles",
  file: "references/theme-graphite-minimal.md",
  underlineCss: "border-bottom:2px solid #52525B;"
};

export const ZEN_THEME: ThemeDefinition = {
  id: "zen-whitespace",
  name: "Zen Whitespace",
  primaryColor: "#F5F5F4",
  useCases: "reflective essays",
  file: "references/theme-zen-whitespace.md",
  underlineCss: "border-bottom:1px solid #A8A29E;"
};

export interface GenerationHarness {
  client: ScriptedChatClient;
  session: SkillSession;
  themes: BuiltInThemeRepository;
}

export function makeGenerationHarness(
  steps: readonly ScriptedChatStep[]
): GenerationHarness {
  const files = new Map<string, string>([
    ["SKILL.md", "Complete workflow instructions."],
    ["references/theme-index.md", themeIndexMarkdown()],
    ["references/common-components.md", "Common components."],
    [GRAPHITE_THEME.file, "Graphite components."],
    [ZEN_THEME.file, "Zen components."]
  ]);
  const client = new ScriptedChatClient(steps);
  const skillPackage = {
    id: "gzh-design",
    version: "test-skill-version",
    files
  };
  const session = new SkillSession({
    client,
    target: {
      baseUrl: "https://api.example/v1",
      model: "test-model"
    },
    capabilities: makeProviderCapabilities({ tools: false }),
    skillPackage,
    vfs: new SkillVirtualFileSystem(files),
    packageHash: TEST_PACKAGE_HASH
  });

  return {
    client,
    session,
    themes: new BuiltInThemeRepository(new SkillVirtualFileSystem(files))
  };
}

export function contentTurn(content: string): ChatTurnResult {
  return { content, toolCalls: [], finishReason: "stop" };
}

export function themeDecision(
  themeId = GRAPHITE_THEME.id,
  articleType = "tutorial"
): string {
  return JSON.stringify({
    themeId,
    articleType,
    reason: "The registered use case matches."
  });
}

export function validAuthoringHtml(source: AnnotatedSource): string {
  return validAuthoringHtmlForIds(source.blocks.map(({ id }) => id));
}

export function validAuthoringHtmlForIds(ids: readonly string[]): string {
  const blocks = ids
    .map(
      (id) =>
        `<section data-galley-source="${id}">${id}</section>`
    )
    .join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Article</title></head><body><article>${blocks}</article></body></html>`;
}

export function batchFragment(ids: readonly string[]): string {
  return ids
    .map(
      (id) =>
        `<section data-galley-source="${id}">${id}</section>`
    )
    .join("");
}

export function lastUserPrompt(request: ChatRequest): string {
  const message = [...request.messages]
    .reverse()
    .find(({ role }) => role === "user");
  if (!message) {
    throw new Error("Request does not contain a user prompt");
  }
  return message.content;
}

export function structuredPromptPayload<T>(prompt: string): T {
  const label = "Structured payload (canonical JSON):\n";
  const offset = prompt.lastIndexOf(label);
  if (offset < 0) {
    throw new Error("Prompt does not contain a structured payload");
  }
  return JSON.parse(prompt.slice(offset + label.length)) as T;
}

function themeIndexMarkdown(): string {
  const rows = [GRAPHITE_THEME, ZEN_THEME]
    .map(
      (theme) =>
        `| ${theme.name} | ${theme.primaryColor} | ${theme.useCases} | ${theme.file} | ${theme.underlineCss} |`
    )
    .join("\n");
  return [
    "## 已注册主题",
    "",
    "| 主题 | 主色 | 适用场景 | 组件库文件 | 正文下划线 CSS |",
    "| --- | --- | --- | --- | --- |",
    rows
  ].join("\n");
}
