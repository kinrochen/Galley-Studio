import { WorkspaceLeaf } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HtmlEditorAdapter,
  HtmlEditorMountOptions
} from "../../src/editor/HtmlEditorAdapter";
import {
  GALLEY_WORKBENCH_VIEW_TYPE,
  GalleyWorkbenchView,
  type WorkbenchDocument,
  type WorkbenchSession
} from "../../src/workbench/GalleyWorkbenchView";
import type { HistorySnapshot } from "../../src/documents/HistoryRepository";

const HTML = "<!DOCTYPE html><html lang=\"en\"><head><title>x</title></head><body><article><h1 data-galley-source=\"h-1\">Title</h1><p>one</p></article></body></html>";

afterEach(() => vi.useRealTimers());

describe("GalleyWorkbenchView", () => {
  it("opens a strict Galley pair into the approved four-region desktop shell", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("notes/a.galley.html");

    expect(fixture.view.getViewType()).toBe(GALLEY_WORKBENCH_VIEW_TYPE);
    expect(fixture.view.contentEl.querySelector(".galley-toolbar")).not.toBeNull();
    expect(fixture.view.contentEl.querySelector(".galley-left-rail")).not.toBeNull();
    expect(fixture.view.contentEl.querySelector(".galley-canvas")).not.toBeNull();
    expect(fixture.view.contentEl.querySelector(".galley-inspector")).not.toBeNull();
    expect(fixture.visual.mountCalls).toHaveLength(1);
    expect(fixture.visual.mountCalls[0]?.html).toContain("<article>");
    expect(fixture.view.currentState()).toMatchObject({
      mode: "visual",
      documentPath: "notes/a.galley.html",
      sourceChanged: true
    });
  });

  it("rejects ordinary HTML and sidecars before asking the opener", async () => {
    const fixture = makeFixture();
    await expect(fixture.view.openPath("notes/a.html")).rejects.toMatchObject({
      code: "galley_path_invalid"
    });
    await expect(fixture.view.openPath("notes/a.galley.json")).rejects.toMatchObject({
      code: "galley_path_invalid"
    });
    expect(fixture.openDocument).not.toHaveBeenCalled();
  });

  it("captures body edits and destroys each adapter exactly once across modes and close", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>visual edit</p></article>");
    await fixture.view.selectMode("preview");
    expect(fixture.visual.destroyCalls).toBe(1);
    expect(fixture.session.bodyHtml()).toContain("visual edit");
    const frame = fixture.view.contentEl.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");

    await fixture.view.selectMode("source");
    expect(fixture.source.mountCalls).toHaveLength(1);
    fixture.source.emit("<article><p>source edit</p></article>");
    await fixture.view.onClose();
    await fixture.view.onClose();
    expect(fixture.source.destroyCalls).toBe(1);
    expect(fixture.visual.destroyCalls).toBe(1);
  });

  it("flushes a dirty edit on close before the 800ms debounce expires", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture();
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>close-safe edit</p></article>");
    await vi.advanceTimersByTimeAsync(100);

    await fixture.view.onClose();

    expect(fixture.session.save).toHaveBeenCalledWith("auto");
    expect(fixture.visual.destroyCalls).toBe(1);
  });

  it("saves the current dirty document before the same view opens another path", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture();
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>first document edit</p></article>");

    await fixture.view.openPath("b.galley.html");

    expect(fixture.session.save).toHaveBeenCalledWith("auto");
    expect(fixture.openDocument).toHaveBeenNthCalledWith(2, "b.galley.html");
  });

  it("does not silently tear down a conflicted dirty close", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture({ conflictOnAuto: true });
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>conflicted close</p></article>");

    await expect(fixture.view.onClose()).rejects.toMatchObject({
      code: "document_conflict"
    });
    expect(fixture.visual.destroyCalls).toBe(0);
    expect(fixture.view.currentState()).toMatchObject({ dirty: true, conflict: true });
  });

  it("autosaves 800ms after the latest visual change and refreshes history", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture();
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>first</p></article>");
    await vi.advanceTimersByTimeAsync(500);
    fixture.visual.emit("<article><p>latest</p></article>");
    await vi.advanceTimersByTimeAsync(799);
    expect(fixture.session.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.session.save).toHaveBeenCalledWith("auto");
    expect(fixture.document.listHistory).toHaveBeenCalled();
    expect(fixture.view.currentState().dirty).toBe(false);
  });

  it("serializes a slow explicit save with an in-flight edit and eventually autosaves the newer revision", async () => {
    vi.useFakeTimers();
    const session = new SlowRevisionSession();
    const fixture = makeCustomFixture(session);
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>explicit revision</p></article>");

    const explicit = fixture.view.saveExplicit();
    await settleMicrotasks();
    expect(session.saveCalls).toEqual(["explicit"]);

    fixture.visual.emit("<article><p>newer autosave revision</p></article>");
    await vi.advanceTimersByTimeAsync(800);
    expect(session.saveCalls).toEqual(["explicit"]);

    session.releaseNextSave();
    await explicit;
    await settleMicrotasks();
    expect(session.saveCalls).toEqual(["explicit", "auto"]);
    expect(fixture.view.currentState()).toMatchObject({ dirty: true, saving: true });

    session.releaseNextSave();
    await settleMicrotasks();
    expect(session.persistedBody).toContain("newer autosave revision");
    expect(session.state().dirty).toBe(false);
    expect(fixture.view.currentState()).toMatchObject({ dirty: false, saving: false });
  });

  it("stops autosave on conflict and maps reload, copy, and overwrite explicitly", async () => {
    vi.useFakeTimers();
    const fixture = makeFixture({ conflictOnAuto: true });
    await fixture.view.openPath("a.galley.html");
    fixture.visual.emit("<article><p>local</p></article>");
    await vi.advanceTimersByTimeAsync(800);
    expect(fixture.view.currentState()).toMatchObject({ dirty: true, conflict: true });
    expect(fixture.view.contentEl.querySelector(".galley-conflict-banner")).not.toBeNull();

    await fixture.view.resolveConflict("overwrite");
    expect(fixture.session.save).toHaveBeenLastCalledWith("overwrite");
    fixture.session.forceConflict();
    await fixture.view.resolveConflict("save-copy");
    expect(fixture.session.saveCopy).toHaveBeenCalled();
    expect(fixture.openCopy).toHaveBeenCalledWith("a-copy.galley.html");
    fixture.session.forceConflict();
    await fixture.view.resolveConflict("reload");
    expect(fixture.session.reload).toHaveBeenCalled();
  });

  it("lists only the newest twenty history items and restores a snapshot as dirty", async () => {
    const history = Array.from({ length: 24 }, (_, index) => snapshot(index));
    const fixture = makeFixture({ history });
    await fixture.view.openPath("a.galley.html");
    const labels = [...fixture.view.contentEl.querySelectorAll(".galley-history-list button")]
      .map((element) => element.textContent);
    expect(labels).toHaveLength(20);
    expect(labels[0]).toContain("23");

    await fixture.view.restoreHistory(history[23] as HistorySnapshot);
    expect(fixture.session.bodyHtml()).toContain("history 23");
    expect(fixture.view.currentState().dirty).toBe(true);
    expect(fixture.session.save).not.toHaveBeenCalled();
  });

  it("uses preview only when editing capability is unavailable", async () => {
    const fixture = makeFixture({ canEdit: false });
    await fixture.view.openPath("a.galley.html");
    expect(fixture.visual.mountCalls).toHaveLength(0);
    expect(fixture.view.currentState().mode).toBe("preview");
    expect(fixture.view.contentEl.querySelector("iframe")).not.toBeNull();
    await expect(fixture.view.selectMode("visual")).rejects.toMatchObject({
      code: "visual_editor_unavailable"
    });
  });

  it.each(["a//b.galley.html", "./a.galley.html", "a/../b.galley.html"])(
    "rejects noncanonical Galley path %s",
    async (path) => {
      const fixture = makeFixture();
      await expect(fixture.view.openPath(path)).rejects.toMatchObject({
        code: "galley_path_invalid"
      });
    }
  );

  it("surfaces a typed production quarantine instead of rendering a partial document", async () => {
    const fixture = makeFixture();
    fixture.openDocument.mockRejectedValueOnce(
      Object.assign(new Error("quarantined"), {
        code: "galley_document_quarantined"
      })
    );

    await expect(fixture.view.openPath("a.galley.html")).rejects.toMatchObject({
      code: "galley_document_quarantined"
    });
    expect(fixture.view.currentState().recovery).toBe("quarantined");
    expect(fixture.view.contentEl.querySelector(".galley-workbench-warning")?.textContent)
      .toContain("quarantined");
    expect(fixture.visual.mountCalls).toHaveLength(0);
  });

  it("surfaces a typed production ambiguity instead of rendering a partial document", async () => {
    const fixture = makeFixture();
    fixture.openDocument.mockRejectedValueOnce(
      Object.assign(new Error("ambiguous"), {
        code: "galley_document_ambiguous"
      })
    );

    await expect(fixture.view.openPath("a.galley.html")).rejects.toMatchObject({
      code: "galley_document_ambiguous"
    });
    expect(fixture.view.currentState().recovery).toBe("ambiguous");
    expect(fixture.view.contentEl.querySelector(".galley-workbench-warning")?.textContent)
      .toContain("ambiguous");
    expect(fixture.visual.mountCalls).toHaveLength(0);
  });
});

