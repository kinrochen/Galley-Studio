import { describe, expect, it } from "vitest";

import { AiError } from "../../src/ai/AiError";
import {
  DIRECT_GENERATION_SOURCE_TOKEN_LIMIT,
  GenerationPipeline,
  GenerationPipelineError,
  MANUAL_THEME_ARTICLE_TYPE,
  MAX_LONG_BATCH_SOURCE_TOKENS,
  type GenerateArticleInput
} from "../../src/generation/GenerationPipeline";
import { parseThemeDecision } from "../../src/generation/ThemeDecision";
import {
  estimateTokens,
  planDocumentBatches
} from "../../src/source/LongDocumentPlanner";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import {
  batchFragment,
  contentTurn,
  GRAPHITE_THEME,
  lastUserPrompt,
  makeGenerationHarness,
  makeLongDocumentMarkdown,
  structuredPromptPayload,
  themeDecision,
  validAuthoringHtml,
  validAuthoringHtmlForIds,
  ZEN_THEME
} from "../support/generationFixtures";

const DEFAULT_MARKDOWN = "# Article\n\nBody text.";

function makeInput(
  overrides: Partial<GenerateArticleInput> = {}
): GenerateArticleInput {
  return {
    sourcePath: "Articles/example.md",
    markdown: DEFAULT_MARKDOWN,
    modelContextWindow: 128_000,
    ...overrides
  };
}

function makePipeline(
  steps: Parameters<typeof makeGenerationHarness>[0]
) {
  const harness = makeGenerationHarness(steps);
  return {
    ...harness,
    pipeline: new GenerationPipeline({
      session: harness.session,
      themes: harness.themes
    })
  };
}

describe("parseThemeDecision", () => {
  it("accepts exactly three non-empty string fields", () => {
    const { themes } = makeGenerationHarness([]);

    expect(parseThemeDecision(themeDecision(), themes)).toEqual({
      themeId: GRAPHITE_THEME.id,
      articleType: "tutorial",
      reason: "The registered use case matches."
    });
  });

  it.each([
    ["a fenced object", `\`\`\`json\n${themeDecision()}\n\`\`\``],
    ["prose around the object", `choice: ${themeDecision()}`],
    ["an array", `[${themeDecision()}]`],
    [
      "an extra key",
      '{"themeId":"graphite-minimal","articleType":"tutorial","reason":"x","extra":"x"}'
    ],
    [
      "a missing key",
      '{"themeId":"graphite-minimal","articleType":"tutorial"}'
    ],
    [
      "a non-string value",
      '{"themeId":"graphite-minimal","articleType":1,"reason":"x"}'
    ],
    [
      "an empty value",
      '{"themeId":"graphite-minimal","articleType":" ","reason":"x"}'
    ],
    [
      "a duplicate decoded key",
      '{"themeId":"graphite-minimal","theme\\u0049d":"zen-whitespace","articleType":"tutorial","reason":"x"}'
    ],
    [
      "an unknown theme",
      '{"themeId":"not-registered","articleType":"tutorial","reason":"x"}'
    ],
    [
      "non-JSON whitespace",
      '\u00a0{"themeId":"graphite-minimal","articleType":"tutorial","reason":"x"}'
    ],
    [
      "a theme ID padded with whitespace",
      '{"themeId":" graphite-minimal ","articleType":"tutorial","reason":"x"}'
    ]
  ])("rejects %s", (_label, response) => {
    const { themes } = makeGenerationHarness([]);

    expect(() => parseThemeDecision(response, themes)).toThrow(
      GenerationPipelineError
    );
    expect(() => parseThemeDecision(response, themes)).toThrow(
      expect.objectContaining({ code: "theme_invalid" })
    );
  });
});

