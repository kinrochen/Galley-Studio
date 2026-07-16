import {
  ItemView,
  type ViewStateResult,
  type WorkspaceLeaf
} from "obsidian";

import type { ArtifactPaths } from "../documents/GalleyDocumentRepository";
import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { GalleyDocumentCodec } from "../documents/GalleyDocumentCodec";
import { parseHtmlFragment } from "../dom/HtmlFragment";
import type { DocumentSessionState, SaveReason } from "../documents/DocumentSession";
import type { DocumentRecoveryState } from "../documents/DocumentSessionOpener";
import type { HistorySnapshot } from "../documents/HistoryRepository";
import type { EditorResourceResolver } from "../editor/EditorResourceResolver";
import type { HtmlEditorAdapter } from "../editor/HtmlEditorAdapter";
import { ThemeComponentCatalog } from "../editor/ThemeComponentCatalog";
import { transformSelectedBlock } from "../editor/ComponentTransformer";
import type { PlatformCapabilities } from "../platform/PlatformCapabilities";
import {
  ENGLISH_LOCALIZED_TEXT,
  translateMessage,
  type LocalizedMessage,
  type LocalizedText
} from "../i18n/LocalizedText";
import { createSafePreviewFrame } from "../preview/SafeHtmlPreview";
import type { ExportConfiguration } from "../export/ExportConfiguration";
import type { GalleyExportRecordV1 } from "../export/ExportRecord";
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
import {
  renderExportPanel,
  type ExportPanelState
} from "./ExportPanel";

export const GALLEY_WORKBENCH_VIEW_TYPE = "galley-studio-workbench";

export interface WorkbenchSession {
  state(): DocumentSessionState;
  html(): string;
  bodyHtml(): string;
  exportPaths?(): readonly string[];
  updateBody(bodyHtml: string): void;
  save(reason: SaveReason): Promise<void>;
  reload(): Promise<void>;
  saveCopy(): Promise<ArtifactPaths>;
  restoreHistory?(path: string): Promise<void>;
  recoveryState?(): DocumentRecoveryState;
  documentId?(): string;
  recordExport?(record: GalleyExportRecordV1, signal?: AbortSignal): Promise<void>;
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
  readonly exportConfigurations?: readonly ExportConfiguration[];
  readonly exportDocument?: (
    input: {
      readonly session: WorkbenchSession;
      readonly documentPath: string;
      readonly configuration: Readonly<ExportConfiguration>;
    },
    signal: AbortSignal
  ) => Promise<{ readonly path: string; readonly html: string }>;
  readonly copyExportHtml?: (html: string) => Promise<void>;
  readonly copyHtml?: (html: string) => Promise<void>;
  readonly saveExportConfiguration?: (
    configuration: ExportConfiguration
  ) => Promise<readonly ExportConfiguration[]>;
  readonly reportExportOutcome?: (message: string) => void;
  readonly reportCopyOutcome?: (message: string) => void;
  readonly locale?: LocalizedText;
}

export class GalleyPathInvalidError extends Error {
  readonly code = "galley_path_invalid" as const;

