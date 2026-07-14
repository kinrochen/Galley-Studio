import {
  EditorLifecycleError,
  type HtmlEditorAdapter,
  type HtmlEditorMountOptions
} from "./HtmlEditorAdapter";

export class SourceBodyEditor implements HtmlEditorAdapter {
  private html = "";
  private hasMounted = false;
  private textarea: HTMLTextAreaElement | undefined;
  private inputListener: (() => void) | undefined;

  async mount(
    container: HTMLElement,
    bodyHtml: string,
    options: HtmlEditorMountOptions
  ): Promise<void> {
    if (this.hasMounted) {
      throw new EditorLifecycleError(
        "editor_already_mounted",
        "This source editor has already been mounted"
      );
    }

    this.hasMounted = true;
    this.html = bodyHtml;
    const textarea = container.ownerDocument.createElement("textarea");
    textarea.className = "galley-source-body-editor";
    textarea.setAttribute("aria-label", "HTML body source");
    textarea.value = bodyHtml;
    const inputListener = (): void => {
      this.html = textarea.value;
      options.onChange(this.html);
    };
    textarea.addEventListener("input", inputListener);
    container.append(textarea);
    this.textarea = textarea;
    this.inputListener = inputListener;
  }

  getHtml(): string {
    return this.textarea?.value ?? this.html;
  }

  setHtml(html: string): void {
    this.html = html;
    if (this.textarea) {
      this.textarea.value = html;
    }
  }

  focus(): void {
    this.textarea?.focus();
  }

  destroy(): void {
    const textarea = this.textarea;
    if (!textarea) {
      return;
    }
    if (this.inputListener) {
      textarea.removeEventListener("input", this.inputListener);
    }
    this.html = textarea.value;
    textarea.remove();
    this.textarea = undefined;
    this.inputListener = undefined;
  }
}
