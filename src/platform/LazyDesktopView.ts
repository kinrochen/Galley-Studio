import {
  ItemView,
  type ViewStateResult,
  type WorkspaceLeaf
} from "obsidian";
import type { LocalizedText } from "../i18n/LocalizedText";

export const LAZY_WORKBENCH_VIEW_TYPE = "galley-workbench";
export const LAZY_THEME_LAB_VIEW_TYPE = "galley-theme-lab";

export type LazyDesktopViewKind = "workbench" | "theme-lab";

interface DelegatedDesktopView {
  readonly contentEl: HTMLElement;
  getDisplayText(): string;
  getState?(): unknown;
  setState?(state: unknown, result: ViewStateResult): Promise<void> | void;
  onOpen(): Promise<void> | void;
  onClose(): Promise<void> | void;
}

export class LazyDesktopView extends ItemView {
  #delegate: DelegatedDesktopView | null = null;
  #state: Record<string, unknown> = {};
  #stateResult: ViewStateResult = { history: false };

  constructor(
    leaf: WorkspaceLeaf,
    private readonly kind: LazyDesktopViewKind,
    private readonly host: unknown,
    private readonly text: LocalizedText
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return this.kind === "workbench"
      ? LAZY_WORKBENCH_VIEW_TYPE
      : LAZY_THEME_LAB_VIEW_TYPE;
  }

  getDisplayText(): string {
    return (
      this.#delegate?.getDisplayText() ??
      this.text.t(
        this.kind === "workbench" ? "workbench.title" : "themeLab.title"
      )
    );
  }

  getState(): Record<string, unknown> {
    const state = this.#delegate?.getState?.() ?? this.#state;
    return typeof state === "object" && state !== null
      ? (state as Record<string, unknown>)
      : {};
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    this.#state =
      typeof state === "object" && state !== null
        ? (state as Record<string, unknown>)
        : {};
    this.#stateResult = result;
    await this.#delegate?.setState?.(state, result);
  }

  async onOpen(): Promise<void> {
    if (this.#delegate) return;
    this.contentEl.classList.add("galley-lazy-view-host");
    const runtime = await import("./DesktopConsoleRuntime");
    const delegate = (this.kind === "workbench"
      ? runtime.createWorkbenchView(this.leaf, this.host as never)
      : runtime.createThemeLabView(this.leaf, this.host as never)) as DelegatedDesktopView;
    this.#delegate = delegate;
    delegate.contentEl.classList.add("galley-lazy-view-content");
    this.contentEl.replaceChildren(delegate.contentEl);
    await delegate.onOpen();
    await delegate.setState?.(this.#state, this.#stateResult);
  }

  async onClose(): Promise<void> {
    await this.#delegate?.onClose();
    this.#delegate = null;
    this.contentEl.replaceChildren();
    this.contentEl.classList.remove("galley-lazy-view-host");
  }
}
