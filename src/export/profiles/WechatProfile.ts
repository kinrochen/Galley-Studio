import {
  assertShellFreeHtmlFragment,
  containsDocumentShellToken
} from "../../documents/HtmlShellScanner";
import { sanitizeAuthoringDocument } from "../../security/AuthoringSanitizer";
import { sanitizeInlineStyle } from "../../security/InlineStyleSanitizer";
import type { ExportProfile, ExportProfileInput, ExportProfileOutput } from "../ExportProfile";

const SECTION_TAGS = new Set(["article", "aside", "div", "footer", "header", "main", "nav"]);
const REMOVE_TAGS = new Set(["script", "style", "link", "base", "iframe", "frame", "frameset", "object", "embed", "form"]);

export class WechatProfile implements ExportProfile {
  readonly id = "wechat" as const;
  readonly label = "WeChat editor";

  async transform(input: Readonly<ExportProfileInput>): Promise<Readonly<ExportProfileOutput>> {
    const sanitized = sanitizeAuthoringDocument(
      normalizeAuthoringInput(input.html)
    ).html;
    const source = new DOMParser().parseFromString(sanitized, "text/html");
    const article = source.body.querySelector(":scope > article") ?? source.body.firstElementChild;
    const target = document.implementation.createHTMLDocument("wechat");
    const root = target.createElement("section");
    const articleStyle = sanitizeInlineStyle(
      article?.getAttribute("style") ?? ""
    ).style;
    root.setAttribute(
      "style",
      hasDisplayDeclaration(articleStyle)
        ? articleStyle
        : [articleStyle, "display: block"].filter(Boolean).join("; ")
    );
    if (article) {
      for (const child of [...article.childNodes]) {
        root.append(target.importNode(child, true));
      }
    }
    normalizeElements(root);
    wrapTextLeaves(root);
    root.dataset.galleyDocumentId = input.provenance.documentId;
    root.dataset.galleySourceHash = input.provenance.sourceHtmlHash;
    return Object.freeze({
      profileId: this.id,
      html: root.outerHTML,
      mediaType: "text/html" as const
    });
  }
}

function normalizeAuthoringInput(html: string): string {
  const source = html.trim();
  if (containsDocumentShellToken(source)) return source;
  assertShellFreeHtmlFragment(source, "body");
  return [
    '<!DOCTYPE html><html lang="zh-CN"><head>',
    '<meta charset="utf-8"><title>Galley Studio</title>',
    "</head><body>",
    source,
    "</body></html>"
  ].join("");
}

function hasDisplayDeclaration(style: string): boolean {
  return /(?:^|;)\s*display\s*:/iu.test(style);
}

function normalizeElements(root: HTMLElement): void {
  for (const element of [...root.querySelectorAll("*")]) {
    if (REMOVE_TAGS.has(element.localName)) {
      element.remove();
      continue;
    }
    if (SECTION_TAGS.has(element.localName)) {
      const replacement = element.ownerDocument.createElement("section");
      for (const attribute of [...element.attributes]) {
        replacement.setAttribute(attribute.name, attribute.value);
      }
      replacement.append(...element.childNodes);
      element.replaceWith(replacement);
    }
  }
  for (const element of root.querySelectorAll("*")) {
    element.removeAttribute("class");
    element.removeAttribute("id");
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-galley-")) {
        element.removeAttribute(attribute.name);
      }
    }
    const style = sanitizeInlineStyle(element.getAttribute("style") ?? "").style;
    if (style) element.setAttribute("style", style);
    else element.removeAttribute("style");
  }
}

function wrapTextLeaves(root: HTMLElement): void {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (current.textContent?.trim()) textNodes.push(current as Text);
  }
  for (const text of textNodes) {
    if (text.parentElement?.closest("span[leaf]")) continue;
    const leaf = root.ownerDocument.createElement("span");
    leaf.setAttribute("leaf", "");
    text.replaceWith(leaf);
    leaf.append(text);
  }
}
