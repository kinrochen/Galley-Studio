import { describe, expect, it } from "vitest";

import { AiError } from "../../src/ai/AiError";
import type { ChatTurnResult } from "../../src/ai/AiProtocol";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import {
  ThemeGenerationService,
  THEME_GENERATION_REQUIRED_FILES,
  type ThemeGenerationStage
} from "../../src/theme-lab/ThemeGenerationService";
import { validateReferenceImage } from "../../src/theme-lab/ReferenceImage";
import type {
  AtomicThemeStore,
  StoredThemeFiles,
  StoredThemeRecord
} from "../../src/themes/CustomThemeRepository";
import { CustomThemeRepository } from "../../src/themes/CustomThemeRepository";
import {
  ScriptedChatClient,
  type ScriptedChatStep
} from "../support/ScriptedChatClient";
import { makeProviderCapabilities, TEST_PACKAGE_HASH } from "../support/phase1Factories";
import {
  CUSTOM_THEME_ID,
  themeComponentLibraryResponse,
  themeConceptResponse,
  themeIndexMarkdown,
  tinyPng,
  validComponentLibrary,
  validThemeConceptPreview,
  validThemePreview
} from "../support/phase5Fixtures";

const signal = (): AbortSignal => new AbortController().signal;
const completed = (content = ""): ChatTurnResult => ({
  content,
  toolCalls: [],
  finishReason: "stop"
});

class Store implements AtomicThemeStore {
  readonly records = new Map<string, StoredThemeRecord>();
  revision = 0;
  async listIds(): Promise<readonly string[]> { return [...this.records.keys()]; }
  async read(id: string): Promise<StoredThemeRecord | null> {
    return this.records.get(id) ?? null;
  }
  async commit(
    id: string,
    value: StoredThemeFiles,
    expectedRevision: string | null
  ): Promise<"committed" | "collision"> {
    if ((this.records.get(id)?.revision ?? null) !== expectedRevision) return "collision";
    this.revision += 1;
    this.records.set(id, { files: value, revision: String(this.revision) });
    return "committed";
  }
  async remove(id: string): Promise<boolean> { return this.records.delete(id); }
}

function harness(
  steps: readonly ScriptedChatStep[],
  capabilities = makeProviderCapabilities({ tools: false, vision: false })
) {
  const files = new Map<string, string>([
    ["SKILL.md", "Theme workflow."],
    ["references/theme-index.md", themeIndexMarkdown("existing-theme", "Existing")],
    ["references/theme-generator.md", "Generate 45 to 75 blocks."],
    ["references/common-components.md", "Common components."],
    ["assets/profiles/theme-generator.md", "Return the Galley theme JSON contract."],
    ["references/theme-existing-theme.md", validComponentLibrary("Existing")]
  ]);
  const client = new ScriptedChatClient(steps);
  const skillPackage = { id: "gzh-design", version: "test", files };
  const session = new SkillSession({
    client,
    target: { baseUrl: "https://api.example/v1", model: "vision-model" },
    capabilities,
    skillPackage,
    vfs: new SkillVirtualFileSystem(files),
    packageHash: TEST_PACKAGE_HASH
  });
  const store = new Store();
  const repository = new CustomThemeRepository(store, ["existing-theme"]);
  return {
    client,
    repository,
    service: new ThemeGenerationService({
      session,
      capabilities,
      repository,
      now: () => new Date("2026-07-15T00:00:00.000Z")
    })
  };
}

