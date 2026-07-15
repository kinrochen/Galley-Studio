import { describe, expect, it } from "vitest";

import type { ChatTurnResult } from "../../src/ai/AiProtocol";
import { SkillSession } from "../../src/skill/SkillSession";
import { SkillVirtualFileSystem } from "../../src/skill/SkillVirtualFileSystem";
import {
  ThemeGenerationService,
  THEME_GENERATION_REQUIRED_FILES
} from "../../src/theme-lab/ThemeGenerationService";
import { validateReferenceImage } from "../../src/theme-lab/ReferenceImage";
import type {
  AtomicThemeStore,
  StoredThemeFiles,
  StoredThemeRecord
} from "../../src/themes/CustomThemeRepository";
import { CustomThemeRepository } from "../../src/themes/CustomThemeRepository";
import { ScriptedChatClient } from "../support/ScriptedChatClient";
import { makeProviderCapabilities, TEST_PACKAGE_HASH } from "../support/phase1Factories";
import {
  CUSTOM_THEME_ID,
  themeIndexMarkdown,
  themeModelResponse,
  tinyPng,
  validComponentLibrary,
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
  steps: ChatTurnResult[],
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

describe("AI Theme Lab generation", () => {
  it("loads every required file through tool calls before generating direct HTML", async () => {
    const toolCalls = THEME_GENERATION_REQUIRED_FILES.map((path, index) => ({
      id: `read-${index}`,
      name: "read_skill_file",
      argumentsJson: JSON.stringify({ path })
    }));
    const { client, service } = harness(
      [
        { content: "", toolCalls, finishReason: "tool_calls" },
        completed("loaded"),
        completed(themeModelResponse())
      ],
      makeProviderCapabilities({ tools: true, vision: false })
    );

    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    expect(draft.validation.valid).toBe(true);
    expect(draft.previewHtml).not.toMatch(/<script\b/iu);
    expect(draft.skillAudit.files).toEqual(THEME_GENERATION_REQUIRED_FILES);
    expect(draft.skillAudit.loadMode).toBe("tool-calls");
    expect(client.requests.at(-1)?.messages.at(-1)?.content).toEqual(
      expect.stringContaining("Return the complete theme preview HTML directly")
    );
  });

  it("fully injects the same required files when tools are unavailable", async () => {
    const { client, service } = harness([completed(themeModelResponse())]);

    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    expect(draft.skillAudit.loadMode).toBe("injected");
    for (const path of THEME_GENERATION_REQUIRED_FILES) {
      expect(client.messagesText()).toContain(`<skill-file path="${path}">`);
    }
  });

  it("does not persist a valid draft until explicit save", async () => {
    const { repository, service } = harness([completed(themeModelResponse())]);
    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );

    await expect(repository.list()).resolves.toEqual([]);
    await service.save(draft);
    await expect(repository.get(CUSTOM_THEME_ID)).resolves.toMatchObject({
      componentLibrary: validComponentLibrary(),
      previewHtml: expect.stringContaining("data-galley-theme-block=\"45\"")
    });
  });

  it("returns lint errors and refuses to save an unsafe or incomplete draft", async () => {
    const { repository, service } = harness([
      completed(themeModelResponse({
        componentLibrary: validComponentLibrary().replace(
          "<section",
          "<script>alert(1)</script><section"
        ),
        previewHtml: validThemePreview().replace(
          "</article>",
          "<script>alert(1)</script></article>"
        )
      }))
    ]);

    const draft = await service.generate(
      { description: "A calm ocean research notebook" },
      signal()
    );
    expect(draft.validation.valid).toBe(false);
    expect(draft.validation.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["component_script", "preview_script"])
    );
    await expect(service.save(draft)).rejects.toMatchObject({
      code: "theme_validation_failed"
    });
    await expect(repository.list()).resolves.toEqual([]);
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

  it("sends a validated explicit image only in the final vision request", async () => {
    const { client, service } = harness(
      [completed(themeModelResponse())],
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
    ["duplicate", (html: string) => html.replace('block="45"', 'block="44"')],
    ["gap", (html: string) => html.replace('block="45"', 'block="46"')],
    ["out of order", (html: string) => html
      .replace('block="1"', 'block="swap"')
      .replace('block="2"', 'block="1"')
      .replace('block="swap"', 'block="2"')],
    ["empty", (html: string) => html.replace('block="1"', 'block=""')],
    ["non-numeric", (html: string) => html.replace('block="1"', 'block="one"')]
  ])("rejects %s preview markers instead of accepting count alone", async (_label, mutate) => {
    const { service } = harness([
      completed(themeModelResponse({ previewHtml: mutate(validThemePreview()) }))
    ]);

    const draft = await service.generate(
      { description: "Marker contract regression" },
      signal()
    );

    expect(draft.validation.valid).toBe(false);
    expect(draft.validation.issues.map(({ code }) => code)).toContain(
      "preview_block_sequence"
    );
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
