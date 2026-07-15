import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_EXPORT_CONFIGURATIONS } from "../../src/export/ExportConfiguration";
import { DocumentSession } from "../../src/documents/DocumentSession";
import { ExportService } from "../../src/export/ExportService";
import { StandardWebProfile } from "../../src/export/profiles";
import type { HtmlEditorAdapter, HtmlEditorMountOptions } from "../../src/editor/HtmlEditorAdapter";
import {
  GalleyWorkbenchView,
  type WorkbenchDocument,
  type WorkbenchSession
} from "../../src/workbench/GalleyWorkbenchView";
import { makeSessionDeps } from "../support/workbenchFixtures";

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

  it("keeps the durable export path visible when clipboard copy fails", async () => {
    const fixture = makeFixture();
    fixture.copyHtml.mockRejectedValueOnce(new Error("clipboard denied"));
    await fixture.view.openPath("notes/a.galley.html");

    await expect(fixture.view.exportCurrent("wechat", true)).rejects.toThrow(
      "clipboard denied"
    );

    const status = fixture.view.contentEl.querySelector(
      "[data-export-status]"
    ) as HTMLElement;
    expect(status.dataset.exportStatus).toBe("error");
    expect(status.textContent).toBe(
      "Exported exports/standard.html; copy failed"
    );
  });

  it("does not misreport an ambiguous artifact write as a clipboard failure", async () => {
    const fixture = makeFixture();
    fixture.exportDocument.mockRejectedValueOnce(Object.assign(
      new Error("artifact identity could not be verified"),
      {
        code: "export_artifact_write_ambiguous",
        path: "exports/uncertain.html"
      }
    ));
    await fixture.view.openPath("notes/a.galley.html");

    await expect(fixture.view.exportCurrent("wechat", true)).rejects.toThrow(
      "artifact identity could not be verified"
    );

    expect(fixture.copyHtml).not.toHaveBeenCalled();
    expect(fixture.view.contentEl.querySelector("[data-export-status]")?.textContent)
      .toBe("Export outcome ambiguous at exports/uncertain.html");
  });

  it.each([
    ["not-recorded", "Exported exports/unrecorded.html; sidecar record not recorded"],
    ["recorded", "Exported exports/unrecorded.html; record committed before cancellation"],
    ["ambiguous", "Exported exports/unrecorded.html; sidecar record outcome ambiguous"]
  ] as const)("keeps the artifact path visible for a %s record outcome", async (outcome, message) => {
    const fixture = makeFixture();
    fixture.exportDocument.mockRejectedValueOnce(Object.assign(
      new Error("record failed"),
      {
        code: "export_record_failed",
        artifactPath: "exports/unrecorded.html",
        outcome
      }
    ));
    await fixture.view.openPath("notes/a.galley.html");

    await expect(fixture.view.exportCurrent("standard-web", false)).rejects.toThrow(
      "record failed"
    );

    expect(fixture.view.contentEl.querySelector("[data-export-status]")?.textContent)
      .toBe(message);
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

  it("renders an accessible panel error for invalid export form values", async () => {
    const fixture = makeFixture();
    await fixture.view.openPath("notes/a.galley.html");
    const folder = fixture.view.contentEl.querySelector(
      "input[data-export-field=output-folder]"
    ) as HTMLInputElement;
    folder.value = "../outside";

    (fixture.view.contentEl.querySelector(
      "button[data-export-action=save-config]"
    ) as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(fixture.view.contentEl.querySelector(
        "[data-export-status][role=alert]"
      )?.textContent).toBe("Export configuration is invalid");
    });
    expect(fixture.saveExportConfiguration).not.toHaveBeenCalled();
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
    const opening = fixture.view.openPath("notes/b.galley.html");
    await Promise.resolve();
    resolve({ path: "exports/stale.html", html: "<section>stale</section>" });
    await Promise.all([opening, exporting]);

    expect(fixture.copyHtml).not.toHaveBeenCalled();
    expect(fixture.view.currentState().documentPath).toBe("notes/b.galley.html");
    expect(fixture.view.contentEl.textContent).not.toContain("stale.html");
    expect(fixture.reportExportOutcome).toHaveBeenCalledWith(
      "Exported exports/stale.html for the previous document"
    );
  });

  it("invalidates at close entry, waits for a delayed exporter, and never performs stale copy or status", async () => {
    const fixture = makeFixture();
    let resolve!: (value: { path: string; html: string }) => void;
    fixture.exportDocument.mockImplementationOnce(
      async () => new Promise((done) => { resolve = done; })
    );
    await fixture.view.openPath("notes/a.galley.html");
    const exporting = fixture.view.exportCurrent("standard-web", true);

    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    let closeSettled = false;
    const closing = fixture.view.onClose().then(() => { closeSettled = true; });
    await Promise.resolve();
    expect(closeSettled).toBe(false);
    resolve({ path: "exports/stale.html", html: "stale" });
    await Promise.all([closing, exporting]);

    expect(fixture.copyHtml).not.toHaveBeenCalled();
    expect(fixture.reportExportOutcome).toHaveBeenCalledWith(
      "Exported exports/stale.html for the previous document"
    );
    expect(fixture.view.contentEl.children).toHaveLength(0);
  });

  it("aborts and settles a production record before close saves a newer captured edit", async () => {
    let replaceCalls = 0;
    let activeReplacements = 0;
    let maxActiveReplacements = 0;
    let enterFirst!: () => void;
    const firstEntered = new Promise<void>((resolve) => { enterFirst = resolve; });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const fixture = await makeSessionDeps({
      hooks: {
        async beforeReplace() {
          replaceCalls += 1;
          activeReplacements += 1;
          maxActiveReplacements = Math.max(
            maxActiveReplacements,
            activeReplacements
          );
          if (replaceCalls === 1) {
            enterFirst();
            await firstGate;
          }
          activeReplacements -= 1;
        }
      }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    const editor = new Editor();
    const service = new ExportService({
      profiles: [new StandardWebProfile()],
      writer: {
        writeNew: async () => ({ path: "exports/close-race.html" })
      },
      recorder: {
        record: (record, signal) => session.recordExport(record, signal)
      },
      now: () => new Date("2026-07-15T04:05:06.000Z"),
      randomUUID: () => "723e4567-e89b-42d3-a456-426614174000"
    });
    const view = new GalleyWorkbenchView(new WorkspaceLeaf(), {
      capabilities: {
        canGenerate: true,
        canEdit: true,
        canImportSkill: true,
        canPreview: true
      },
      openDocument: async () => ({
        session,
        listHistory: async () => [],
        recovery: { status: "ready", quarantinedTransactionId: null }
      }),
      createVisualEditor: async () => editor,
      createSourceEditor: () => new Editor(),
      openCopy: async () => undefined,
      confirm: async () => true,
      exportConfigurations: DEFAULT_EXPORT_CONFIGURATIONS,
      exportDocument: ({ configuration }, signal) => service.export({
        source: {
          htmlPath: fixture.paths.html,
          documentId: fixture.sidecar.documentId,
          html: session.html()
        },
        configuration
      }, signal),
      copyExportHtml: async () => undefined,
      reportExportOutcome: vi.fn()
    });
    await view.openPath(fixture.paths.html);
    const exporting = view.exportCurrent("standard-web", false);
    await firstEntered;
    editor.emit("<article><p>captured during close</p></article>");

    const closing = view.onClose();
    releaseFirst();
    await Promise.all([exporting, closing]);

    expect(maxActiveReplacements).toBe(1);
    expect(replaceCalls).toBe(2);
    expect(session.state()).toMatchObject({ dirty: false, saving: false });
    expect(fixture.backing.rawRead(fixture.paths.html)).toContain(
      "captured during close"
    );
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
  const reportExportOutcome = vi.fn();
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
    saveExportConfiguration,
    reportExportOutcome
  });
  return {
    view,
    editor,
    session,
    exportDocument,
    copyHtml,
    saveExportConfiguration,
    reportExportOutcome
  };
}
