export interface HtmlEditorMountOptions {
  documentBaseUrl: string;
  onChange(html: string): void;
  onSelectionChange?(element: HTMLElement | null): void;
  sourceFormatLabel?: string;
  sourceLanguageLabel?: string;
}

export interface HtmlEditorAdapter {
  mount(
    container: HTMLElement,
    bodyHtml: string,
    options: HtmlEditorMountOptions
  ): Promise<void>;
  getHtml(): string;
  setHtml(html: string): void;
  /** Selects one exact Galley source block when the adapter can address DOM nodes. */
  selectSource?(sourceId: string): boolean;
  focus(): void;
  destroy(): void;
}

export type EditorLifecycleErrorCode =
  | "editor_already_mounted"
  | "editor_init_invalid"
  | "editor_mount_cancelled";

export class EditorLifecycleError extends Error {
  readonly code: EditorLifecycleErrorCode;

  constructor(code: EditorLifecycleErrorCode, message: string) {
    super(message);
    this.name = "EditorLifecycleError";
    this.code = code;
  }
}
