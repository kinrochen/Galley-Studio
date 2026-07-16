import { parseHtmlFragment } from "../dom/HtmlFragment";

const ROLE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const FORBIDDEN_TEMPLATE_ELEMENTS =
  "script,style,iframe,object,embed,form,input,button,textarea,select,svg,math";

export class ThemeComponentCatalog {
  readonly #templates: ReadonlyMap<string, HTMLElement>;

  private constructor(templates: Map<string, HTMLElement>) {
    this.#templates = templates;
  }

  static fromDocument(source: string | Document | Element): ThemeComponentCatalog {
    const root = componentRoot(source);
    const templates = new Map<string, HTMLElement>();
    const rootElement =
      root.nodeType === Node.ELEMENT_NODE ? (root as HTMLElement) : null;
    const candidates = [
      ...(rootElement?.matches("[data-galley-role]")
        ? [rootElement]
        : []),
      ...root.querySelectorAll<HTMLElement>("[data-galley-role]")
    ];
    for (const candidate of candidates) {
      const role = candidate.getAttribute("data-galley-role") ?? "";
      if (!ROLE.test(role) || templates.has(role)) continue;
      const template = sanitizeTemplate(candidate);
      if (template) templates.set(role, template);
    }
    return new ThemeComponentCatalog(templates);
  }

  has(role: string): boolean {
    return this.#templates.has(role);
  }

  roles(): string[] {
    return [...this.#templates.keys()].sort(compareText);
  }

  template(role: string): HTMLElement | null {
    const template = this.#templates.get(role);
    return template ? (template.cloneNode(true) as HTMLElement) : null;
  }
}

function componentRoot(source: string | Document | Element): ParentNode {
  if (typeof source !== "string") return source;
  return parseHtmlFragment(source);
}

function sanitizeTemplate(source: HTMLElement): HTMLElement | null {
  const clone = source.cloneNode(true) as HTMLElement;
  if (clone.matches(FORBIDDEN_TEMPLATE_ELEMENTS)) return null;
  clone.querySelectorAll(FORBIDDEN_TEMPLATE_ELEMENTS).forEach((element) => element.remove());
  for (const element of [clone, ...clone.querySelectorAll<HTMLElement>("*")]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "data-galley-original-src" ||
        name === "data-galley-original-href" ||
        ((name === "src" || name === "href") &&
          /^\s*javascript:/iu.test(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return clone;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
