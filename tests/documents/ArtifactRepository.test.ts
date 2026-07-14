import { describe, expect, it, vi } from "vitest";

import {
  ArtifactRepository,
  type ArtifactVault
} from "../../src/documents/ArtifactRepository";
import {
  GalleySidecarV1Schema,
  type GalleySidecarV1
} from "../../src/documents/GalleySidecar";
import type { GeneratedDocument } from "../../src/generation/GenerationPipeline";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import { GRAPHITE_THEME } from "../support/generationFixtures";
import { memoryVault } from "../support/memoryVault";
import { TEST_PACKAGE_HASH } from "../support/phase1Factories";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const NOW = new Date("2026-07-14T08:09:10.123Z");
const HASH_PATTERN = /^[a-f0-9]{64}$/;

describe("GalleySidecarV1", () => {
  it("writes a strict, secret-free sidecar whose hashes cover the exact UTF-8 bytes", async () => {
    const markdown = "# 标题\r\n\r\nExact source bytes.\n";
    const document = makeDocument("verified", "<!DOCTYPE html>\n<p>精确 HTML</p>\n");
    const vault = memoryVault({ "notes/文章.v2.md": markdown });

    const paths = await makeRepository(vault).writeNew({
      sourcePath: "notes/文章.v2.md",
      markdown,
      document,
      model: "provider/model-v1"
    });

    const html = await vault.read(paths.html);
    const json = await vault.read(paths.sidecar);
    const sidecar = GalleySidecarV1Schema.parse(JSON.parse(json));
    expect(html).toBe(document.html);
    expect(sidecar).toEqual({
      schemaVersion: 1,
      documentId: UUID,
      sourcePath: "notes/文章.v2.md",
      sourceHash: await sha256(markdown),
      htmlHash: await sha256(document.html),
      themeId: GRAPHITE_THEME.id,
      skillVersion: "test-skill-version",
      skillLoadMode: "injected",
      skillFiles: [
        "SKILL.md",
        "references/theme-index.md",
        "references/theme-graphite-minimal.md"
      ],
      model: "provider/model-v1",
      promptVersion: 1,
      generatedAt: NOW.toISOString(),
      validation: { valid: true, issues: [] },
      exports: []
    });
    expect(sidecar.sourceHash).toMatch(HASH_PATTERN);
    expect(sidecar.htmlHash).toMatch(HASH_PATTERN);
    expect(json).not.toContain("secret");
    expect(json).not.toContain("Authorization");
    expect(json).not.toContain(markdown);
    expect(json).not.toContain(document.html);
  });

  it.each([
    ["unknown root field", { extra: true }],
    ["non-v1 schema", { schemaVersion: 2 }],
    ["non-UUID id", { documentId: "id" }],
    ["uppercase source hash", { sourceHash: "A".repeat(64) }],
    ["short HTML hash", { htmlHash: "a".repeat(63) }],
    ["absolute source path", { sourcePath: "/private/note.md" }],
    ["drive-letter source path", { sourcePath: "C:/note.md" }],
    ["traversing source path", { sourcePath: "notes/../note.md" }],
    ["empty source segment", { sourcePath: "notes//note.md" }],
    ["backslash source path", { sourcePath: "notes\\note.md" }],
    ["invalid timestamp", { generatedAt: "2026-07-14" }],
    ["unknown validation field", { validation: { valid: true, issues: [], raw: "no" } }],
    [
      "unknown issue field",
      {
        validation: {
          valid: false,
          issues: [
            {
              code: "missing_source",
              severity: "error",
              message: "Missing source.",
              providerBody: "no"
            }
          ]
        }
      }
    ],
    [
      "invalid issue severity",
      {
        validation: {
          valid: false,
          issues: [{ code: "x", severity: "fatal", message: "bad" }]
        }
      }
    ],
    ["unnormalized Skill path", { skillFiles: ["./SKILL.md"] }],
    ["nonempty exports", { exports: ["article.web.html"] }]
  ])("rejects %s", (_label, override) => {
    expect(() =>
      GalleySidecarV1Schema.parse({ ...validSidecar(), ...override })
    ).toThrow();
  });

  it("rejects an inconsistent validation report", () => {
    expect(() =>
      GalleySidecarV1Schema.parse({
        ...validSidecar(),
        validation: {
          valid: true,
          issues: [{ code: "bad", severity: "error", message: "Bad." }]
        }
      })
    ).toThrow();
  });
});

