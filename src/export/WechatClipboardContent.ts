import {
  assertShellFreeHtmlFragment,
  containsDocumentShellToken
} from "../documents/HtmlShellScanner";
import { sanitizeAuthoringDocument } from "../security/AuthoringSanitizer";

/**
 * Keeps an already generated WeChat fragment byte-for-byte intact. Complete
 * authoring documents still need their body shell removed before selection.
 */
export function prepareWechatClipboardContent(html: string): string {
  const source = html.trim();
  if (!containsDocumentShellToken(source)) {
    assertShellFreeHtmlFragment(source, "body");
    return source;
  }

  const sanitized = sanitizeAuthoringDocument(source).html;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  const article =
    parsed.body.querySelector(":scope > article") ??
    parsed.body.firstElementChild;
  if (!article) return '<section style="display: block"></section>';

  const root = parsed.createElement("section");
  for (const attribute of [...article.attributes]) {
    root.setAttribute(attribute.name, attribute.value);
  }
  root.append(...[...article.childNodes].map((node) => node.cloneNode(true)));
  return root.outerHTML;
}
