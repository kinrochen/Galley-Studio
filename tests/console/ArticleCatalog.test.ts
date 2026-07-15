import { describe, expect, it, vi } from "vitest";
import { ArticleCatalog } from "../../src/console/ArticleCatalog";
import {
  GalleySidecarV1Schema,
  sha256Text
} from "../../src/documents/GalleySidecar";

const HTML = "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>Valid</title></head><body><main data-galley-content><p>Body</p></main></body></html>";

describe("ArticleCatalog", () => {
  it("lists valid canonical pairs and isolates incomplete or invalid pairs", async () => {
    const validSidecar = await sidecarFor(HTML, "notes/source.md");
    const vault = new CatalogVault({
      "notes/valid.galley.html": { text: HTML, mtime: 30 },
      "notes/valid.galley.json": {
        text: JSON.stringify(validSidecar),
        mtime: 20
      },
      "notes/missing.galley.html": { text: HTML, mtime: 50 },
      "notes/orphan.galley.json": {
        text: JSON.stringify(validSidecar),
        mtime: 40
      },
      "notes/invalid.galley.html": { text: HTML, mtime: 10 },
      "notes/invalid.galley.json": { text: "not json", mtime: 10 },
      "notes/ordinary.html": { text: HTML, mtime: 100 }
    });

    const snapshot = await new ArticleCatalog(vault).snapshot();

    expect(snapshot.documents).toEqual([
      expect.objectContaining({
        htmlPath: "notes/valid.galley.html",
        sidecarPath: "notes/valid.galley.json",
        sourcePath: "notes/source.md",
        modifiedAt: 30
      })
    ]);
    expect(snapshot.unavailable).toEqual([
      { path: "notes/invalid.galley.html", reason: "invalid_sidecar" },
      { path: "notes/missing.galley.html", reason: "missing_sidecar" },
      { path: "notes/orphan.galley.json", reason: "missing_html" }
    ]);
  });

  it("rejects a well-formed sidecar whose HTML hash does not match", async () => {
    const vault = new CatalogVault({
      "a.galley.html": { text: HTML, mtime: 1 },
      "a.galley.json": {
        text: JSON.stringify(await sidecarFor(`${HTML}changed`, "a.md")),
        mtime: 1
      }
    });

    expect((await new ArticleCatalog(vault).snapshot()).unavailable).toEqual([
      { path: "a.galley.html", reason: "html_hash_mismatch" }
    ]);
  });

  it("invalidates on pair mutations, notifies subscribers, and disposes once", async () => {
    const vault = new CatalogVault({});
    const catalog = new ArticleCatalog(vault);
    const changed = vi.fn();
    catalog.subscribe(changed);
    await catalog.snapshot();

    vault.emit("create");
    vault.emit("modify");
    vault.emit("rename");
    vault.emit("delete");

    expect(changed).toHaveBeenCalledTimes(4);
    expect(vault.scanCount).toBe(1);
    await catalog.snapshot();
    expect(vault.scanCount).toBe(2);

    catalog.dispose();
    catalog.dispose();
    expect(vault.offref).toHaveBeenCalledTimes(4);
    vault.emit("create");
    expect(changed).toHaveBeenCalledTimes(4);
  });
});

async function sidecarFor(html: string, sourcePath: string) {
  return GalleySidecarV1Schema.parse({
    schemaVersion: 1,
    documentId: "00000000-0000-4000-8000-000000000001",
    sourcePath,
    sourceHash: "a".repeat(64),
    htmlHash: await sha256Text(html),
    themeId: "paper-lab",
    skillVersion: "bundled",
    skillLoadMode: "tool-calls",
    skillFiles: ["SKILL.md", "references/theme-index.md"],
    model: "model-x",
    promptVersion: 1,
    generatedAt: "2026-07-15T00:00:00.000Z",
    validation: { valid: true, issues: [] },
    exports: []
  });
}

class CatalogVault {
  scanCount = 0;
  readonly offref = vi.fn((ref: { event: string; callback: () => void }) => {
    this.listeners.get(ref.event)?.delete(ref.callback);
  });
  readonly listeners = new Map<string, Set<() => void>>();

  constructor(
    readonly initial: Record<string, { text: string; mtime: number }>
  ) {}

  getFiles() {
    this.scanCount += 1;
    return Object.entries(this.initial).map(([path, value]) => ({
      path,
      name: path.split("/").at(-1) ?? path,
      stat: { mtime: value.mtime, ctime: value.mtime, size: value.text.length }
    }));
  }

  async read(file: { path: string }): Promise<string> {
    const value = this.initial[file.path];
    if (!value) throw new Error("missing file");
    return value.text;
  }

  on(event: string, callback: () => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(callback);
    this.listeners.set(event, listeners);
    return { event, callback };
  }

  emit(event: string): void {
    for (const callback of [...(this.listeners.get(event) ?? [])]) callback();
  }
}
