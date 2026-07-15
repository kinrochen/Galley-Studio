import { sanitizeAuthoringDocument } from "../../security/AuthoringSanitizer";
import { sanitizeInlineStyle } from "../../security/InlineStyleSanitizer";
import type { ExportProfile, ExportProfileInput, ExportProfileOutput } from "../ExportProfile";

export class PortableInlineProfile implements ExportProfile {
  readonly id = "portable-inline" as const;
  readonly label = "Portable inline";

  async transform(input: Readonly<ExportProfileInput>): Promise<Readonly<ExportProfileOutput>> {
    const parsed = new DOMParser().parseFromString(input.html, "text/html");
    inlineStyleRules(parsed);
    for (const dependency of parsed.querySelectorAll("style,link,script,noscript,iframe,object,embed,base")) {
      dependency.remove();
    }
    for (const element of parsed.querySelectorAll("*")) {
      const style = sanitizeInlineStyle(element.getAttribute("style") ?? "").style;
      if (style) element.setAttribute("style", style);
      else element.removeAttribute("style");
    }
    const html = sanitizeAuthoringDocument(
      `<!DOCTYPE html>${parsed.documentElement.outerHTML}`
    ).html;
    const safe = new DOMParser().parseFromString(html, "text/html");
    const root = safe.body.querySelector(":scope > article") ?? safe.body.firstElementChild;
    if (!root) throw new Error("Portable export requires an article body.");
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name.startsWith("data-galley-")) {
          element.removeAttribute(attribute.name);
        }
      }
    }
    return Object.freeze({
      profileId: this.id,
      html: root.outerHTML,
      mediaType: "text/html" as const
    });
  }
}

function inlineStyleRules(document: Document): void {
  const authoredInline = new WeakMap<Element, string>();
  const stylesheetDeclarations = new WeakMap<Element, string[]>();
  const matchedElements = new Set<Element>();
  for (const style of document.querySelectorAll("style")) {
    const css = style.textContent ?? "";
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const selector = match[1]?.trim();
      const declarations = match[2]?.trim();
      if (!selector || !declarations || selector.startsWith("@")) continue;
      let matches: NodeListOf<Element>;
      try {
        matches = document.querySelectorAll(selector);
      } catch {
        continue;
      }
      for (const element of matches) {
        if (!authoredInline.has(element)) {
          authoredInline.set(element, element.getAttribute("style") ?? "");
        }
        const accumulated = stylesheetDeclarations.get(element) ?? [];
        accumulated.push(declarations);
        stylesheetDeclarations.set(element, accumulated);
        matchedElements.add(element);
      }
    }
  }
  for (const element of matchedElements) {
    const combined = [
      ...(stylesheetDeclarations.get(element) ?? []),
      authoredInline.get(element) ?? ""
    ].filter(Boolean).join(";");
    const sanitized = sanitizeInlineStyle(combined).style;
    if (sanitized) element.setAttribute("style", sanitized);
    else element.removeAttribute("style");
  }
}
