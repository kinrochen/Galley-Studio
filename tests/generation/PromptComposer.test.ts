import { describe, expect, it } from "vitest";

import type {
  GenerationPromptInput,
  RepairPromptInput,
  ThemeDecisionPromptInput
} from "../../src/generation/GenerationTypes";
import {
  composeGenerationPrompt,
  composeRepairPrompt,
  composeThemeDecisionPrompt
} from "../../src/generation/PromptComposer";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import type { ThemeDefinition } from "../../src/themes/ThemeIndex";

const THEME: ThemeDefinition = {
  id: "graphite-minimal",
  name: "石墨极简风",
  primaryColor: "#52525B 石墨灰",
  useCases: "设计、科技评论、专业观点、高端品牌",
  file: "references/theme-graphite-minimal.md",
  underlineCss: "border-bottom:2px solid #52525B;font-weight:600;"
};

function source() {
  return annotateMarkdown("# Title\n\nBody text.");
}

function makeGenerationInput(): GenerationPromptInput {
  return {
    source: source(),
    theme: THEME,
    articleType: "tutorial",
    resources: [
      {
        vaultPath: "assets/cover.png",
        alt: "Cover",
        mediaType: "image/png",
        width: 1200,
        height: 630
      }
    ]
  };
}

describe("composeThemeDecisionPrompt", () => {
  it("allows only registered IDs and files in a strict JSON decision", () => {
    const input: ThemeDecisionPromptInput = {
      source: source(),
      themes: [THEME]
    };

    const prompt = composeThemeDecisionPrompt(input);

    expect(prompt).toContain('"themeId": "string"');
    expect(prompt).toContain('"articleType": "string"');
    expect(prompt).toContain('"reason": "string"');
    expect(prompt).toContain("Return only one strict JSON object");
    expect(prompt).toContain("graphite-minimal");
    expect(prompt).toContain("references/theme-graphite-minimal.md");
    expect(prompt).toContain(source().original);
    expect(prompt).not.toContain("theme file contents");
  });

  it("rejects an empty registered theme set", () => {
    expect(() =>
      composeThemeDecisionPrompt({ source: source(), themes: [] })
    ).toThrow(/registered theme/);
  });
});

describe("composeGenerationPrompt", () => {
  it("layers the Authoring profile after the Skill and requires direct complete HTML", () => {
    const prompt = composeGenerationPrompt(makeGenerationInput());

    expect(prompt).toContain(
      "Follow the already-loaded gzh-design Skill first, then apply this Galley Authoring profile"
    );
    expect(prompt).toContain(
      "The gzh-design Skill controls theme selection, component use, article structure, numbering, keyword marking, fidelity, and quality."
    );
    expect(prompt).toContain(
      "This profile overrides only WeChat-specific output restrictions."
    );
    expect(prompt).toContain("return one complete HTML document");
    expect(prompt).toContain("DOCTYPE, html, head, and body");
    expect(prompt).toContain("Keep article styles inline");
    expect(prompt).toContain("Scripts, event-handler attributes");
    expect(prompt).toContain("Do not return a Markdown code fence");
    expect(prompt).toContain("Do not return JSON or explanatory prose");
  });

  it("requires exact-once source markers in source order", () => {
    const input = makeGenerationInput();
    const prompt = composeGenerationPrompt(input);

    expect(prompt).toContain("data-galley-source");
    expect(prompt).toContain("exactly once and in source order");
    expect(prompt).toContain("<!-- galley-source:heading-001 -->");
    expect(prompt).toContain("<!-- galley-source:paragraph-001 -->");
    expect(prompt).toContain(input.source.promptMarkdown);
  });

  it("references the registered selected theme without copying component content", () => {
    const prompt = composeGenerationPrompt(makeGenerationInput());

    expect(prompt).toContain('Selected registered theme ID: "graphite-minimal"');
    expect(prompt).toContain(
      'Selected registered theme file: "references/theme-graphite-minimal.md"'
    );
    expect(prompt).toContain(
      "The selected theme file is loaded through the active SkillSession"
    );
    expect(prompt).not.toContain("border-bottom:2px solid #52525B");
  });

  it("includes only safe source resource metadata", () => {
    const input = makeGenerationInput() as GenerationPromptInput & {
      apiKey: string;
      requestMetadata: { traceId: string };
    };
    input.apiKey = "secret-api-key";
    input.requestMetadata = { traceId: "private-trace" };

    const prompt = composeGenerationPrompt(input);

    expect(prompt).toContain('"vaultPath": "assets/cover.png"');
    expect(prompt).toContain('"mediaType": "image/png"');
    expect(prompt).not.toContain("secret-api-key");
    expect(prompt).not.toContain("private-trace");
  });
});

describe("composeRepairPrompt", () => {
  it("contains only deterministic issues, current HTML, and missing source blocks", () => {
    const annotated = source();
    const input = {
      issues: [
        {
          code: "source_missing",
          severity: "error",
          message: "paragraph-001 is missing",
          sourceId: "paragraph-001",
          requestId: "private-request"
        }
      ],
      currentHtml:
        "<!DOCTYPE html><html><head></head><body><h1 data-galley-source=\"heading-001\">Title</h1></body></html>",
      missingSourceBlocks: [annotated.blocks[1]!],
      apiKey: "secret-api-key",
      requestMetadata: { traceId: "private-trace" }
    } as unknown as RepairPromptInput & {
      apiKey: string;
      requestMetadata: { traceId: string };
    };

    const prompt = composeRepairPrompt(input);

    expect(prompt).toContain("source_missing");
    expect(prompt).toContain("paragraph-001 is missing");
    expect(prompt).toContain(input.currentHtml);
    expect(prompt).toContain("Body text.");
    expect(prompt).toContain(
      "Do not rewrite, restyle, reorder, summarize, or otherwise change already-valid content"
    );
    expect(prompt).toContain("Return only the repaired complete HTML document");
    expect(prompt).not.toContain("private-request");
    expect(prompt).not.toContain("secret-api-key");
    expect(prompt).not.toContain("private-trace");
    expect(prompt).not.toContain('"start"');
    expect(prompt).not.toContain('"end"');
  });
});