describe("AI Theme Lab two-stage generation", () => {
  it("creates one lightweight preview request without loading the full theme library", async () => {
    const { client, service } = harness([
      completed(validThemeConceptPreview())
    ]);
    const stages: ThemeGenerationStage[] = [];

    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal(),
      (stage) => stages.push(stage)
    );

    expect(stages).toEqual(["drafting", "validating"]);
    expect(draft.validation.valid).toBe(true);
    expect(draft.finalized).toBe(false);
    expect(draft.componentLibrary).toBe("");
    expect(draft.previewHtml).toContain('data-galley-theme-block="10"');
    expect(client.requests).toHaveLength(1);
    expect(client.messagesText()).not.toContain(
      '<skill-file path="references/common-components.md">'
    );
    expect(client.messagesText()).not.toContain(
      '<skill-file path="references/theme-generator.md">'
    );
    expect(client.messagesText()).toContain(
      "Return only one script-free full HTML5 document."
    );
    expect(client.messagesText()).not.toContain(
      "Return one strict JSON object"
    );
  });

  it("accepts fenced direct HTML and infers safe theme metadata locally", async () => {
    const { service } = harness([
      completed(
        `Here is the concept:\n\n\`\`\`html\n${validThemeConceptPreview("Neon Future")}\n\`\`\``
      )
    ]);

    const draft = await service.generate(
      { description: "科幻霓虹风" },
      signal()
    );

    expect(draft.validation.valid).toBe(true);
    expect(draft.manifest.name).toBe("Neon Future concept");
    expect(draft.manifest.id).toMatch(/^theme-[a-z0-9]+$/u);
    expect(draft.previewHtml).toContain('data-galley-theme-block="10"');
  });

  it("creates a usable local concept when the model returns only explanation text", async () => {
    const { service } = harness([
      completed("Please provide the article content before I can continue.")
    ]);

    const draft = await service.generate(
      {
        description:
          "Treat the following as one cumulative multi-turn theme design conversation.\n\nInitial request:\n科幻风"
      },
      signal()
    );

    expect(draft.validation.valid).toBe(true);
    expect(draft.manifest.name).toBe("科幻风");
    expect(draft.manifest.primaryColor).toBe("#00E5FF");
    expect(draft.previewHtml).toContain("GALLEY THEME LAB");
    expect(draft.previewHtml).toContain('data-galley-theme-block="10"');
  });

  it("uses the local concept fallback for an empty provider response", async () => {
    const { service } = harness([new AiError("invalid_response")]);

    await expect(
      service.generate({ description: "科幻风" }, signal())
    ).resolves.toMatchObject({
      manifest: {
        name: "科幻风",
        primaryColor: "#00E5FF"
      },
      validation: { valid: true }
    });
  });

  it("builds and persists the complete theme only after explicit finalization", async () => {
    const { client, repository, service } = harness([
      completed(themeConceptResponse()),
      completed(themeComponentLibraryResponse())
    ]);
    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );
    const stages: ThemeGenerationStage[] = [];

    await expect(repository.list()).resolves.toEqual([]);
    const finalized = await service.finalizeAndSave(
      draft,
      signal(),
      (stage) => stages.push(stage)
    );

    expect(stages).toEqual([
      "loading-rules",
      "finalizing",
      "validating",
      "saving"
    ]);
    expect(finalized.finalized).toBe(true);
    expect(finalized.componentLibrary).toBe(validComponentLibrary());
    expect(finalized.previewHtml).toContain('data-galley-theme-block="10"');
    for (const path of THEME_GENERATION_REQUIRED_FILES) {
      expect(client.messagesText()).toContain(`<skill-file path="${path}">`);
    }
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.toMatchObject({
      componentLibrary: validComponentLibrary(),
      previewHtml: expect.stringContaining('data-galley-theme-block="10"')
    });
  });

  it("rejects an unsafe finalized package without persisting it", async () => {
    const unsafe = validComponentLibrary().replace(
      "<section",
      "<script>alert(1)</script><section"
    );
    const { repository, service } = harness([
      completed(themeConceptResponse()),
      completed(themeComponentLibraryResponse(unsafe)),
      completed(themeComponentLibraryResponse(unsafe))
    ]);
    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    await expect(service.finalizeAndSave(draft, signal())).rejects.toMatchObject({
      code: "theme_validation_failed"
    });
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("automatically repairs one invalid component library before saving", async () => {
    const unsafe = validComponentLibrary().replace(
      "<section",
      "<script>alert(1)</script><section"
    );
    const { client, repository, service } = harness([
      completed(themeConceptResponse()),
      completed(themeComponentLibraryResponse(unsafe)),
      completed(themeComponentLibraryResponse())
    ]);
    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    const finalized = await service.finalizeAndSave(draft, signal());

    expect(finalized.validation.valid).toBe(true);
    expect(finalized.componentLibrary).toBe(validComponentLibrary());
    expect(client.requests).toHaveLength(3);
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.toMatchObject({
      componentLibrary: validComponentLibrary()
    });
  });

  it("accepts JSON wrapped in prose and direct Markdown component output", async () => {
    const { repository, service } = harness([
      completed(
        `Here is the concept:\n\n\`\`\`json\n${themeConceptResponse()}\n\`\`\``
      ),
      completed(`Here is the completed library:\n\n${validComponentLibrary()}`)
    ]);
    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    await expect(
      service.finalizeAndSave(draft, signal())
    ).resolves.toMatchObject({
      componentLibrary: validComponentLibrary(),
      finalized: true
    });
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.not.toBeNull();
  });

  it("never sends a selected image when vision capability is absent", async () => {
    const { client, service } = harness([]);
    await expect(service.generate({
      description: "Ocean colors from this reference",
      referenceImage: {
        selected: true,
        name: "ocean.png",
        mimeType: "image/png",
        bytes: tinyPng()
      }
    }, signal())).rejects.toMatchObject({ code: "vision_unavailable" });
    expect(client.requests).toHaveLength(0);
  });

  it("sends a validated explicit image only with the lightweight concept request", async () => {
    const { client, service } = harness(
      [completed(themeConceptResponse())],
      makeProviderCapabilities({ tools: false, vision: true })
    );
    await service.generate({
      description: "Ocean colors from this reference",
      referenceImage: {
        selected: true,
        name: "ocean.png",
        mimeType: "image/png",
        bytes: tinyPng()
      }
    }, signal());

    const content = client.requests.at(-1)?.messages.at(-1)?.content;
    expect(content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "text" }),
      expect.objectContaining({
        type: "image_url",
        image_url: expect.objectContaining({
          url: expect.stringMatching(/^data:image\/png;base64,/u)
        })
      })
    ]));
  });

  it.each([
    ["duplicate", validThemeConceptPreview().replace('block="10"', 'block="9"')],
    ["gap", validThemeConceptPreview().replace('block="10"', 'block="11"')],
    ["too many", validThemePreview()]
  ])("normalizes a %s lightweight preview", async (_label, previewHtml) => {
    const { service } = harness([
      completed(themeConceptResponse({ previewHtml }))
    ]);

    const draft = await service.generate(
      { description: "Concept marker regression" },
      signal()
    );

    const document = new DOMParser().parseFromString(
      draft.previewHtml,
      "text/html"
    );
    const markers = [
      ...document.querySelectorAll("[data-galley-theme-block]")
    ].map((element) => element.getAttribute("data-galley-theme-block"));
    expect(draft.validation.valid).toBe(true);
    expect(markers.length).toBeGreaterThanOrEqual(8);
    expect(markers.length).toBeLessThanOrEqual(12);
    expect(markers).toEqual(markers.map((_, index) => String(index + 1)));
  });
});

describe("reference image validation", () => {
  it("enforces explicit selection, MIME/magic agreement, and the 10 MiB limit", () => {
    expect(() => validateReferenceImage({
      selected: false,
      name: "x.png",
      mimeType: "image/png",
      bytes: tinyPng()
    })).toThrow("explicitly selected");
    expect(() => validateReferenceImage({
      selected: true,
      name: "x.jpg",
      mimeType: "image/jpeg",
      bytes: tinyPng()
    })).toThrow("does not match");
    expect(() => validateReferenceImage({
      selected: true,
      name: "huge.png",
      mimeType: "image/png",
      bytes: new Uint8Array(10 * 1024 * 1024 + 1)
    })).toThrow("10 MiB");
  });
});
