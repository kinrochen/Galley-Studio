import { indentWithTab } from "@codemirror/commands";
import { html } from "@codemirror/lang-html";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup, EditorView } from "codemirror";
import * as prettier from "prettier/standalone";
import * as prettierPluginHtml from "prettier/plugins/html";

import {
  EditorLifecycleError,
  type HtmlEditorAdapter,
  type HtmlEditorMountOptions
} from "./HtmlEditorAdapter";

const SOURCE_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--color-blue)" },
  { tag: tags.attributeName, color: "var(--color-yellow)" },
  {
    tag: [tags.attributeValue, tags.string],
    color: "var(--color-green)"
  },
  { tag: tags.angleBracket, color: "var(--text-muted)" },
  { tag: tags.meta, color: "var(--color-purple)" },
  { tag: tags.character, color: "var(--color-orange)" },
  {
    tag: tags.comment,
    color: "var(--text-faint)",
    fontStyle: "italic"
  },
  {
    tag: tags.invalid,
    color: "var(--text-error)",
    textDecoration: "underline wavy"
  }
]);

export class SourceBodyEditor implements HtmlEditorAdapter {
  private html = "";
  private hasMounted = false;
  private edited = false;
  private suppressChanges = false;
  private revision = 0;
  private onChange: ((html: string) => void) | undefined;
  private view: EditorView | undefined;
  private shell: HTMLElement | undefined;

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
    this.edited = false;
    this.onChange = options.onChange;
    const formatted = await formatSourceHtml(bodyHtml);
    const document = container.ownerDocument;
    const shell = document.createElement("section");
    shell.className = "galley-source-code-editor";
    const toolbar = document.createElement("div");
    toolbar.className = "galley-source-code-editor__toolbar";
    const language = document.createElement("span");
    language.textContent = options.sourceLanguageLabel ?? "HTML";
    const format = document.createElement("button");
    format.type = "button";
    format.dataset.action = "format-source";
    format.textContent = options.sourceFormatLabel ?? "Format HTML";
    format.title = `${format.textContent} (Shift+Alt+F)`;
    const editorHost = document.createElement("div");
    editorHost.className = "galley-source-code-editor__host";
    toolbar.append(language, format);
    shell.append(toolbar, editorHost);
    container.append(shell);

    const view = new EditorView({
      doc: formatted,
      extensions: [
        basicSetup,
        html({
          matchClosingTags: false,
          selfClosingTags: true
        }),
        syntaxHighlighting(SOURCE_HIGHLIGHT_STYLE),
        keymap.of([
          {
            key: "Shift-Alt-f",
            run: () => {
              void this.formatCurrentDocument();
              return true;
            }
          },
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || this.suppressChanges) return;
          this.revision += 1;
          this.edited = true;
          this.html = update.state.doc.toString();
          this.onChange?.(this.html);
        })
      ],
      parent: editorHost
    });
    view.contentDOM.setAttribute("aria-label", "HTML body source");
    format.addEventListener("click", () => void this.formatCurrentDocument());
    this.view = view;
    this.shell = shell;
  }

  getHtml(): string {
    return this.edited ? this.view?.state.doc.toString() ?? this.html : this.html;
  }

  setHtml(html: string): void {
    this.html = html;
    this.edited = false;
    const revision = ++this.revision;
    this.replaceDocument(html);
    void formatSourceHtml(html).then((formatted) => {
      if (this.revision !== revision || !this.view) return;
      this.replaceDocument(formatted);
    });
  }

  focus(): void {
    this.view?.focus();
  }

  destroy(): void {
    if (this.edited && this.view) {
      this.html = this.view.state.doc.toString();
    }
    this.revision += 1;
    this.view?.destroy();
    this.shell?.remove();
    this.view = undefined;
    this.shell = undefined;
    this.onChange = undefined;
  }

  private replaceDocument(html: string): void {
    const view = this.view;
    if (!view || view.state.doc.toString() === html) return;
    this.suppressChanges = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: html }
      });
    } finally {
      this.suppressChanges = false;
    }
  }

  private async formatCurrentDocument(): Promise<void> {
    const view = this.view;
    if (!view) return;
    const source = view.state.doc.toString();
    const revision = ++this.revision;
    const formatted = await formatSourceHtml(source);
    if (
      this.view !== view ||
      this.revision !== revision ||
      view.state.doc.toString() !== source
    ) {
      return;
    }
    if (formatted === source) {
      if (!this.edited && source !== this.html) {
        this.edited = true;
        this.html = source;
        this.onChange?.(source);
      }
      return;
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted }
    });
  }
}

export async function formatSourceHtml(html: string): Promise<string> {
  try {
    return await prettier.format(html, {
      parser: "html",
      plugins: [prettierPluginHtml],
      printWidth: 120,
      tabWidth: 2,
      useTabs: false,
      htmlWhitespaceSensitivity: "css",
      endOfLine: "lf"
    });
  } catch {
    return html;
  }
}