class FakeEditor implements HtmlEditorAdapter {
  html = "";
  options: HtmlEditorMountOptions | null = null;
  destroyCalls = 0;
  readonly mountCalls: Array<{ host: HTMLElement; html: string }> = [];

  async mount(host: HTMLElement, html: string, options: HtmlEditorMountOptions): Promise<void> {
    this.html = html;
    this.options = options;
    this.mountCalls.push({ host, html });
  }
  getHtml(): string { return this.html; }
  setHtml(html: string): void { this.html = html; }
  focus(): void {}
  destroy(): void { this.destroyCalls += 1; }
  emit(html: string): void {
    this.html = html;
    this.options?.onChange(html);
  }
}

class FakeSession implements WorkbenchSession {
  #body = "<article><h1 data-galley-source=\"h-1\">Title</h1><p>one</p></article>";
  #dirty = false;
  #conflict = false;
  #conflictOnAuto: boolean;
  readonly save = vi.fn(async (reason: "auto" | "explicit" | "overwrite") => {
    if (this.#conflict && reason !== "overwrite") {
      throw Object.assign(new Error("conflict"), { code: "document_conflict" });
    }
    if (reason === "auto" && this.#conflictOnAuto) {
      this.#conflict = true;
      throw Object.assign(new Error("conflict"), { code: "document_conflict" });
    }
    this.#conflict = false;
    this.#dirty = false;
  });
  readonly reload = vi.fn(async () => {
    this.#body = "<article><p>external</p></article>";
    this.#dirty = false;
    this.#conflict = false;
  });
  readonly saveCopy = vi.fn(async () => ({
    html: "a-copy.galley.html",
    sidecar: "a-copy.galley.json"
  }));

