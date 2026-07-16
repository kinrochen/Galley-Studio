import {
  assertShellFreeHtmlFragment,
  locateHtmlDocument
} from "./HtmlShellScanner";
import { replaceChildrenWithHtml } from "../dom/HtmlFragment";

export interface GalleyDocument {
  doctype: "<!DOCTYPE html>";
  lang: string;
  headHtml: string;
  bodyHtml: string;
}

const LANGUAGE_PATTERN = /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i;

export class GalleyDocumentCodec {
  static parse(html: string): GalleyDocument {
    const source = html.trim();
    locateHtmlDocument(source, {
      requireHead: true,
      allowSurroundingContent: false
    });

    const parsed = new DOMParser().parseFromString(source, "text/html");
    if (
      parsed.doctype?.name.toLowerCase() !== "html" ||
      parsed.documentElement.localName !== "html" ||
      !parsed.head ||
      !parsed.body
    ) {
      throw new Error("Galley document has an invalid HTML5 document shell");
    }

    const lang = parsed.documentElement.getAttribute("lang") ?? "";
    assertLanguage(lang);

    return {
      doctype: "<!DOCTYPE html>",
      lang,
      headHtml: parsed.head.innerHTML,
      bodyHtml: parsed.body.innerHTML
    };
  }

  static serialize(document: GalleyDocument): string {
    if (document.doctype !== "<!DOCTYPE html>") {
      throw new Error("Galley document requires the canonical HTML5 doctype");
    }
    assertLanguage(document.lang);
    assertShellFreeHtmlFragment(document.headHtml, "head");
    assertShellFreeHtmlFragment(document.bodyHtml, "body");

    const parsed = new DOMParser().parseFromString(
      "<!DOCTYPE html><html><head></head><body></body></html>",
      "text/html"
    );
    replaceChildrenWithHtml(parsed.head, document.headHtml);
    replaceChildrenWithHtml(parsed.body, document.bodyHtml);
    if (document.lang) {
      parsed.documentElement.setAttribute("lang", document.lang);
    }

    const intended = {
      lang: parsed.documentElement.getAttribute("lang") ?? "",
      headHtml: parsed.head.innerHTML,
      bodyHtml: parsed.body.innerHTML
    };
    const serialized = `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
    locateHtmlDocument(serialized, {
      requireHead: true,
      allowSurroundingContent: false
    });

    const reparsed = new DOMParser().parseFromString(serialized, "text/html");
    const actual = {
      lang: reparsed.documentElement.getAttribute("lang") ?? "",
      headHtml: reparsed.head.innerHTML,
      bodyHtml: reparsed.body.innerHTML
    };
    if (
      actual.lang !== intended.lang ||
      actual.headHtml !== intended.headHtml ||
      actual.bodyHtml !== intended.bodyHtml
    ) {
      throw new Error(
        "Galley document fragments are not stable in their head/body context"
      );
    }

    return serialized;
  }
}

function assertLanguage(lang: string): void {
  if (lang && !LANGUAGE_PATTERN.test(lang)) {
    throw new Error("Galley document language must be a safe language tag");
  }
}