describe("theme choice and Skill audit", () => {
  it("bootstraps and loads only the selected theme plus common components before generation", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const html = validAuthoringHtml(source);
    const { pipeline, client, session } = makePipeline([
      contentTurn(themeDecision(ZEN_THEME.id, "essay")),
      (request) => {
        const text = request.messages.map(({ content }) => content).join("\n");
        expect(text).toContain(
          `<skill-file path="${ZEN_THEME.file}">`
        );
        expect(text).toContain(
          '<skill-file path="references/common-components.md">'
        );
        expect(text).not.toContain(
          `<skill-file path="${GRAPHITE_THEME.file}">`
        );
        return contentTurn(html);
      }
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(client.requests).toHaveLength(2);
    expect(lastUserPrompt(client.requests[0]!)).toContain(
      "choose exactly one"
    );
    expect(lastUserPrompt(client.requests[1]!)).toContain(
      "Generate the article now"
    );
    expect(session.audit().files).toEqual([
      "SKILL.md",
      "references/theme-index.md",
      ZEN_THEME.file,
      "references/common-components.md"
    ]);
    expect(result.skillAudit).toEqual(session.audit());
    expect(result.theme.id).toBe(ZEN_THEME.id);
  });

  it("asks the same session once to correct an unknown automatic theme", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision("retired-theme")),
      contentTurn(themeDecision(GRAPHITE_THEME.id, "analysis")),
      contentTurn(validAuthoringHtml(source))
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(client.requests).toHaveLength(3);
    const correction = lastUserPrompt(client.requests[1]!);
    expect(correction).toMatch(/correct/i);
    expect(correction).toContain(GRAPHITE_THEME.id);
    expect(correction).toContain(ZEN_THEME.id);
    expect(correction).toContain("retired-theme");
  });

  it("fails with theme_invalid after the one correction is also invalid", async () => {
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision("retired-theme")),
      contentTurn('{"themeId":"still-retired"}')
    ]);

    await expect(
      pipeline.generate(makeInput(), new AbortController().signal)
    ).rejects.toMatchObject({ code: "theme_invalid" });
    expect(client.requests).toHaveLength(2);
  });

  it("uses a valid manual theme without a decision call and a neutral article type", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const { pipeline, client } = makePipeline([
      contentTurn(validAuthoringHtml(source))
    ]);

    const result = await pipeline.generate(
      makeInput({ manualThemeId: ZEN_THEME.id }),
      new AbortController().signal
    );

    expect(client.requests).toHaveLength(1);
    const payload = structuredPromptPayload<{ articleType: string }>(
      lastUserPrompt(client.requests[0]!)
    );
    expect(payload.articleType).toBe(MANUAL_THEME_ARTICLE_TYPE);
    expect(result.theme.id).toBe(ZEN_THEME.id);
  });

  it("rejects an unknown manual theme before generation", async () => {
    const { pipeline, client, session } = makePipeline([]);

    await expect(
      pipeline.generate(
        makeInput({ manualThemeId: "retired-theme" }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "theme_invalid" });
    expect(client.requests).toEqual([]);
    expect(session.audit().files).toEqual([
      "SKILL.md",
      "references/theme-index.md"
    ]);
  });

  it("turns a non-string manual theme boundary value into input_invalid", async () => {
    const { pipeline, client } = makePipeline([]);
    const input = {
      ...makeInput(),
      manualThemeId: null
    } as unknown as GenerateArticleInput;

    await expect(
      pipeline.generate(input, new AbortController().signal)
    ).rejects.toMatchObject({ code: "input_invalid" });
    expect(client.requests).toEqual([]);
  });
});