  constructor(conflictOnAuto = false) { this.#conflictOnAuto = conflictOnAuto; }
  html(): string { return HTML.replace(/<body>[\s\S]*<\/body>/u, `<body>${this.#body}</body>`); }
  bodyHtml(): string { return this.#body; }
  updateBody(body: string): void { this.#body = body; this.#dirty = true; }
  state() {
    return {
      dirty: this.#dirty,
      saving: false,
      conflict: this.#conflict,
      htmlHash: "hash",
      sourceChanged: true,
      lastSavedAt: this.#dirty ? null : "2026-07-15T00:00:00.000Z"
    };
  }
  forceConflict(): void { this.#conflict = true; this.#dirty = true; }
}

class SlowRevisionSession implements WorkbenchSession {
  #body = "<article><p>initial</p></article>";
  #dirty = false;
  #saving = false;
  #revision = 0;
  #lastSavedAt: string | null = null;
  #pendingSaves: Array<() => void> = [];
  persistedBody = this.#body;
  readonly saveCalls: Array<"auto" | "explicit" | "overwrite"> = [];

  html(): string {
    return HTML.replace(/<body>[\s\S]*<\/body>/u, `<body>${this.#body}</body>`);
  }
  bodyHtml(): string { return this.#body; }
  updateBody(body: string): void {
    if (body === this.#body) return;
    this.#body = body;
    this.#revision += 1;
    this.#dirty = true;
  }
  state() {
    return {
      dirty: this.#dirty,
      saving: this.#saving,
      conflict: false,
      htmlHash: "hash",
      sourceChanged: true,
      lastSavedAt: this.#lastSavedAt
    };
  }
  async save(reason: "auto" | "explicit" | "overwrite"): Promise<void> {
    if (this.#saving) {
      throw Object.assign(new Error("save in progress"), {
        code: "document_save_in_progress"
      });
    }
    this.#saving = true;
    this.saveCalls.push(reason);
    const revision = this.#revision;
    const body = this.#body;
    await new Promise<void>((resolve) => this.#pendingSaves.push(resolve));
    this.persistedBody = body;
    if (this.#revision === revision) this.#dirty = false;
    this.#saving = false;
    this.#lastSavedAt = `2026-07-15T00:00:0${this.saveCalls.length}.000Z`;
  }
  releaseNextSave(): void {
    const release = this.#pendingSaves.shift();
    if (!release) throw new Error("No save is awaiting release.");
    release();
  }
  async reload(): Promise<void> {}
  async saveCopy(): Promise<{ html: string; sidecar: string }> {
    return { html: "copy.galley.html", sidecar: "copy.galley.json" };
  }
}

function makeFixture(options: {
  conflictOnAuto?: boolean;
  history?: HistorySnapshot[];
  canEdit?: boolean;
} = {}) {
  const session = new FakeSession(options.conflictOnAuto);
  const document: WorkbenchDocument = {
    session,
    listHistory: vi.fn(async () => options.history ?? []),
    recovery: { status: "ready", quarantinedTransactionId: null }
  };
  const visual = new FakeEditor();
  const source = new FakeEditor();
  const openDocument = vi.fn(async () => document);
  const openCopy = vi.fn(async () => undefined);
  const view = new GalleyWorkbenchView(new WorkspaceLeaf(), {
    capabilities: {
      canGenerate: options.canEdit ?? true,
      canEdit: options.canEdit ?? true,
      canImportSkill: options.canEdit ?? true,
      canPreview: true
    },
    openDocument,
    createVisualEditor: async () => visual,
    createSourceEditor: () => source,
    openCopy,
    confirm: async () => true
  });
  return { view, session, document, visual, source, openDocument, openCopy };
}

function makeCustomFixture(session: WorkbenchSession) {
  const document: WorkbenchDocument = {
    session,
    listHistory: vi.fn(async () => []),
    recovery: { status: "ready", quarantinedTransactionId: null }
  };
  const visual = new FakeEditor();
  const source = new FakeEditor();
  const view = new GalleyWorkbenchView(new WorkspaceLeaf(), {
    capabilities: {
      canGenerate: true,
      canEdit: true,
      canImportSkill: true,
      canPreview: true
    },
    openDocument: vi.fn(async () => document),
    createVisualEditor: async () => visual,
    createSourceEditor: () => source,
    openCopy: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true)
  });
  return { view, visual, source, document };
}

async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function snapshot(index: number): HistorySnapshot {
  return {
    path: `.galley/history/doc/${index}.html`,
    html: HTML.replace("<p>one</p>", `<p>history ${index}</p>`),
    timestamp: `2026-07-15T00:00:${String(index).padStart(2, "0")}.000Z`
  };
}