  constructor() {
    super("Galley Studio workbench accepts only vault-relative HTML files.");
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
  #exportController: AbortController | null = null;
  #exportTasks = new Set<Promise<void>>();
  #exportConfigurations: readonly ExportConfiguration[];
  #exportState: ExportPanelState;
  readonly #text: LocalizedText;
  #unsubscribeLocale: (() => void) | null = null;
  #toolbar!: HTMLElement;
  #leftRail!: HTMLElement;
  #outlineHost!: HTMLElement;
  #historyHost!: HTMLElement;
  #canvas!: HTMLElement;
  #inspector!: HTMLElement;
  #propertyHost!: HTMLElement;
  #exportHost!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, services: GalleyWorkbenchViewServices) {
    super(leaf);
    this.#services = services;
    this.#text = services.locale ?? ENGLISH_LOCALIZED_TEXT;
    this.#exportConfigurations = Object.freeze([
      ...(services.exportConfigurations ?? [])
    ]);
    this.#exportState = {
      selectedId: this.#exportConfigurations[0]?.id ?? "",
      status: "idle",
      message: { key: "common.status.idle" }
    };
    this.navigation = true;
  }

  getViewType(): string {
    return GALLEY_WORKBENCH_VIEW_TYPE;
  }

  getDisplayText(): string {
    const path = this.#state.documentPath;
    return path ? path.split("/").at(-1) ?? "Galley Studio" : this.#text.t("workbench.title");
  }

  getState(): Record<string, unknown> {
    return this.#state.documentPath ? { file: this.#state.documentPath } : {};
  }

  async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const path = filePathFromState(state);
    if (path) await this.openPath(path);
  }

  async onOpen(): Promise<void> {
    this.#closed = false;
    this.#ensureShell();
    this.#subscribeLocale();
  }

  async onClose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribeLocale?.();
    this.#unsubscribeLocale = null;
    this.#exportController?.abort();
    this.#exportController = null;
    this.#mountGeneration += 1;
    this.#captureAdapterBody();
    try {
      await this.#settleExports();
      await this.#autosave?.flush();
      if (this.#document?.session.state().dirty) await this.#save("explicit");
    } catch (error) {
      this.#render();
      throw error;
    }
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
    this.#subscribeLocale();
    this.#exportController?.abort();
    this.#exportController = null;
    this.#mountGeneration += 1;
    await this.#settleExports();
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
          message: this.#text.t("workbench.error.openAmbiguous")
        });
        this.#render();
      } else if (
        errorCode(error) === "transaction_recovery_conflict" ||
        errorCode(error) === "galley_document_quarantined"
      ) {
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-quarantined",
          message: this.#text.t("workbench.error.openQuarantined")
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
        message: this.#text.t("workbench.error.openQuarantined")
      });
    } else if (opened.recovery.status === "ambiguous") {
      this.#state = reduceWorkbenchState(this.#state, {
        type: "recovery-ambiguous",
        message: this.#text.t("workbench.error.recoveryAmbiguous")
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

  async copyCurrentHtml(): Promise<void> {
    const session = this.#document?.session;
    const copy = this.#services.copyHtml;
    if (!session || !copy) {
      throw new Error("Galley Studio HTML copy is unavailable.");
    }
    this.#captureAdapterBody();
    try {
      await copy(session.html());
      this.#services.reportCopyOutcome?.(
        this.#text.t("workbench.copyHtml.success")
      );
    } catch (error) {
      this.#services.reportCopyOutcome?.(
        this.#text.t("workbench.copyHtml.failed")
      );
      throw error;
    }
  }

  exportCurrent(configurationId: string, copy: boolean): Promise<void> {
    const task = this.#performExport(configurationId, copy);
    this.#exportTasks.add(task);
    void task.finally(() => this.#exportTasks.delete(task)).catch(() => undefined);
    return task;
  }

  async #performExport(configurationId: string, copy: boolean): Promise<void> {
    if (this.#closed) throw new Error("Galley Studio export is unavailable.");
    const exportDocument = this.#services.exportDocument;
    const document = this.#document;
    const configuration = this.#exportConfigurations.find(
      ({ id }) => id === configurationId
    );
    if (!exportDocument || !document || !configuration) {
      throw new Error("Galley Studio export is unavailable.");
    }
    const controller = new AbortController();
    this.#exportController?.abort();
    this.#exportController = controller;
    const operationGeneration = this.#mountGeneration;
    const isCurrent = (): boolean =>
      !controller.signal.aborted &&
      !this.#closed &&
      this.#exportController === controller &&
      this.#document === document &&
      this.#mountGeneration === operationGeneration;
    let durablePath: string | null = null;
    try {
      this.#exportState = {
        selectedId: configuration.id,
        status: copy ? "copying" : "exporting",
        message: {
          key: copy
            ? "workbench.export.status.copying"
            : "workbench.export.status.exporting"
        }
      };
      this.#render();
      this.#captureAdapterBody();
      if (document.session.state().dirty) await this.#save("explicit");
      if (!isCurrent()) return;
      const result = await exportDocument(
        {
          session: document.session,
          documentPath: this.#state.documentPath ?? "",
          configuration
        },
        controller.signal
      );
      durablePath = result.path;
      if (!isCurrent()) {
        this.#services.reportExportOutcome?.(
          this.#text.t("workbench.export.status.previous", { path: result.path })
        );
        return;
      }
      if (copy) {
        const copyHtml = this.#services.copyExportHtml;
        if (!copyHtml) throw new Error("Galley Studio rich-text copy is unavailable.");
        await copyHtml(result.html);
        if (!isCurrent()) return;
      }
      this.#exportState = {
        selectedId: configuration.id,
        status: copy ? "copied" : "success",
        message: {
          key: copy
            ? "workbench.export.status.copied"
            : "workbench.export.status.exported",
          parameters: { path: result.path }
        }
      };
      this.#render();
    } catch (error) {
      const artifactPath = durablePath ?? errorArtifactPath(error);
      const message = exportFailureMessage(
        error,
        artifactPath,
        copy && durablePath !== null
      );
      if (!isCurrent()) {
        if (artifactPath) {
          this.#services.reportExportOutcome?.(
            translateMessage(this.#text, message)
          );
        }
        return;
      }
      this.#exportState = {
        selectedId: configuration.id,
        status: "error",
        message
      };
      this.#render();
      throw error;
    } finally {
      if (this.#exportController === controller) this.#exportController = null;
    }
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
        ? this.#text.t("workbench.confirm.reload")
        : this.#text.t("workbench.confirm.overwrite")
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
    workflow.textContent = this.#text.t("workbench.workflow");
    this.#outlineHost = document.createElement("section");
    this.#outlineHost.className = "galley-outline";
    this.#historyHost = document.createElement("section");
    this.#historyHost.className = "galley-history";
    this.#leftRail.append(workflow, this.#outlineHost, this.#historyHost);
    this.#canvas = document.createElement("main");
    this.#canvas.className = "galley-canvas";
    this.#inspector = document.createElement("aside");
    this.#inspector.className = "galley-inspector";
    this.#propertyHost = document.createElement("div");
    this.#propertyHost.className = "galley-property-host";
    this.#exportHost = document.createElement("div");
    this.#exportHost.className = "galley-export-host";
    this.#inspector.append(this.#propertyHost, this.#exportHost);
    body.append(this.#leftRail, this.#canvas, this.#inspector);
    root.append(this.#toolbar, body);
    this.contentEl.replaceChildren(root);
  }

  #render(): void {
    if (this.#closed) return;
    this.#ensureShell();
    const workflow = this.#leftRail.querySelector<HTMLElement>(".galley-workflow");
    if (workflow) workflow.textContent = this.#text.t("workbench.workflow");
    renderWorkbenchToolbar(this.#toolbar, this.#state, {
      onMode: (mode) => this.selectMode(mode),
      onCopy: () => this.copyCurrentHtml(),
      onSave: () => this.saveExplicit()
    }, this.#text);
    if (this.#state.conflict) {
      renderConflictBanner(
        this.#toolbar,
        (decision) => this.resolveConflict(decision),
        this.#text
      );
    }
    if (this.#state.recovery === "quarantined" || this.#state.error) {
      const warning = this.#toolbar.ownerDocument.createElement("p");
      warning.className = "galley-workbench-warning";
      warning.setAttribute("role", "alert");
      warning.textContent = this.#localizedStateMessage(
        this.#state.error ?? this.#text.t("workbench.warning.recovery")
      );
      this.#toolbar.append(warning);
    }
    const body = this.#document?.session.bodyHtml() ?? "";
    renderDocumentOutline(
      this.#outlineHost,
      extractDocumentOutline(body),
      (sourceId) => this.#selectSource(sourceId),
      this.#text
    );
    renderHistoryPanel(
      this.#historyHost,
      this.#history,
      (snapshot) => this.restoreHistory(snapshot),
      this.#text
    );
    renderPropertyInspector(
      this.#propertyHost,
      this.#selectedElement,
      this.#catalog.roles(),
      (command) => this.#applyProperty(command),
      this.#text
    );
    if (this.#exportConfigurations.length > 0) {
      renderExportPanel(
        this.#exportHost,
        this.#exportState,
        this.#exportConfigurations,
        {
          onSelect: (selectedId) => {
            this.#exportState = { ...this.#exportState, selectedId };
            this.#render();
          },
          onExport: (selectedId) => this.exportCurrent(selectedId, false),
          onCopy: (selectedId) => this.exportCurrent(selectedId, true),
          onSave: (configuration) => this.#saveExportConfiguration(configuration),
          onValidationError: () => {
            this.#exportState = {
              ...this.#exportState,
              status: "error",
              message: { key: "workbench.export.invalid" }
            };
            this.#render();
          }
        },
        this.#text
      );
    } else {
      this.#exportHost.replaceChildren();
    }
  }

  async #saveExportConfiguration(
    configuration: ExportConfiguration
  ): Promise<void> {
    const save = this.#services.saveExportConfiguration;
    if (!save) return;
    try {
      this.#exportConfigurations = Object.freeze([...(await save(configuration))]);
      this.#exportState = {
        selectedId: configuration.id,
        status: "idle",
        message: { key: "workbench.export.saved" }
      };
    } catch {
      this.#exportState = {
        selectedId: configuration.id,
        status: "error",
        message: { key: "workbench.export.status.saveFailed" }
      };
    }
    this.#render();
  }

  async #settleExports(): Promise<void> {
    while (this.#exportTasks.size > 0) {
      await Promise.allSettled([...this.#exportTasks]);
    }
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
        },
        sourceFormatLabel: this.#text.t("workbench.source.format"),
        sourceLanguageLabel: this.#text.t("workbench.source.language")
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
        message: this.#text.t("workbench.error.editorInit")
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
      try {
        const parsed = GalleyDocumentCodec.parse(previewHtml);
        previewHtml = GalleyDocumentCodec.serialize({
          ...parsed,
          bodyHtml: this.#services.resourceResolver.rewriteForDisplay(
            parsed.bodyHtml
          )
        });
      } catch {
        previewHtml = this.#services.resourceResolver.rewriteForDisplay(previewHtml);
      }
    }
    createSafePreviewFrame(
      this.#canvas,
      previewHtml,
      this.#text.t("preview.frameTitle")
    );
  }

  #localizedStateMessage(message: string): string {
    const messages: Readonly<Record<string, ReturnType<LocalizedText["t"]>>> = {
      "Ready": this.#text.t("common.status.idle"),
      "Configuration saved": this.#text.t("workbench.export.saved"),
      "Configuration save failed": this.#text.t("workbench.export.status.saveFailed"),
      "The last transaction outcome is ambiguous. No partial document was opened.":
        this.#text.t("workbench.error.openAmbiguous"),
      "Recovery is quarantined for this document. No file was changed.":
        this.#text.t("workbench.error.openQuarantined"),
      "The last transaction outcome is ambiguous. Saving is paused until recovery completes.":
        this.#text.t("workbench.error.recoveryAmbiguous"),
      "Galley Studio could not initialize this editor mode.":
        this.#text.t("workbench.error.editorInit"),
      "Galley Studio rejected an unsafe or invalid body edit.":
        this.#text.t("workbench.error.invalidEdit"),
      "Recovery is quarantined for this document. No file was overwritten.":
        this.#text.t("workbench.error.saveQuarantined"),
      "Galley Studio could not prove the save outcome. Recovery must complete before another save.":
        this.#text.t("workbench.error.saveAmbiguous"),
      "Galley Studio could not save this article.":
        this.#text.t("workbench.error.saveFailed")
    };
    return messages[message] ?? message;
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
        message: this.#text.t("workbench.error.invalidEdit")
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
          message: this.#text.t("workbench.error.saveQuarantined")
        });
      } else if (
        document.session.recoveryState?.().status === "ambiguous" ||
        errorCode(error) === "document_commit_ambiguous"
      ) {
        this.#autosave?.pause();
        this.#state = reduceWorkbenchState(this.#state, {
          type: "recovery-ambiguous",
          message: this.#text.t("workbench.error.saveAmbiguous")
        });
      } else {
        this.#state = reduceWorkbenchState(this.#state, {
          type: "error",
          message: this.#text.t("workbench.error.saveFailed")
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
      const replacement = parseHtmlFragment(
        transformed,
        selected
      ).firstElementChild;
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

  #subscribeLocale(): void {
    this.#unsubscribeLocale ??= this.#text.subscribe(() => this.#render());
  }

  #destroyAdapter(adapter: SelectableHtmlEditorAdapter): void {
    if (this.#adapterDestroyed.has(adapter)) return;
    this.#adapterDestroyed.add(adapter);
    adapter.destroy();
  }
}

