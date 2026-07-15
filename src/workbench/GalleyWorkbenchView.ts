import {
  ItemView,
  type ViewStateResult,
  type WorkspaceLeaf
} from "obsidian";

import type { ArtifactPaths } from "../documents/GalleyDocumentRepository";
import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { GalleyDocumentCodec } from "../documents/GalleyDocumentCodec";
import type { DocumentSessionState, SaveReason } from "../documents/DocumentSession";
import type { DocumentRecoveryState } from "../documents/DocumentSessionOpener";
import type { HistorySnapshot } from "../documents/HistoryRepository";
import type { EditorResourceResolver } from "../editor/EditorResourceResolver";
import type { HtmlEditorAdapter } from "../editor/HtmlEditorAdapter";
import { ThemeComponentCatalog } from "../editor/ThemeComponentCatalog";
import { transformSelectedBlock } from "../editor/ComponentTransformer";
import type { PlatformCapabilities } from "../platform/PlatformCapabilities";
import { createSafePreviewFrame } from "../preview/SafeHtmlPreview";
import { AutosaveController } from "./AutosaveController";
import {
  renderConflictBanner,
  type ConflictDecision
} from "./ConflictBanner";
import {
  extractDocumentOutline,
  renderDocumentOutline
} from "./DocumentOutline";
import { renderHistoryPanel } from "./HistoryPanel";
import {
  applyElementProperty,
  renderPropertyInspector,
  type ElementPropertyCommand
} from "./PropertyInspector";
import {
  initialWorkbenchState,
  reduceWorkbenchState,
  type WorkbenchMode,
  type WorkbenchState
} from "./WorkbenchState";
import { renderWorkbenchToolbar } from "./WorkbenchToolbar";

export const GALLEY_WORKBENCH_VIEW_TYPE = "galley-workbench";

export interface WorkbenchSession {
  state(): DocumentSessionState;
  html(): string;
  bodyHtml(): string;
  updateBody(bodyHtml: string): void;
  save(reason: SaveReason): Promise<void>;
  reload(): Promise<void>;
  saveCopy(): Promise<ArtifactPaths>;
  restoreHistory?(path: string): Promise<void>;
  recoveryState?(): DocumentRecoveryState;
}

export interface WorkbenchRecoveryState {
  readonly status: "ready" | "recovered" | "ambiguous" | "quarantined";
  readonly quarantinedTransactionId: string | null;
}

export interface WorkbenchDocument {
  readonly session: WorkbenchSession;
  readonly recovery: WorkbenchRecoveryState;
  listHistory(): Promise<HistorySnapshot[]>;
}

export interface SelectableHtmlEditorAdapter extends HtmlEditorAdapter {
  selectSource?(sourceId: string): boolean;
}

export interface GalleyWorkbenchViewServices {
  readonly capabilities: PlatformCapabilities;
  readonly openDocument: (path: string) => Promise<WorkbenchDocument>;
  readonly createVisualEditor: () => Promise<SelectableHtmlEditorAdapter>;
  readonly createSourceEditor: () => SelectableHtmlEditorAdapter;
  readonly openCopy: (path: string) => Promise<void>;
  readonly confirm: (message: string) => Promise<boolean>;
  readonly resourceResolver?: Pick<
    EditorResourceResolver,
    "rewriteForDisplay" | "restoreForSave"
  >;
  readonly documentBaseUrl?: (path: string) => string;
}

export class GalleyPathInvalidError extends Error {
  readonly code = "galley_path_invalid" as const;

  constructor() {
    super("Galley workbench accepts only canonical *.galley.html artifacts.");
    this.name = "GalleyPathInvalidError";
  }
}

export class WorkbenchVisualEditorUnavailableError extends Error {
  readonly code = "visual_editor_unavailable" as const;

  constructor() {
    super("Visual editing is unavailable on this platform.");
    this.name = "WorkbenchVisualEditorUnavailableError";
  }
}