describe("direct generation and repair", () => {
  it("returns only a verified sanitized document and preserves source annotations", async () => {
    const input = Object.freeze(makeInput());
    const source = annotateMarkdown(input.markdown);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(validAuthoringHtml(source))
    ]);

    const result = await pipeline.generate(
      input,
      new AbortController().signal
    );

    expect(client.requests).toHaveLength(2);
    expect(result.status).toBe("verified");
    expect(result.validation).toEqual({ valid: true, issues: [] });
    expect(result.diagnostics).toBe(result.validation.issues);
    expect(result.html).not.toContain("<script");
    const article = new DOMParser()
      .parseFromString(result.html, "text/html")
      .querySelector<HTMLElement>("body > article");
    expect(article?.style.maxWidth).toBe("677px");
    expect(article?.style.width).toBe("100%");
    expect(article?.style.margin).toBe("0px auto");
    expect(article?.style.boxSizing).toBe("border-box");
    expect(result.source).toEqual(source);
    expect(input).toEqual(makeInput());
  });

  it("forces sanitizer removals through repair without exposing unsafe bytes", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const unsafe = validAuthoringHtml(source).replace(
      "</article>",
      "<script>alert('unsafe')</script></article>"
    );
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(unsafe),
      contentTurn(validAuthoringHtml(source))
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(result.html).not.toContain("unsafe");
    const repair = lastUserPrompt(client.requests[2]!);
    expect(repair).toContain("unsafe_content_removed");
    expect(repair).not.toContain("<script");
  });

  it.each([
    ["non-HTML output", "Here is the article, but no document."],
    [
      "a malformed shell",
      "<!DOCTYPE html><html><head></head><body><article>broken"
    ]
  ])("turns %s into a controlled repairable issue", async (_label, bad) => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(bad),
      contentTurn(validAuthoringHtml(source))
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(lastUserPrompt(client.requests[2]!)).toContain(
      "html_extraction_failed"
    );
    expect(lastUserPrompt(client.requests[2]!)).not.toContain(bad);
  });

  it("succeeds on the second repair and never starts a third", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const invalid = validAuthoringHtmlForIds([source.blocks[0]!.id]);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(invalid),
      contentTurn(invalid),
      contentTurn(validAuthoringHtml(source)),
      contentTurn("must remain unused")
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(client.requests).toHaveLength(4);
    expect(client.remainingSteps()).toBe(1);
  });

  it("returns the final safe unverified draft after exactly two failed repairs", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const invalid = validAuthoringHtmlForIds([source.blocks[0]!.id]);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(invalid),
      contentTurn(invalid),
      contentTurn(invalid),
      contentTurn("must remain unused")
    ]);

    const result = await pipeline.generate(
      makeInput(),
      new AbortController().signal
    );

    expect(result.status).toBe("unverified");
    expect(result.validation.valid).toBe(false);
    expect(result.diagnostics).toBe(result.validation.issues);
    expect(result.html).not.toContain("must remain unused");
    expect(client.requests).toHaveLength(4);
    expect(client.remainingSteps()).toBe(1);
  });

  it("does not return an empty fallback document after failed repairs", async () => {
    const { pipeline } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn("not html"),
      contentTurn("still not html"),
      contentTurn("still not html")
    ]);

    await expect(
      pipeline.generate(makeInput(), new AbortController().signal)
    ).rejects.toMatchObject({ code: "generation_empty" });
  });

  it("repairs with only the exact missing source blocks and current safe HTML", async () => {
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const invalid = validAuthoringHtmlForIds([source.blocks[0]!.id]);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(invalid),
      contentTurn(validAuthoringHtml(source))
    ]);

    await pipeline.generate(makeInput(), new AbortController().signal);

    const payload = structuredPromptPayload<{
      currentDocument: { html: string };
      issues: Array<{ code: string; sourceId?: string }>;
      missingSourceBlocks: Array<{ id: string; markdown: string }>;
    }>(lastUserPrompt(client.requests[2]!));
    expect(payload.currentDocument.html).toContain(source.blocks[0]!.id);
    expect(payload.currentDocument.html).not.toContain("<script");
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "source_missing",
          sourceId: source.blocks[1]!.id
        })
      ])
    );
    expect(payload.missingSourceBlocks).toEqual([
      expect.objectContaining({
        id: source.blocks[1]!.id,
        markdown: source.blocks[1]!.markdown
      })
    ]);
  });
});