export function isGalleyHtmlPath(path: string): boolean {
  return isNormalizedVaultRelativePath(path) && path.endsWith(".html");
}

function filePathFromState(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  if ("file" in state && typeof state.file === "string") return state.file;
  if ("path" in state && typeof state.path === "string") return state.path;
  return null;
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

function errorArtifactPath(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const fields = error as Record<string, unknown>;
  for (const key of ["artifactPath", "path"] as const) {
    const value = fields[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function recordOutcome(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "outcome" in error &&
    typeof error.outcome === "string"
    ? error.outcome
    : null;
}

function exportFailureMessage(
  error: unknown,
  artifactPath: string | null,
  copyFailedAfterExport: boolean
): LocalizedMessage {
  if (errorCode(error) === "export_record_failed" && artifactPath) {
    const outcome = recordOutcome(error);
    if (outcome === "recorded") {
      return {
        key: "workbench.export.status.recordedAfterCancellation",
        parameters: { path: artifactPath }
      };
    }
    if (outcome === "not-recorded") {
      return {
        key: "workbench.export.status.recordNotRecorded",
        parameters: { path: artifactPath }
      };
    }
    return {
      key: "workbench.export.status.recordAmbiguous",
      parameters: { path: artifactPath }
    };
  }
  if (errorCode(error) === "export_artifact_write_ambiguous" && artifactPath) {
    return {
      key: "workbench.export.status.artifactAmbiguous",
      parameters: { path: artifactPath }
    };
  }
  if (copyFailedAfterExport && artifactPath) {
    return {
      key: "workbench.export.status.copyFailedAfterExport",
      parameters: { path: artifactPath }
    };
  }
  return {
    key: copyFailedAfterExport
      ? "workbench.export.status.copyFailed"
      : "workbench.export.status.exportFailed"
  };
}
