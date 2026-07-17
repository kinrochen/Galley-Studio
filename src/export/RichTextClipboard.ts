interface ClipboardWriter {
  write(items: readonly unknown[]): Promise<void>;
}

interface ClipboardItemConstructor {
  new (items: Record<string, Blob>): unknown;
}

export interface RichTextClipboardEnvironment {
  readonly document: Document;
  readonly navigator: { readonly clipboard?: ClipboardWriter };
  readonly ClipboardItem: ClipboardItemConstructor | undefined;
  readonly Blob: typeof Blob;
  readonly execCommand: ((command: string) => boolean) | undefined;
  readonly nativeWrite:
    | ((data: { readonly html: string; readonly text: string }) => void)
    | undefined;
}

export interface RichTextClipboardOptions {
  readonly document?: Document;
  readonly navigator?: { readonly clipboard?: ClipboardWriter };
  readonly ClipboardItem?: ClipboardItemConstructor | undefined;
  readonly Blob?: typeof Blob;
  readonly execCommand?: ((command: string) => boolean) | undefined;
  readonly nativeWrite?: (
    data: { readonly html: string; readonly text: string }
  ) => void;
}

export class RichTextClipboardError extends Error {
  readonly code = "clipboard_copy_failed" as const;

  constructor(reason?: unknown) {
    const detail = errorDetail(reason);
    super(
      detail
        ? `Galley could not copy rich text to the clipboard: ${detail}`
        : "Galley could not copy rich text to the clipboard."
    );
    this.name = "RichTextClipboardError";
  }
}

export class RichTextClipboard {
  readonly #environment: RichTextClipboardEnvironment;

  constructor(environment?: RichTextClipboardOptions) {
    const activeDocument = environment?.document ?? document;
    const activeWindow = activeDocument.defaultView ?? window;
    this.#environment = {
      document: activeDocument,
      navigator: environment?.navigator ?? activeWindow.navigator,
      ClipboardItem: environment && "ClipboardItem" in environment
        ? environment.ClipboardItem
        : activeWindow.ClipboardItem,
      Blob: environment?.Blob ?? activeWindow.Blob,
      execCommand: environment?.execCommand,
      nativeWrite: environment?.nativeWrite
    };
  }

  async copy(html: string): Promise<void> {
    const plain = semanticPlainText(html, this.#environment.document);
    let nativeWriteError: unknown;
    if (this.#environment.nativeWrite) {
      try {
        this.#environment.nativeWrite({ html, text: plain });
        return;
      } catch (error) {
        nativeWriteError = error;
      }
    }
    let renderedSelectionError: unknown;
    try {
      this.#copyRenderedSelection(html);
      return;
    } catch (error) {
      renderedSelectionError = error;
    }

    const clipboard = "clipboard" in this.#environment.navigator
      ? this.#environment.navigator.clipboard
      : undefined;
    if (clipboard?.write && this.#environment.ClipboardItem) {
      const Item = this.#environment.ClipboardItem;
      const BlobType = this.#environment.Blob;
      try {
        await clipboard.write([
          new Item({
            "text/html": new BlobType([html], { type: "text/html" }),
            "text/plain": new BlobType([plain], { type: "text/plain" })
          })
        ]);
        return;
      } catch (error) {
        throw new RichTextClipboardError(error);
      }
    }
    throw new RichTextClipboardError(
      nativeWriteError ?? renderedSelectionError
    );
  }

  #copyRenderedSelection(html: string): void {
    const document = this.#environment.document;
    const host = document.createElement("div");
    host.dataset.galleyClipboardFallback = "";
    host.contentEditable = "true";
    host.className = "galley-clipboard-fallback";
    host.replaceChildren(parseHtmlFragment(html, host));
    document.body.append(host);
    try {
      const selection = document.getSelection();
      if (!selection) throw new Error("the document has no active selection");
      const range = document.createRange();
      range.selectNodeContents(host);
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = this.#environment.execCommand
        ? this.#environment.execCommand("copy")
        : document.execCommand?.("copy") ?? false;
      if (!copied) throw new Error("the rendered rich-text copy command was rejected");
    } finally {
      document.getSelection()?.removeAllRanges();
      host.remove();
    }
  }
}

function errorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return typeof error === "string" ? error.trim() : "";
}

function semanticPlainText(html: string, document: Document): string {
  const fragment = parseHtmlFragment(html, document.body);
  for (const breakElement of fragment.querySelectorAll(
    "br,p,h1,h2,h3,h4,h5,h6,li,blockquote,section,article,tr"
  )) {
    if (breakElement.localName === "br") {
      breakElement.replaceWith(document.createTextNode("\n"));
    } else {
      breakElement.append(document.createTextNode("\n"));
    }
  }
  return (fragment.textContent ?? "")
    .replace(/[\t\r ]+\n/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}
import { parseHtmlFragment } from "../dom/HtmlFragment";