describe("long mode", () => {
  it("batches medium sources whose styled HTML expansion would overload one request", async () => {
    const markdown = Array.from(
      { length: 6 },
      (_, index) => `## Section ${index + 1}\n\n${"body ".repeat(650)}`
    ).join("\n\n");
    const source = annotateMarkdown(markdown);
    expect(estimateTokens(markdown)).toBeGreaterThan(
      DIRECT_GENERATION_SOURCE_TOKEN_LIMIT
    );
    const batches = planDocumentBatches(
      source,
      MAX_LONG_BATCH_SOURCE_TOKENS
    );
    expect(batches.length).toBeGreaterThan(1);
    const { pipeline, client } = makePipeline([
      ...batches.map((batch) => contentTurn(batchFragment(batch.blockIds))),
      ...batches.map((batch) => contentTurn(batchFragment(batch.blockIds)))
    ]);

    const result = await pipeline.generate(
      makeInput({
        markdown,
        manualThemeId: GRAPHITE_THEME.id,
        modelContextWindow: 128_000
      }),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(client.requests).toHaveLength(batches.length * 2);
    expect(
      client.requests.every((request) =>
        lastUserPrompt(request).includes("long-document batch") ||
        lastUserPrompt(request).includes("batch consistency normalization")
      )
    ).toBe(true);
  });

  it("runs one bounded consistency normalization per batch, then assembles in DOM order", async () => {
    const markdown = makeLongDocumentMarkdown(8);
    const source = annotateMarkdown(markdown);
    const modelContextWindow = 140;
    expect(estimateTokens(markdown)).toBeGreaterThan(
      Math.floor(modelContextWindow * 0.85)
    );
    const batches = planDocumentBatches(
      source,
      Math.floor(modelContextWindow * 0.5)
    );
    expect(batches.length).toBeGreaterThan(1);
    const generated = batches.map((batch, index) =>
      batchFragment(batch.blockIds)
        .replace(
          "<section ",
          '<section style="color: rgb(1, 2, 3); padding: 4px" '
        )
        .replace(
          "</section>",
          ` OUTPUT_BATCH_${index + 1}</section>`
        )
    );
    let frozenDesignEvidence: unknown;
    const steps = [
      contentTurn(themeDecision()),
      ...generated.map(contentTurn),
      ...batches.map((batch, index) => {
        return (request: import("../../src/ai/AiProtocol").ChatRequest) => {
            const prompt = lastUserPrompt(request);
            expect(prompt).toContain("batch consistency normalization");
            const payload = structuredPromptPayload<{
              batchId: string;
              batchManifest: {
                totalBatches: number;
                currentPosition: number;
                previousBatchId: string | null;
                nextBatchId: string | null;
                designEvidence: {
                  sourceBatchCount: number;
                  directChildPatterns: Array<{ value: string; count: number }>;
                  classNames: Array<{ value: string; count: number }>;
                  elementTags: Array<{ value: string; count: number }>;
                  headingLevels: Array<{ value: string; count: number }>;
                  inlineStyleDeclarations: Array<{
                    value: string;
                    count: number;
                  }>;
                };
              };
              currentFragment: { html: string };
              expectedSourceIds: string[];
            }>(prompt);
            expect(payload.batchId).toBe(batch.id);
            expect(payload.currentFragment.html).toContain(
              `OUTPUT_BATCH_${index + 1}`
            );
            expect(payload.expectedSourceIds).toEqual(batch.blockIds);
            expect(payload.batchManifest).toMatchObject({
              totalBatches: batches.length,
              currentPosition: index + 1,
              previousBatchId: batches[index - 1]?.id ?? null,
              nextBatchId: batches[index + 1]?.id ?? null,
              designEvidence: {
                sourceBatchCount: batches.length,
                elementTags: expect.arrayContaining([
                  { value: "section", count: source.blocks.length }
                ])
              }
            });
            expect(
              payload.batchManifest.designEvidence.directChildPatterns
            ).toHaveLength(1);
            expect(
              payload.batchManifest.designEvidence.classNames.length
            ).toBeLessThanOrEqual(12);
            expect(
              payload.batchManifest.designEvidence.inlineStyleDeclarations
            ).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  value: expect.stringContaining("color:"),
                  count: batches.length
                })
              ])
            );
            if (index === 0) {
              frozenDesignEvidence =
                payload.batchManifest.designEvidence;
            } else {
              expect(payload.batchManifest.designEvidence).toEqual(
                frozenDesignEvidence
              );
              expect(prompt).not.toContain("NORMALIZED_DRIFT_CLASS");
            }
            expect(
              JSON.stringify(payload.batchManifest).length
            ).toBeLessThan(1_600);
            if (index === 0 && batches.length > 2) {
              expect(JSON.stringify(payload.batchManifest)).not.toContain(
                batches[2]!.id
              );
            }
            return contentTurn(
              index === 0
                ? batchFragment(batch.blockIds).replace(
                    "<section ",
                    '<section class="NORMALIZED_DRIFT_CLASS" '
                  )
                : batchFragment(batch.blockIds)
            );
          };
      })
    ];
    const { pipeline, client } = makePipeline(steps);

    const result = await pipeline.generate(
      makeInput({ markdown, modelContextWindow }),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(client.requests).toHaveLength(1 + batches.length * 2);
    const prompts = client.requests.map(lastUserPrompt);
    expect(
      prompts.filter((prompt) => prompt.includes("ordered long-document batch"))
    ).toHaveLength(batches.length);
    expect(
      prompts.filter((prompt) =>
        prompt.includes("batch consistency normalization")
      )
    ).toHaveLength(batches.length);
    expect(
      prompts.some((prompt) => prompt.includes("currentDocument"))
    ).toBe(false);

    const secondBatchRequest = client.requests.find((request) =>
      lastUserPrompt(request).includes('"batchId": "batch-002"') &&
      lastUserPrompt(request).includes("ordered long-document batch")
    );
    const secondBatchText = secondBatchRequest?.messages
      .map(({ content }) => content)
      .join("\n");
    expect(secondBatchText).not.toContain("Body 1.");
    expect(secondBatchText).not.toContain("OUTPUT_BATCH_1");
    const ids = [
      ...new DOMParser()
        .parseFromString(result.html, "text/html")
        .querySelectorAll("[data-galley-source]")
    ].map((element) => element.getAttribute("data-galley-source"));
    expect(ids).toEqual(source.blocks.map(({ id }) => id));
  });

  it.each(["duplicate", "unknown"] as const)(
    "rejects %s markers in batch output before the consistency pass",
    async (failure) => {
      const markdown = makeLongDocumentMarkdown(8);
      const source = annotateMarkdown(markdown);
      const modelContextWindow = 140;
      const batches = planDocumentBatches(
        source,
        Math.floor(modelContextWindow * 0.5)
      );
      const firstIds = batches[0]!.blockIds;
      const badFragment =
        failure === "duplicate"
          ? batchFragment([...firstIds, firstIds[0]!])
          : failure === "unknown"
            ? batchFragment([...firstIds.slice(0, -1), "invented-999"])
            : batchFragment(firstIds);
      const { pipeline, client } = makePipeline([
        contentTurn(themeDecision()),
        contentTurn(badFragment),
        ...batches
          .slice(1)
          .map((batch) => contentTurn(batchFragment(batch.blockIds))),
        ...batches
          .slice(1)
          .map((batch) => contentTurn(batchFragment(batch.blockIds))),
        contentTurn("still not a document"),
        contentTurn("still not a document")
      ]);

      const result = await pipeline.generate(
        makeInput({ markdown, modelContextWindow }),
        new AbortController().signal
      );

      expect(result.status).toBe("unverified");
      const prompts = client.requests.map(lastUserPrompt);
      expect(
        prompts.find((prompt) => prompt.includes("Repair only this"))
      ).toContain("long_batch_invalid");
      expect(client.requests).toHaveLength(
        1 + 1 + (batches.length - 1) * 2 + 2
      );
      expect(
        prompts.some((prompt) =>
          prompt.includes('"currentDocument"')
        )
      ).toBe(false);
    }
  );

  it.each([
    ["a layout wrapper", (fragment: string) => `<div class="layout">${fragment}</div>`],
    ["an article wrapper", (fragment: string) => `<article>${fragment}</article>`],
    ["an HTML fence", (fragment: string) => `\`\`\`html\n${fragment}\n\`\`\``]
  ])("accepts %s around a valid long-document batch", async (_label, wrap) => {
    const markdown = makeLongDocumentMarkdown(8);
    const source = annotateMarkdown(markdown);
    const modelContextWindow = 140;
    const batches = planDocumentBatches(
      source,
      Math.floor(modelContextWindow * 0.5)
    );
    const steps = [
      contentTurn(themeDecision()),
      ...batches.map((batch, index) =>
        contentTurn(
          index === 0
            ? wrap(batchFragment(batch.blockIds))
            : batchFragment(batch.blockIds)
        )
      ),
      ...batches.map((batch) => contentTurn(batchFragment(batch.blockIds)))
    ];
    const { pipeline } = makePipeline(steps);

    const result = await pipeline.generate(
      makeInput({ markdown, modelContextWindow }),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    expect(result.html).toContain(source.blocks[0]!.id);
  });

  it("fails an indivisible over-budget block before requesting partial output", async () => {
    const { pipeline, client } = makePipeline([]);

    await expect(
      pipeline.generate(
        makeInput({
          markdown: `# ${"oversized ".repeat(80)}`,
          manualThemeId: GRAPHITE_THEME.id,
          modelContextWindow: 20
        }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: "long_block_oversized" });
    expect(client.requests).toEqual([]);
  });

  it("sanitizes the assembled draft before consistency and repairs removals", async () => {
    const markdown = makeLongDocumentMarkdown(8);
    const source = annotateMarkdown(markdown);
    const modelContextWindow = 140;
    const batches = planDocumentBatches(
      source,
      Math.floor(modelContextWindow * 0.5)
    );
    const unsafeFirst = batchFragment(batches[0]!.blockIds).replace(
      "<section ",
      '<section onclick="alert(1)" '
    );
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      contentTurn(unsafeFirst),
      ...batches
        .slice(1)
        .map((batch) => contentTurn(batchFragment(batch.blockIds))),
      ...batches
        .slice(1)
        .map((batch) => contentTurn(batchFragment(batch.blockIds))),
      contentTurn(batchFragment(batches[0]!.blockIds)),
      contentTurn(batchFragment(batches[0]!.blockIds))
    ]);

    const result = await pipeline.generate(
      makeInput({ markdown, modelContextWindow }),
      new AbortController().signal
    );

    expect(result.status).toBe("verified");
    const prompts = client.requests.map(lastUserPrompt);
    expect(
      prompts.some((prompt) => prompt.includes('"currentDocument"'))
    ).toBe(false);
    const repairPrompt = prompts.at(-1)!;
    const actualRepairPrompt = prompts.find((prompt) =>
      prompt.includes("Repair only this")
    )!;
    expect(actualRepairPrompt).toContain("unsafe_content_removed");
    const repairPayload = structuredPromptPayload<{
      currentFragment: { html: string };
    }>(actualRepairPrompt);
    expect(repairPayload.currentFragment.html).not.toContain("onclick");
    expect(repairPrompt).toContain("batch consistency normalization");
  });

  it("caps bounded repairs at two global rounds without cross-batch history", async () => {
    const markdown = makeLongDocumentMarkdown(8);
    const source = annotateMarkdown(markdown);
    const modelContextWindow = 140;
    const batches = planDocumentBatches(
      source,
      Math.floor(modelContextWindow * 0.5)
    );
    const invalidIds = new Set([batches[0]!.id, batches[1]!.id]);
    const initialSteps = batches.map((batch) =>
      invalidIds.has(batch.id)
        ? contentTurn("invalid batch fragment")
        : contentTurn(batchFragment(batch.blockIds))
    );
    const consistencySteps = batches
      .filter((batch) => !invalidIds.has(batch.id))
      .map((batch) => contentTurn(batchFragment(batch.blockIds)));
    const firstRoundMutation = batchFragment(batches[0]!.blockIds).replace(
      "<section ",
      '<section class="ROUND_MUTATED_CLASS" onclick="alert(1)" '
    );
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      ...initialSteps,
      ...consistencySteps,
      contentTurn(firstRoundMutation),
      contentTurn("ROUND_ONE_BATCH_TWO_OUTPUT"),
      contentTurn("ROUND_TWO_BATCH_ONE_OUTPUT"),
      contentTurn("ROUND_TWO_BATCH_TWO_OUTPUT")
    ]);

    const result = await pipeline.generate(
      makeInput({ markdown, modelContextWindow }),
      new AbortController().signal
    );

    expect(result.status).toBe("unverified");
    const repairRequests = client.requests.filter((request) =>
      lastUserPrompt(request).includes("Repair only this")
    );
    expect(repairRequests).toHaveLength(4);
    expect(lastUserPrompt(repairRequests[1]!)).not.toContain(
      "ROUND_MUTATED_CLASS"
    );
    expect(
      repairRequests[1]!.messages
        .map(({ content }) => content)
        .join("\n")
    ).not.toContain("ROUND_ONE_BATCH_ONE_OUTPUT");
    expect(
      repairRequests[2]!.messages
        .map(({ content }) => content)
        .join("\n")
    ).not.toContain("ROUND_ONE_BATCH_TWO_OUTPUT");
  });
});

