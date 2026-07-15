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
}

export interface RichTextClipboardOptions {
  readonly document?: Document;
  readonly navigator?: { readonly clipboard?: ClipboardWriter };
  readonly ClipboardItem?: ClipboardItemConstructor | undefined;
  readonly Blob?: typeof Blob;
  readonly execCommand?: ((command: string) => boolean) | undefined;
}

export class RichTextClipboardError extends Error {
  readonly code = "clipboard_copy_failed" as const;

  constructor() {
    super("Galley could not copy rich text to the clipboard.");
    this.name = "RichTextClipboardError";
  }
}

export class RichTextClipboard {
  readonly #environment: RichTextClipboardEnvironment;

  constructor(environment?: RichTextClipboardOptions) {
    this.#environment = {
      document: environment?.document ?? document,
      navigator: environment?.navigator ?? navigator,
      ClipboardItem: environment && "ClipboardItem" in environment
        ? environment.ClipboardItem
        : globalThis.ClipboardItem,
      Blob: environment?.Blob ?? globalThis.Blob,
      execCommand: environment?.execCommand
    };
  }

  async copy(html: string): Promise<void> {
    const plain = semanticPlainText(html, this.#environment.document);
    const clipboard = "clipboard" in this.#environment.navigator
      ? this.#environment.navigator.clipboard
      : undefined;
    if (clipboard?.write && this.#environment.ClipboardItem) {
      const Item = this.#environment.ClipboardItem;
      const BlobType = this.#environment.Blob;
      await clipboard.write([
        new Item({
          "text/html": new BlobType([html], { type: "text/html" }),
          "text/plain": new BlobType([plain], { type: "text/plain" })
        })
      ]);
      return;
    }
    this.#fallbackCopy(html);
  }

  #fallbackCopy(html: string): void {
    const document = this.#environment.document;
    const host = document.createElement("div");
    host.dataset.galleyClipboardFallback = "";
    host.contentEditable = "true";
    host.style.cssText = "position:fixed;left:-10000px;top:0;opacity:0;pointer-events:none";
    host.innerHTML = html;
    document.body.append(host);
    try {
      const selection = document.getSelection();
      const range = document.createRange();
      range.selectNodeContents(host);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const copied = this.#environment.execCommand
        ? this.#environment.execCommand("copy")
        : document.execCommand?.("copy") ?? false;
      if (!copied) throw new RichTextClipboardError();
    } finally {
      document.getSelection()?.removeAllRanges();
      host.remove();
    }
  }
}

function semanticPlainText(html: string, document: Document): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const breakElement of template.content.querySelectorAll(
    "br,p,h1,h2,h3,h4,h5,h6,li,blockquote,section,article,tr"
  )) {
    if (breakElement.localName === "br") {
      breakElement.replaceWith(document.createTextNode("\n"));
    } else {
      breakElement.append(document.createTextNode("\n"));
    }
  }
  return (template.content.textContent ?? "")
    .replace(/[\t\r ]+\n/gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
}