export class GalleyWorkbenchView extends ItemView {
  readonly #services: GalleyWorkbenchViewServices;
  #state = initialWorkbenchState();
  #document: WorkbenchDocument | null = null;
  #history: HistorySnapshot[] = [];
  #adapter: SelectableHtmlEditorAdapter | null = null;
  #adapterDestroyed = new WeakSet<object>();
  #autosave: AutosaveController | null = null;
  #catalog = ThemeComponentCatalog.fromDocument("");
  #selectedElement: HTMLElement | null = null;
  #closed = false;
  #mountGeneration = 0;
  #transition: Promise<void> = Promise.resolve();
  #saveQueue: Promise<void> = Promise.resolve();
  #toolbar!: HTMLElement;
  #leftRail!: HTMLElement;
  #outlineHost!: HTMLElement;
  #historyHost!: HTMLElement;
  #canvas!: HTMLElement;
  #inspector!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, services: GalleyWorkbenchViewServices) {
    super(leaf);
    this.#services = services;
    this.navigation = true;
  }

  getViewType(): string {
    return GALLEY_WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    const path = this.#state.documentPath;
    return path ? path.split("/").at(-1) ?? "Galley" : "Galley workbench";
  }

  getState(): Record<string, unknown> {
    return this.#state.documentPath ? { path: this.#state.documentPath } : {};
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    if (
      typeof state === "object" &&
      state !== null &&
      "path" in state &&
      typeof state.path === "string"
    ) {
      await this.openPath(state.path);
    }
  }

  async onOpen(): Promise<void> {
    this.#closed = false;
    this.#ensureShell();
  }

  async onClose(): Promise<void> {
    if (this.#closed) return;
    this.#captureAdapterBody();
    try {
      await this.#autosave?.flush();
      if (this.#document?.session.state().dirty) await this.#save("explicit");
    } catch (error) {
      this.#render();
      throw error;
    }
    this.#closed = true;
    this.#mountGeneration += 1;
    this.#autosave?.dispose();
    this.#autosave = null;
    this.#destroyActiveAdapter();
    this.#document = null;
    this.contentEl.replaceChildren();
  }

  currentState(): WorkbenchState {
    return { ...this.#state };
  }

  async openPath(path: string): Promise<void> {
    assertGalleyHtmlPath(path);
    this.#closed = false;
    if (this.#document) {
      this.#captureAdapterBody();
      await this.#autosave?.flush();
      if (this.#document.session.state().dirty) await this.#save("explicit");
    }
    this.#autosave?.dispose();
    this.#autosave = null;
    this.#destroyActiveAdapter();
    this.#state = reduceWorkbenchState(this.#state, { type: "recovery-started" });
    this.#ensureShell();
    this.#render();
    const generation = ++this.#mountGeneration;

    let opened: WorkbenchDocument;
    try {
      opened = await this.#services.openDocument(path);
    } catch (error) {
      if (errorCode(error) === "galley_document_ambiguous") {
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-ambiguous",
          message: "The last transaction outcome is ambiguous. No partial document was opened."
        });
        this.#render();
      } else if (
        errorCode(error) === "transaction_recovery_conflict" ||
        errorCode(error) === "galley_document_quarantined"
      ) {
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-quarantined",
          message: "Recovery is quarantined for this document. No file was changed."
        });
        this.#render();
      }
      throw error;
    }
    if (generation !== this.#mountGeneration || this.#closed) return;

    this.#document = opened;
    this.#catalog = ThemeComponentCatalog.fromDocument(opened.session.bodyHtml());
    this.#history = await opened.listHistory();
    if (generation !== this.#mountGeneration || this.#closed) return;
    const sessionState = opened.session.state();
    const initialMode = this.#services.capabilities.canEdit ? "visual" : "preview";
    this.#state = reduceWorkbenchState(this.#state, {
      type: "document-opened",
      path,
      sourceChanged: sessionState.sourceChanged,
      mode: initialMode
    });
    if (opened.recovery.status === "quarantined") {
      this.#state = reduceWorkbenchState(this.#state, {
        type: "recovery-quarantined",
        message: "Recovery is quarantined for this document. No file was changed."
      });
    } else if (opened.recovery.status === "ambiguous") {
      this.#state = reduceWorkbenchState(this.#state, {
        type: "recovery-ambiguous",
        message: "The last transaction outcome is ambiguous. Saving is paused until recovery completes."
      });
    }
    this.#autosave = new AutosaveController(800, () => this.#save("auto"));
    this.#render();
    await this.#mountMode(initialMode, generation);
  }

  selectMode(mode: WorkbenchMode): Promise<void> {
    const operation = async (): Promise<void> => {
      if ((mode === "visual" || mode === "source") && !this.#services.capabilities.canEdit) {
        throw new WorkbenchVisualEditorUnavailableError();
      }
      if (!this.#document || mode === this.#state.mode) return;
      this.#captureAdapterBody();
      this.#destroyActiveAdapter();
      const generation = ++this.#mountGeneration;
      this.#state = reduceWorkbenchState(this.#state, {
        type: "mode-selected",
        mode
      });
      this.#render();
      await this.#mountMode(mode, generation);
    };
    const result = this.#transition.then(operation, operation);
    this.#transition = result.catch(() => undefined);
    return result;
  }

  async saveExplicit(): Promise<void> {
    this.#captureAdapterBody();
    await this.#save("explicit");
  }

  async resolveConflict(decision: ConflictDecision): Promise<void> {
    const session = this.#document?.session;
    if (!session) return;
    if (decision === "save-copy") {
      const paths = await session.saveCopy();
      await this.#services.openCopy(paths.html);
      return;
    }
    const accepted = await this.#services.confirm(
      decision === "reload"
        ? "Discard local edits and reload the external file?"
        : "Overwrite the external file with the local Galley edit?"
    );
    if (!accepted) return;
    if (decision === "reload") {
      await session.reload();
      this.#autosave?.resume();
      this.#state = reduceWorkbenchState(this.#state, {
        type: "document-reloaded",
        sourceChanged: session.state().sourceChanged
      });
      this.#catalog = ThemeComponentCatalog.fromDocument(session.bodyHtml());
      this.#adapter?.setHtml(this.#bodyForCurrentEditor());
      this.#render();
      if (this.#state.mode === "preview") this.#renderPreview();
      return;
    }
    await this.#save("overwrite");
    this.#autosave?.resume();
  }

  async restoreHistory(snapshot: HistorySnapshot): Promise<void> {
    const session = this.#document?.session;
    if (!session) return;
    if (session.restoreHistory) {
      await session.restoreHistory(snapshot.path);
    } else {
      const restored = GalleyDocumentCodec.parse(snapshot.html).bodyHtml;
      session.updateBody(restored);
    }
    this.#syncStateFromSession(true);
    this.#adapter?.setHtml(this.#bodyForCurrentEditor());
    this.#render();
    if (this.#state.mode === "preview") this.#renderPreview();
  }

  #ensureShell(): void {
    if (this.contentEl.querySelector(":scope > .galley-workbench")) return;
    const document = this.contentEl.ownerDocument;
    const root = document.createElement("div");
    root.className = "galley-workbench";
    this.#toolbar = document.createElement("header");
    this.#toolbar.className = "galley-toolbar";
    const body = document.createElement("div");
    body.className = "galley-workbench-body";
    this.#leftRail = document.createElement("aside");
    this.#leftRail.className = "galley-left-rail";
    const workflow = document.createElement("nav");
    workflow.className = "galley-workflow";
    workflow.textContent = "Generate → Edit → Export";
    this.#outlineHost = document.createElement("section");
    this.#outlineHost.className = "galley-outline";
    this.#historyHost = document.createElement("section");
    this.#historyHost.className = "galley-history";
    this.#leftRail.append(workflow, this.#outlineHost, this.#historyHost);
    this.#canvas = document.createElement("main");
    this.#canvas.className = "galley-canvas";
    this.#inspector = document.createElement("aside");
    this.#inspector.className = "galley-inspector";
    body.append(this.#leftRail, this.#canvas, this.#inspector);
    root.append(this.#toolbar, body);
    this.contentEl.replaceChildren(root);
  }

  #render(): void {
    this.#ensureShell();
    renderWorkbenchToolbar(this.#toolbar, this.#state, {
      onMode: (mode) => this.selectMode(mode),
      onSave: () => this.saveExplicit()
    });
    if (this.#state.conflict) {
      renderConflictBanner(this.#toolbar, (decision) => this.resolveConflict(decision));
    }
    if (this.#state.recovery === "quarantined" || this.#state.error) {
      const warning = this.#toolbar.ownerDocument.createElement("p");
      warning.className = "galley-workbench-warning";
      warning.setAttribute("role", "alert");
      warning.textContent = this.#state.error ?? "Recovery requires attention.";
      this.#toolbar.append(warning);
    }
    const body = this.#document?.session.bodyHtml() ?? "";
    renderDocumentOutline(
      this.#outlineHost,
      extractDocumentOutline(body),
      (sourceId) => this.#selectSource(sourceId)
    );
    renderHistoryPanel(this.#historyHost, this.#history, (snapshot) =>
      this.restoreHistory(snapshot)
    );
    renderPropertyInspector(
      this.#inspector,
      this.#selectedElement,
      this.#catalog.roles(),
      (command) => this.#applyProperty(command)
    );
  }

  async #mountMode(mode: WorkbenchMode, generation: number): Promise<void> {
    const session = this.#document?.session;
    if (!session || this.#closed || generation !== this.#mountGeneration) return;
    this.#canvas.replaceChildren();
    if (mode === "preview") {
      this.#renderPreview();
      return;
    }
    const adapter = mode === "visual"
      ? await this.#services.createVisualEditor()
      : this.#services.createSourceEditor();
    if (this.#closed || generation !== this.#mountGeneration) {
      this.#destroyAdapter(adapter);
      return;
    }
    this.#adapter = adapter;
    try {
      await adapter.mount(this.#canvas, this.#bodyForCurrentEditor(), {
        documentBaseUrl: this.#services.documentBaseUrl?.(
          this.#state.documentPath ?? ""
        ) ?? "",
        onChange: (html) => this.#editorChanged(adapter, html),
        onSelectionChange: (element) => {
          if (this.#adapter !== adapter) return;
          this.#selectedElement = element;
          this.#state = reduceWorkbenchState(this.#state, {
            type: "source-selected",
            sourceId: element?.dataset.galleySource ?? null
          });
          this.#render();
        }
      });
      if (this.#closed || generation !== this.#mountGeneration || this.#adapter !== adapter) {
        this.#destroyAdapter(adapter);
      }
    } catch (error) {
      if (this.#adapter === adapter) this.#adapter = null;
      this.#destroyAdapter(adapter);
      if (this.#closed || generation !== this.#mountGeneration) return;
      this.#state = reduceWorkbenchState(this.#state, {
        type: "error",
        message: "Galley could not initialize this editor mode."
      });
      this.#render();
      throw error;
    }
  }

  #renderPreview(): void {
    const session = this.#document?.session;
    if (!session) return;
    let previewHtml = session.html();
    if (this.#services.resourceResolver) {
      const parsed = GalleyDocumentCodec.parse(previewHtml);
      previewHtml = GalleyDocumentCodec.serialize({
        ...parsed,
        bodyHtml: this.#services.resourceResolver.rewriteForDisplay(
          parsed.bodyHtml
        )
      });
    }
    createSafePreviewFrame(this.#canvas, previewHtml);
  }

  #editorChanged(adapter: SelectableHtmlEditorAdapter, displayHtml: string): void {
    if (this.#closed || this.#adapter !== adapter || !this.#document) return;
    try {
      const body = this.#state.mode === "visual"
        ? this.#services.resourceResolver?.restoreForSave(displayHtml) ?? displayHtml
        : displayHtml;
      this.#document.session.updateBody(body);
      this.#syncStateFromSession(true);
      this.#autosave?.changed();
      this.#render();
    } catch {
      this.#state = reduceWorkbenchState(this.#state, {
        type: "error",
        message: "Galley rejected an unsafe or invalid body edit."
      });
      this.#render();
    }
  }

  #captureAdapterBody(): void {
    const adapter = this.#adapter;
    const session = this.#document?.session;
    if (!adapter || !session) return;
    try {
      const displayHtml = adapter.getHtml();
      const body = this.#state.mode === "visual"
        ? this.#services.resourceResolver?.restoreForSave(displayHtml) ?? displayHtml
        : displayHtml;
      session.updateBody(body);
      this.#syncStateFromSession(session.state().dirty);
    } catch {
      // The latest accepted editor change remains the session source of truth.
    }
  }

  #bodyForCurrentEditor(): string {
    const body = this.#document?.session.bodyHtml() ?? "";
    return this.#state.mode === "visual"
      ? this.#services.resourceResolver?.rewriteForDisplay(body) ?? body
      : body;
  }

  async #save(reason: SaveReason): Promise<void> {
    const operation = () => this.#performSave(reason);
    const result = this.#saveQueue.then(operation, operation);
    this.#saveQueue = result.catch(() => undefined);
    return result;
  }

  async #performSave(reason: SaveReason): Promise<void> {
    const document = this.#document;
    if (!document) return;
    this.#state = reduceWorkbenchState(this.#state, { type: "save-started" });
    this.#render();
    try {
      await document.session.save(reason);
      const sessionState = document.session.state();
      this.#state = reduceWorkbenchState(this.#state, {
        type: "save-completed",
        dirty: sessionState.dirty,
        lastSavedAt: sessionState.lastSavedAt,
        sourceChanged: sessionState.sourceChanged
      });
      this.#history = await document.listHistory();
      this.#render();
    } catch (error) {
      if (errorCode(error) === "document_conflict") {
        this.#autosave?.pause();
        this.#state = reduceWorkbenchState(this.#state, {
          type: "conflict-detected"
        });
      } else if (document.session.recoveryState?.().status === "quarantined") {
        this.#autosave?.pause();
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-quarantined",
          message: "Recovery is quarantined for this document. No file was overwritten."
        });
      } else if (
        document.session.recoveryState?.().status === "ambiguous" ||
        errorCode(error) === "document_commit_ambiguous"
      ) {
        this.#autosave?.pause();
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-ambiguous",
          message: "Galley could not prove the save outcome. Recovery must complete before another save."
        });
      } else {
        this.#state = reduceWorkbenchState(this.#state, {
          type: "error",
          message: "Galley could not save this article."
        });
      }
      this.#render();
      if (reason !== "auto") throw error;
    }
  }

  #syncStateFromSession(markDirty: boolean): void {
    const sessionState = this.#document?.session.state();
    if (!sessionState) return;
    if (markDirty || sessionState.dirty) {
      this.#state = reduceWorkbenchState(this.#state, { type: "content-changed" });
    }
    if (sessionState.conflict) {
      this.#state = reduceWorkbenchState(this.#state, { type: "conflict-detected" });
    }
    this.#state = {
      ...this.#state,
      dirty: sessionState.dirty,
      saving: sessionState.saving,
      conflict: sessionState.conflict,
      sourceChanged: sessionState.sourceChanged,
      lastSavedAt: sessionState.lastSavedAt
    };
  }

  #selectSource(sourceId: string): void {
    this.#state = reduceWorkbenchState(this.#state, {
      type: "source-selected",
      sourceId
    });
    this.#adapter?.selectSource?.(sourceId);
    this.#render();
  }

  #applyProperty(command: ElementPropertyCommand): void {
    const selected = this.#selectedElement;
    const adapter = this.#adapter;
    if (!selected || !adapter) return;
    if (command.type === "role") {
      if (!command.value) return;
      const transformed = transformSelectedBlock(selected, command.value, this.#catalog);
      const template = selected.ownerDocument.createElement("template");
      template.innerHTML = transformed;
      const replacement = template.content.firstElementChild;
      if (
        !replacement ||
        replacement.namespaceURI !== "http://www.w3.org/1999/xhtml"
      ) return;
      selected.replaceWith(replacement);
      this.#selectedElement = replacement as HTMLElement;
    } else {
      applyElementProperty(selected, command);
    }
    this.#editorChanged(adapter, adapter.getHtml());
  }

  #destroyActiveAdapter(): void {
    const adapter = this.#adapter;
    this.#adapter = null;
    this.#selectedElement = null;
    if (adapter) this.#destroyAdapter(adapter);
  }

  #destroyAdapter(adapter: SelectableHtmlEditorAdapter): void {
    if (this.#adapterDestroyed.has(adapter)) return;
    this.#adapterDestroyed.add(adapter);
    adapter.destroy();
  }
}

export function isGalleyHtmlPath(path: string): boolean {
  return isNormalizedVaultRelativePath(path) && path.endsWith(".galley.html");
}

function assertGalleyHtmlPath(path: string): void {
  if (!isGalleyHtmlPath(path)) throw new GalleyPathInvalidError();
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}