describe("abort and determinism", () => {
  it("aborts before bootstrap without making a model call", async () => {
    const controller = new AbortController();
    controller.abort();
    const { pipeline, client, session } = makePipeline([]);

    await expect(pipeline.generate(makeInput(), controller.signal)).rejects.toBeInstanceOf(
      AiError
    );
    await expect(pipeline.generate(makeInput(), controller.signal)).rejects.toMatchObject({
      code: "aborted"
    });
    expect(client.requests).toEqual([]);
    expect(session.audit().files).toEqual([]);
  });

  it("stops after cancellation during theme decision", async () => {
    const controller = new AbortController();
    const { pipeline, client } = makePipeline([
      () => {
        controller.abort();
        return contentTurn(themeDecision());
      },
      contentTurn("must remain unused")
    ]);

    await expect(
      pipeline.generate(makeInput(), controller.signal)
    ).rejects.toMatchObject({ code: "aborted" });
    expect(client.requests).toHaveLength(1);
  });

  it("stops after cancellation during direct generation", async () => {
    const controller = new AbortController();
    const source = annotateMarkdown(DEFAULT_MARKDOWN);
    const { pipeline, client } = makePipeline([
      contentTurn(themeDecision()),
      () => {
        controller.abort();
        return contentTurn(validAuthoringHtml(source));
      },
      contentTurn("must remain unused")
    ]);

    await expect(
      pipeline.generate(makeInput(), controller.signal)
    ).rejects.toMatchObject({ code: "aborted" });
    expect(client.requests).toHaveLength(2);
  });

  it("produces byte-identical results without mutating repeated inputs", async () => {
    const input = Object.freeze(makeInput());
    const source = annotateMarkdown(input.markdown);
    const run = async () => {
      const { pipeline } = makePipeline([
        contentTurn(themeDecision()),
        contentTurn(validAuthoringHtml(source))
      ]);
      return pipeline.generate(input, new AbortController().signal);
    };

    const first = await run();
    const second = await run();

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(input).toEqual(makeInput());
  });
});
