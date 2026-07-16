import { isSafeAuthoringUrl } from "../security/AuthoringSanitizer";
import { parseHtmlFragment } from "../dom/HtmlFragment";

export type WechatValidationCode =
  | "wechat_document_shell"
  | "wechat_fragment_root"
  | "wechat_forbidden_tag"
  | "wechat_forbidden_attribute"
  | "wechat_forbidden_css"
  | "wechat_external_dependency"
  | "wechat_leaf_text";

export interface WechatValidationIssue {
  readonly code: WechatValidationCode;
  readonly message: string;
  readonly path: string;
}

export interface WechatValidationResult {
  readonly valid: boolean;
  readonly issues: readonly WechatValidationIssue[];
}

const DOCUMENT_SHELL = /<!doctype|<\/?(?:html|head|body)(?:\s|>)/iu;
const FORBIDDEN_TAGS = new Set(["style", "script", "div"]);
const FORBIDDEN_CSS: readonly [RegExp, string][] = [
  [/position\s*:\s*(?:fixed|absolute|sticky)/iu, "Unsupported position value."],
  [/float\s*:/iu, "Float is unsupported."],
  [/@media/iu, "Media queries are unsupported."],
  [/@keyframes/iu, "Keyframes are unsupported."],
  [/@import/iu, "CSS imports are unsupported."],
  [/display\s*:\s*grid/iu, "CSS grid is unsupported."],
  [/var\s*\(\s*--/iu, "CSS variables are unsupported."]
];
const REMOTE_FONT = /url\s*\(\s*['"]?https?:\/\/[^)]*\.(?:woff2?|ttf|otf|eot)/iu;
const URL_ATTRIBUTES = new Set(["cite", "href", "poster", "src"]);

export function validateWechatHtml(html: string): WechatValidationResult {
  const issues: WechatValidationIssue[] = [];
  if (DOCUMENT_SHELL.test(html)) {
    issues.push(issue("wechat_document_shell", "WeChat export must be an HTML fragment.", "(document)"));
  }

  const fragment = parseHtmlFragment(html);
  const contentElements = [...fragment.children];
  const root = contentElements[0];
  const nonWhitespaceOutsideRoot = [...fragment.childNodes].some(
    (node) =>
      node !== root &&
      (node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()))
  );
  if (
    contentElements.length !== 1 ||
    contentElements[0]?.localName !== "section" ||
    nonWhitespaceOutsideRoot
  ) {
    issues.push(issue("wechat_fragment_root", "WeChat export requires exactly one top-level section.", ":root"));
  }

  for (const element of fragment.querySelectorAll("*")) {
    const path = elementPath(element);
    if (FORBIDDEN_TAGS.has(element.localName)) {
      issues.push(issue("wechat_forbidden_tag", `Forbidden WeChat tag: ${element.localName}.`, path));
    }
    if (element.localName === "link") {
      issues.push(issue("wechat_external_dependency", "External stylesheets and fonts are unsupported.", path));
    }
    if (element.hasAttribute("class") || element.hasAttribute("id")) {
      issues.push(issue("wechat_forbidden_attribute", "class and id attributes are unsupported.", path));
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (/^on[a-z0-9_-]+$/iu.test(name)) {
        issues.push(issue("wechat_forbidden_attribute", `Executable attribute is unsupported: ${name}.`, path));
      }
      if (
        URL_ATTRIBUTES.has(name) &&
        !isSafeAuthoringUrl(attribute.value, name, element.localName)
      ) {
        issues.push(issue("wechat_external_dependency", `Unsafe URL is unsupported: ${name}.`, path));
      }
    }
    const style = element.getAttribute("style") ?? "";
    for (const [pattern, message] of FORBIDDEN_CSS) {
      if (pattern.test(style)) {
        issues.push(issue("wechat_forbidden_css", message, path));
      }
    }
    if (REMOTE_FONT.test(style)) {
      issues.push(issue("wechat_external_dependency", "Remote fonts are unsupported.", path));
    }
  }

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    if (!current.textContent?.trim()) continue;
    const parent: Element | null = current.parentElement;
    if (!parent?.closest("span[leaf]")) {
      issues.push(issue("wechat_leaf_text", "Every non-empty text leaf must be wrapped by span[leaf].", parent ? elementPath(parent) : ":root"));
    }
  }

  return Object.freeze({
    valid: issues.length === 0,
    issues: Object.freeze(uniqueIssues(issues))
  });
}

function issue(code: WechatValidationCode, message: string, path: string): WechatValidationIssue {
  return Object.freeze({ code, message, path });
}

function uniqueIssues(issues: readonly WechatValidationIssue[]): WechatValidationIssue[] {
  const seen = new Set<string>();
  return issues.filter(({ code, path }) => {
    const key = `${code}\0${path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function elementPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && parts.length < 8) {
    let part = current.localName;
    const parent: Element | null = current.parentElement;
    if (parent) {
      const localName = current.localName;
      const siblings = [...parent.children].filter((item) => item.localName === localName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(" > ") || ":root";
}
