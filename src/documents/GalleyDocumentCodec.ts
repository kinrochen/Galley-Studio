export interface GalleyDocument {
  doctype: "<!DOCTYPE html>";
  lang: string;
  headHtml: string;
  bodyHtml: string;
}

const HTML5_DOCTYPE_PATTERN = /^<!doctype\s+html\s*>$/i;
const LANGUAGE_PATTERN = /^[a-z]{1,8}(?:-[a-z0-9]{1,8})*$/i;
const SHELL_FRAGMENT_PATTERN = /<!doctype\b|<\/?(?:html|head|body)\b/i;

export class GalleyDocumentCodec {
  static parse(html: string): GalleyDocument {
    const source = html.trim();
    assertExplicitShell(source);

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
    assertFragment(document.headHtml, "head");
    assertFragment(document.bodyHtml, "body");

    const parsed = new DOMParser().parseFromString(
      "<!DOCTYPE html><html><head></head><body></body></html>",
      "text/html"
    );
    parsed.head.innerHTML = document.headHtml;
    parsed.body.innerHTML = document.bodyHtml;
    if (document.lang) {
      parsed.documentElement.setAttribute("lang", document.lang);
    }

    return `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
  }
}

function assertExplicitShell(html: string): void {
  const doctypes = matches(html, /<!doctype\b[^>]*>/gi);
  const htmlOpenings = matches(html, /<html\b[^>]*>/gi);
  const htmlClosings = matches(html, /<\/html\s*>/gi);
  const headOpenings = matches(html, /<head\b[^>]*>/gi);
  const headClosings = matches(html, /<\/head\s*>/gi);
  const bodyOpenings = matches(html, /<body\b[^>]*>/gi);
  const bodyClosings = matches(html, /<\/body\s*>/gi);

  if (
    doctypes.length !== 1 ||
    htmlOpenings.length !== 1 ||
    htmlClosings.length !== 1 ||
    headOpenings.length !== 1 ||
    headClosings.length !== 1 ||
    bodyOpenings.length !== 1 ||
    bodyClosings.length !== 1 ||
    !HTML5_DOCTYPE_PATTERN.test(doctypes[0]?.[0] ?? "")
  ) {
    throw new Error("Galley document requires one explicit doctype/html/head/body shell");
  }

  const positions = [
    doctypes[0]?.index,
    htmlOpenings[0]?.index,
    headOpenings[0]?.index,
    headClosings[0]?.index,
    bodyOpenings[0]?.index,
    bodyClosings[0]?.index,
    htmlClosings[0]?.index
  ];
  if (
    positions.some((position) => position === undefined) ||
    positions.some(
      (position, index) => index > 0 && position! <= positions[index - 1]!
    )
  ) {
    throw new Error("Galley document has a malformed document shell");
  }

  const doctypeStart = doctypes[0]?.index ?? 0;
  const htmlEnd =
    (htmlClosings[0]?.index ?? 0) + (htmlClosings[0]?.[0].length ?? 0);
  if (html.slice(0, doctypeStart).trim() || html.slice(htmlEnd).trim()) {
    throw new Error("Galley document cannot contain content outside its shell");
  }
}

function assertLanguage(lang: string): void {
  if (lang && !LANGUAGE_PATTERN.test(lang)) {
    throw new Error("Galley document language must be a safe language tag");
  }
}

function assertFragment(fragment: string, name: "head" | "body"): void {
  if (SHELL_FRAGMENT_PATTERN.test(fragment)) {
    throw new Error(`Galley ${name} HTML cannot contain document shell markup`);
  }
}

function matches(value: string, pattern: RegExp): RegExpMatchArray[] {
  return [...value.matchAll(pattern)];
}
