import { WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { ObsidianDocumentSessionOpener } from "../../src/documents/ObsidianDocumentSessionOpener";
import type { OpenedGalleyDocumentSession } from "../../src/documents/DocumentSessionOpener";
import { EditorResourceResolver } from "../../src/editor/EditorResourceResolver";
import type {
  HtmlEditorAdapter,
  HtmlEditorMountOptions
} from "../../src/editor/HtmlEditorAdapter";
import {
  GalleyWorkbenchView,
  type WorkbenchDocument
} from "../../src/workbench/GalleyWorkbenchView";
import { persistentObsidianVault } from "../support/obsidianVaultFixtures";
import {
  OBSIDIAN_SESSION_PATHS,
  makeObsidianDocumentSessionFixture
} from "../support/obsidianDocumentSessionFixtures";

describe("production Galley workbench editing", () => {
  it("opens, edits, restores resource paths, saves, and reopens with production history", async () => {
    const fixture = await makeObsidianDocumentSessionFixture(
      'original <img src="images/cover.png" alt="cover">'
    );
    const firstOpener = productionOpener(fixture.backing);
    const firstEditor = new FakeEditor();
    const firstView = makeView(firstOpener, firstEditor);

    await firstView.openPath(OBSIDIAN_SESSION_PATHS.html);
    expect(firstEditor.html).toContain('src="app://local/images/cover.png"');
    expect(firstEditor.html).toContain(
      'data-galley-original-src="images/cover.png"'
    );

    firstEditor.emit(
      '<article data-galley-article="true"><p>edited</p><img src="app://local/images/cover.png" data-galley-original-src="images/cover.png" alt="cover"></article>'
    );
    await firstView.saveExplicit();

    const persisted = fixture.backing.read(OBSIDIAN_SESSION_PATHS.html) ?? "";
    expect(persisted).toContain("edited");
    expect(persisted).toContain('src="images/cover.png"');
    expect(persisted).not.toContain("app://local");
    expect(persisted).not.toContain("data-galley-original");
    await firstView.onClose();

    const restartedOpener = productionOpener(fixture.backing);
    const reopenedEditor = new FakeEditor();
    const reopenedView = makeView(restartedOpener, reopenedEditor);
    await reopenedView.openPath(OBSIDIAN_SESSION_PATHS.html);
    expect(reopenedEditor.html).toContain("edited");
    await reopenedView.selectMode("preview");
    const preview = reopenedView.contentEl.querySelector(
      "iframe"
    ) as HTMLIFrameElement;
    expect(preview.srcdoc).toContain('src="app://local/images/cover.png"');
    expect(preview.srcdoc).not.toContain("data-galley-original");
    await reopenedView.selectMode("visual");
    const reopened = await restartedOpener.open(OBSIDIAN_SESSION_PATHS.html);
    const history = await reopened.history();
    expect(history).toHaveLength(1);
    expect(history[0]?.html).toContain("original");

    await reopenedView.restoreHistory(history[0]!);
    expect(reopenedView.currentState().dirty).toBe(true);
    expect(reopenedEditor.html).toContain("original");
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toContain("edited");
  });

  it("preserves local and external link targets changed through the property inspector", async () => {
    const fixture = await makeObsidianDocumentSessionFixture(
      'original <a href="notes/old.md">old</a>'
    );
    const editor = new FakeEditor();
    const view = makeView(productionOpener(fixture.backing), editor);
    await view.openPath(OBSIDIAN_SESSION_PATHS.html);

    editor.select("a");
    const localInput = view.contentEl.querySelector(
      'input[data-control="link-url"]'
    ) as HTMLInputElement;
    localInput.value = "notes/new.md";
    localInput.dispatchEvent(new Event("change"));
    await view.saveExplicit();

    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toContain(
      'href="notes/new.md"'
    );
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).not.toContain(
      "data-galley-original"
    );

    editor.select("a");
    const externalInput = view.contentEl.querySelector(
      'input[data-control="link-url"]'
    ) as HTMLInputElement;
    externalInput.value = "https://example.com/new";
    externalInput.dispatchEvent(new Event("change"));
    await view.saveExplicit();

    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).toContain(
      'href="https://example.com/new"'
    );
    expect(fixture.backing.read(OBSIDIAN_SESSION_PATHS.html)).not.toContain(
      "data-galley-original"
    );
  });
});

class FakeEditor implements HtmlEditorAdapter {
  readonly contentDocument = document.implementation.createHTMLDocument("editor");
  options: HtmlEditorMountOptions | null = null;
  get html(): string { return this.contentDocument.body.innerHTML; }
  set html(value: string) { this.contentDocument.body.innerHTML = value; }
  async mount(
    _container: HTMLElement,
    bodyHtml: string,
    options: HtmlEditorMountOptions
  ): Promise<void> {
    this.html = bodyHtml;
    this.options = options;
  }
  getHtml(): string { return this.html; }
  setHtml(html: string): void { this.html = html; }
  focus(): void {}
  destroy(): void {}
  emit(html: string): void {
    this.html = html;
    this.options?.onChange(html);
  }
  select(selector: string): void {
    const element = this.contentDocument.querySelector(selector) as HTMLElement | null;
    this.options?.onSelectionChange?.(element);
  }
}

function productionOpener(backing: Parameters<typeof persistentObsidianVault>[0]) {
  return new ObsidianDocumentSessionOpener(persistentObsidianVault(backing), {
    now: () => new Date("2026-07-15T08:00:00.000Z"),
    randomUUID: () => "923e4567-e89b-42d3-a456-426614174000",
    historyOptions: {
      randomUUID: uuidSequence("a23e4567-e89b-42d3-a456-426614174")
    }
  });
}

function makeView(
  opener: ObsidianDocumentSessionOpener,
  editor: FakeEditor
): GalleyWorkbenchView {
  const resolver = new EditorResourceResolver((path) => `app://local/${path}`);
  return new GalleyWorkbenchView(new WorkspaceLeaf(), {
    capabilities: {
      canGenerate: true,
      canEdit: true,
      canImportSkill: true,
      canPreview: true
    },
    openDocument: async (path) => asWorkbenchDocument(await opener.open(path)),
    createVisualEditor: async () => editor,
    createSourceEditor: () => new FakeEditor(),
    openCopy: vi.fn(async () => undefined),
    confirm: vi.fn(async () => true),
    resourceResolver: resolver,
    documentBaseUrl: () => "app://local/"
  });
}

function asWorkbenchDocument(
  session: OpenedGalleyDocumentSession
): WorkbenchDocument {
  const recovery = session.recoveryState();
  return {
    session,
    recovery: {
      status: recovery.status,
      quarantinedTransactionId:
        recovery.status === "ready" ? null : recovery.transactionId
    },
    listHistory: async () => [...await session.history()]
  };
}

function uuidSequence(prefix: string): () => string {
  let sequence = 0;
  return () => {
    sequence += 1;
    return `${prefix}${sequence.toString(16).padStart(3, "0")}`;
  };
}
