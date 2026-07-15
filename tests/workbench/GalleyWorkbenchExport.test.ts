import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPORT_CONFIGURATIONS } from "../../src/export/ExportConfiguration";
import type { HtmlEditorAdapter, HtmlEditorMountOptions } from "../../src/editor/HtmlEditorAdapter";
import {
  GalleyWorkbenchView,
  type WorkbenchDocument,
  type WorkbenchSession
} from "../../src/workbench/GalleyWorkbenchView";

describe("GalleyWorkbenchView export flow", () => {
  it("saves the latest visual edit before exporting and reports the standalone path", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("notes/a.galley.html");
    fixture.editor.emit("<article><p>latest visual bytes</p></article>");

    await fixture.view.exportCurrent("standard-web", false);

    expect(fixture.session.save).toHaveBeenCalledWith("explicit");
    expect(fixture.exportDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        session: fixture.session,
        configuration: expect.objectContaining({ profileId: "standard-web" })
      }),
      expect.any(AbortSignal)
    );
    expect(fixture.exportDocument.mock.calls[0]?.[0].session.bodyHtml()).toContain("latest visual bytes");
    expect(fixture.view.contentEl.querySelector("[data-export-status]")?.textContent)
      .toContain("exports/standard.html");
  });

  it("copies the exported rich HTML and exposes failures without claiming success", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("notes/a.galley.html");
    await fixture.view.exportCurrent("wechat", true);
    expect(fixture.copyHtml).toHaveBeenCalledWith('<section><span leaf="">copy</span></section>');
    expect((fixture.view.contentEl.querySelector("[data-export-status]") as HTMLElement | null)?.dataset.exportStatus)
      .toBe("copied");

    fixture.exportDocument.mockRejectedValueOnce(
      Object.assign(new Error("failed"), { code: "export_validation_failed" })
    );
    await expect(fixture.view.exportCurrent("wechat", false)).rejects.toThrow("failed");
    expect((fixture.view.contentEl.querySelector("[data-export-status]") as HTMLElement | null)?.dataset.exportStatus)
      .toBe("error");
    expect(fixture.view.contentEl.querySelector("[data-export-status]")?.textContent)
      .toBe("Export failed");
  });

  it("persists and reuses a saved export configuration through the panel", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("notes/a.galley.html");
    const name = fixture.view.contentEl.querySelector("input[data-export-field=name]") as HTMLInputElement;
    name.value = "Reusable client handoff";
    (fixture.view.contentEl.querySelector("button[data-export-action=save-config]") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fixture.saveExportConfiguration).toHaveBeenCalledWith(
      expect.objectContaining({ id: "standard-web", name: "Reusable client handoff" })
    ));
    expect(fixture.view.contentEl.querySelector("select[data-export-configuration]")?.textContent)
      .toContain("Reusable client handoff");
  });

  it("ignores a delayed exporter after another document opens", async () => {
    const fixture = makeFixture();
    let resolve!: (value: { path: string; html: string }) => void;
    fixture.exportDocument.mockImplementationOnce(
      async () => new Promise((done) => { resolve = done; })
    );
    await fixture.view.openPath("notes/a.galley.html");
    const exporting = fixture.view.exportCurrent("wechat", true);

    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await fixture.view.openPath("notes/b.galley.html");
    resolve({ path: "exports/stale.html", html: "<section>stale</section>" });
    await exporting;

    expect(fixture.copyHtml).not.toHaveBeenCalled();
    expect(fixture.view.currentState().documentPath).toBe("notes/b.galley.html");
    expect(fixture.view.contentEl.textContent).not.toContain("stale.html");
  });

  it("does not rebuild the shell when a delayed exporter completes after close", async () => {
    const fixture = makeFixture();
    let resolve!: (value: { path: string; html: string }) => void;
    fixture.exportDocument.mockImplementationOnce(
      async () => new Promise((done) => { resolve = done; })
    );
    await fixture.view.openPath("notes/a.galley.html");
    const exporting = fixture.view.exportCurrent("standard-web", false);

    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await fixture.view.onClose();
    resolve({ path: "exports/stale.html", html: "stale" });
    await exporting;

    expect(fixture.view.contentEl.children).toHaveLength(0);
  });
});

class Editor implements HtmlEditorAdapter {
  html = "";
  options: HtmlEditorMountOptions | null = null;
  async mount(_host: HTMLElement, html: string, options: HtmlEditorMountOptions): Promise<void> {
    this.html = html;
    this.options = options;
  }
  getHtml(): string { return this.html; }
  setHtml(html: string): void { this.html = html; }
  focus(): void {}
  destroy(): void {}
  emit(html: string): void { this.html = html; this.options?.onChange(html); }
}

class Session implements WorkbenchSession {
  #body = "<article><p>initial</p></article>";
  #dirty = false;
  readonly save = vi.fn(async () => { this.#dirty = false; });
  html(): string {
    return `<!DOCTYPE html><html lang="zh-CN"><head><title>x</title></head><body>${this.#body}</body></html>`;
  }
  bodyHtml(): string { return this.#body; }
  updateBody(body: string): void { this.#body = body; this.#dirty = true; }
  state() {
    return {
      dirty: this.#dirty,
      saving: false,
      conflict: false,
      htmlHash: "a".repeat(64),
      sourceChanged: false,
      lastSavedAt: this.#dirty ? null : "2026-07-15T00:00:00.000Z"
    };
  }
  async reload(): Promise<void> {}
  async saveCopy() { return { html: "copy.galley.html", sidecar: "copy.galley.json" }; }
}

function makeFixture() {
  const session = new Session();
  const document: WorkbenchDocument = {
    session,
    listHistory: vi.fn(async () => []),
    recovery: { status: "ready", quarantinedTransactionId: null }
  };
  const editor = new Editor();
  const exportDocument = vi.fn(async (_input: {
    session: WorkbenchSession;
    configuration: { profileId: string };
  }) => ({
    path: "exports/standard.html",
    html: '<section><span leaf="">copy</span></section>'
  }));
  const copyHtml = vi.fn(async () => undefined);
  const saveExportConfiguration = vi.fn(async (configuration) => [
    { ...configuration },
    ...DEFAULT_EXPORT_CONFIGURATIONS.filter(({ id }) => id !== configuration.id)
  ]);
  const view = new GalleyWorkbenchView(new WorkspaceLeaf(), {
    capabilities: { canGenerate: true, canEdit: true, canImportSkill: true, canPreview: true },
    openDocument: vi.fn(async () => document),
    createVisualEditor: async () => editor,
    createSourceEditor: () => new Editor(),
    openCopy: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    exportConfigurations: DEFAULT_EXPORT_CONFIGURATIONS,
    exportDocument,
    copyExportHtml: copyHtml,
    saveExportConfiguration
  });
  return { view, editor, session, exportDocument, copyHtml, saveExportConfiguration };
}