describe("ArtifactRepository", () => {
  it("numbers a pair when either final path exists and never overwrites", async () => {
    const vault = memoryVault({
      "notes/a.galley.html": "old HTML",
      "notes/a-2.galley.json": "old JSON"
    });

    const paths = await makeRepository(vault).writeNew(input("notes/a.md"));

    expect(paths).toEqual({
      html: "notes/a-3.galley.html",
      sidecar: "notes/a-3.galley.json"
    });
    expect(await vault.read("notes/a.galley.html")).toBe("old HTML");
    expect(await vault.read("notes/a-2.galley.json")).toBe("old JSON");
  });

  it("uses an unmistakable, collision-numbered paired label for unverified drafts", async () => {
    const vault = memoryVault({
      "draft.unverified.galley.json": "existing diagnostic"
    });

    const paths = await makeRepository(vault).writeNew({
      ...input("draft.md"),
      document: makeDocument("unverified")
    });

    expect(paths).toEqual({
      html: "draft-2.unverified.galley.html",
      sidecar: "draft-2.unverified.galley.json"
    });
  });

  it("supports Unicode and multiple dots, strips only the final Markdown extension, and ensures a configured root-relative folder", async () => {
    const vault = memoryVault();
    const repository = makeRepository(vault, { outputFolder: "发布/AI 结果" });

    const paths = await repository.writeNew(input("素材/文章.final.v3.MD"));

    expect(paths).toEqual({
      html: "发布/AI 结果/文章.final.v3.galley.html",
      sidecar: "发布/AI 结果/文章.final.v3.galley.json"
    });
    expect(vault.folders()).toContain("发布/AI 结果");
  });

  it.each([
    "/absolute/note.md",
    "C:/note.md",
    "notes/../note.md",
    "notes//note.md",
    "notes\\note.md",
    "notes/note.txt",
    ""
  ])("rejects invalid source path %j before writing", async (sourcePath) => {
    const vault = memoryVault();
    await expect(
      makeRepository(vault).writeNew(input(sourcePath))
    ).rejects.toThrow("Invalid source path");
    expect(vault.paths()).toEqual([]);
  });

  it.each([
    "/output",
    "C:/output",
    "../output",
    "output/../elsewhere",
    "output//nested",
    "output\\nested",
    "."
  ])("rejects invalid configured folder %j before writing", async (outputFolder) => {
    const vault = memoryVault();
    expect(() => makeRepository(vault, { outputFolder })).toThrow(
      "Invalid Galley output folder"
    );
    expect(vault.paths()).toEqual([]);
  });

  it.each([
    ["first temporary create", { create: 1 }],
    ["second temporary create", { create: 2 }],
    ["first rename", { rename: 1 }],
    ["second rename", { rename: 2 }]
  ] as const)("rolls back files created by this attempt after %s failure", async (_label, failures) => {
    const vault = new FailureVault(failures);

    await expect(
      makeRepository(vault).writeNew(input("note.md"))
    ).rejects.toThrow("injected failure");

    expect(vault.paths()).toEqual([]);
    expect(vault.operations).not.toContainEqual(
      expect.objectContaining({ operation: "modify" })
    );
  });

  it("preserves a pre-existing second-temp collision while cleaning only its own first temp", async () => {
    const jsonTemp = `.note.galley-tmp-${UUID}-1.json`;
    const vault = memoryVault({ [jsonTemp]: "pre-existing" });

    await expect(
      makeRepository(vault).writeNew(input("note.md"))
    ).rejects.toThrow();

    expect(await vault.read(jsonTemp)).toBe("pre-existing");
    expect(vault.paths()).toEqual([jsonTemp]);
  });

  it("preserves the original write failure when best-effort cleanup also fails", async () => {
    const original = new Error("injected failure: second rename");
    const vault = new FailureVault({ rename: 2, remove: 1 }, original);

    await expect(
      makeRepository(vault).writeNew(input("note.md"))
    ).rejects.toBe(original);
  });

  it("retries a newly occupied pair without overwriting either raced file", async () => {
    const vault = new CollisionRaceVault();

    const paths = await makeRepository(vault).writeNew(input("note.md"));

    expect(paths).toEqual({
      html: "note-2.galley.html",
      sidecar: "note-2.galley.json"
    });
    expect(await vault.read("note.galley.html")).toBe("raced HTML");
    expect(await vault.read("note.galley.json")).toBe("raced JSON");
  });

  it("rolls back its renamed HTML and retries when the sidecar destination races", async () => {
    const vault = new SidecarCollisionRaceVault();

    const paths = await makeRepository(vault).writeNew(input("note.md"));

    expect(paths).toEqual({
      html: "note-2.galley.html",
      sidecar: "note-2.galley.json"
    });
    expect(vault.paths()).not.toContain("note.galley.html");
    expect(await vault.read("note.galley.json")).toBe("raced JSON");
  });

  it("does not create anything when serialization fails", async () => {
    const vault = memoryVault();
    const failure = new Error("serialization failed");

    await expect(
      makeRepository(vault, {
        serialize: () => {
          throw failure;
        }
      }).writeNew(input("note.md"))
    ).rejects.toBe(failure);

    expect(vault.paths()).toEqual([]);
  });

  it("keeps the source byte-identical and never calls a modify operation", async () => {
    const markdown = "# Original\r\n\0 source bytes\n";
    const vault = memoryVault({ "source.md": markdown });
    const modify = vi.spyOn(vault, "modify");

    await makeRepository(vault).writeNew({
      ...input("source.md"),
      markdown
    });

    expect(await vault.read("source.md")).toBe(markdown);
    expect(modify).not.toHaveBeenCalled();
  });

  it("aborts between atomic stages and removes all files from the attempt", async () => {
    const controller = new AbortController();
    const vault = new AbortAfterCreateVault(controller);

    await expect(
      makeRepository(vault).writeNew(input("note.md"), controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(vault.paths()).toEqual([]);
  });
});

function makeRepository(
  vault: ArtifactVault,
  overrides: {
    outputFolder?: string;
    serialize?: (value: GalleySidecarV1) => string;
  } = {}
): ArtifactRepository {
  return new ArtifactRepository(vault, {
    now: () => NOW,
    randomUUID: () => UUID,
    ...overrides
  });
}

function input(sourcePath: string) {
  return {
    sourcePath,
    markdown: "# Original source\n",
    document: makeDocument("verified"),
    model: "test-model"
  };
}

function makeDocument(
  status: GeneratedDocument["status"],
  html = "<!DOCTYPE html><html><body><article>safe</article></body></html>"
): GeneratedDocument {
  return {
    status,
    html,
    theme: GRAPHITE_THEME,
    source: annotateMarkdown("# Original source\n"),
    validation:
      status === "verified"
        ? { valid: true, issues: [] }
        : {
            valid: false,
            issues: [
              {
                code: "missing_source",
                severity: "error",
                message: "A source block is missing.",
                sourceId: "g-0001",
                selector: "article"
              }
            ]
          },
    skillAudit: {
      skillId: "gzh-design",
      skillVersion: "test-skill-version",
      packageHash: TEST_PACKAGE_HASH,
      loadMode: "injected",
      files: [
        "SKILL.md",
        "references/theme-index.md",
        "references/theme-graphite-minimal.md"
      ]
    },
    diagnostics: []
  };
}

function validSidecar(): GalleySidecarV1 {
  return {
    schemaVersion: 1,
    documentId: UUID,
    sourcePath: "note.md",
    sourceHash: "a".repeat(64),
    htmlHash: "b".repeat(64),
    themeId: "graphite-minimal",
    skillVersion: "test-version",
    skillLoadMode: "tool-calls",
    skillFiles: ["SKILL.md"],
    model: "model",
    promptVersion: 1,
    generatedAt: NOW.toISOString(),
    validation: { valid: true, issues: [] },
    exports: []
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class FailureVault implements ArtifactVault {
  readonly files = new Map<string, string>();
  readonly operations: Array<{ operation: string; path: string }> = [];
  readonly #counts = { create: 0, rename: 0, remove: 0 };

  constructor(
    private readonly failures: {
      create?: number;
      rename?: number;
      remove?: number;
    },
    private readonly renameFailure = new Error("injected failure")
  ) {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async ensureFolder(_path: string): Promise<void> {}

  async create(path: string, contents: string): Promise<void> {
    this.#counts.create += 1;
    this.operations.push({ operation: "create", path });
    if (this.#counts.create === this.failures.create) {
      throw new Error("injected failure: create");
    }
    if (this.files.has(path)) {
      throw new Error("exists");
    }
    this.files.set(path, contents);
  }

  async rename(from: string, to: string): Promise<void> {
    this.#counts.rename += 1;
    this.operations.push({ operation: "rename", path: to });
    if (this.#counts.rename === this.failures.rename) {
      throw this.renameFailure;
    }
    const contents = this.files.get(from);
    if (contents === undefined || this.files.has(to)) {
      throw new Error("rename collision");
    }
    this.files.delete(from);
    this.files.set(to, contents);
  }

  async remove(path: string): Promise<void> {
    this.#counts.remove += 1;
    this.operations.push({ operation: "remove", path });
    if (this.#counts.remove === this.failures.remove) {
      throw new Error("injected failure: cleanup");
    }
    this.files.delete(path);
  }

  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}

class CollisionRaceVault extends FailureVault {
  #raced = false;

  constructor() {
    super({});
  }

  override async rename(from: string, to: string): Promise<void> {
    if (!this.#raced && to === "note.galley.html") {
      this.#raced = true;
      this.files.set("note.galley.html", "raced HTML");
      this.files.set("note.galley.json", "raced JSON");
    }
    await super.rename(from, to);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error("missing");
    }
    return value;
  }
}

class SidecarCollisionRaceVault extends FailureVault {
  #raced = false;

  constructor() {
    super({});
  }

  override async rename(from: string, to: string): Promise<void> {
    if (!this.#raced && to === "note.galley.json") {
      this.#raced = true;
      this.files.set(to, "raced JSON");
    }
    await super.rename(from, to);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) {
      throw new Error("missing");
    }
    return value;
  }
}

class AbortAfterCreateVault extends FailureVault {
  #creates = 0;

  constructor(private readonly controller: AbortController) {
    super({});
  }

  override async create(path: string, contents: string): Promise<void> {
    await super.create(path, contents);
    this.#creates += 1;
    if (this.#creates === 2) {
      this.controller.abort();
    }
  }
}
