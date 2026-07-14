import {
  inspectHtmlShellTokens,
  locateHtmlDocument
} from "../documents/HtmlShellScanner";
import type { ValidationIssue } from "./ValidationIssue";

const STYLESHEET_SELECTOR =
  'style, link[rel~="stylesheet"], link[as="style"]';

export function validateAuthoringContract(html: string): ValidationIssue[] {
  if (typeof html !== "string") {
    return [
      issue(
        "document_shell",
        "Authoring output must be a complete HTML document string."
      )
    ];
  }

  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [
      issue(
        "document_shell",
        "Authoring output could not be parsed as an HTML document."
      )
    ];
  }

  const issues: ValidationIssue[] = [];
  const shellIssue = validateShell(html, document);
  if (shellIssue) {
    issues.push(shellIssue);
  }

  const titles = [...document.head.querySelectorAll("title")];
  if (titles.length !== 1 || !titles[0]?.textContent?.trim()) {
    issues.push(
      issue(
        "document_title",
        "Authoring document head must contain exactly one non-empty title.",
        "head > title"
      )
    );
  }

  const charsets = [...document.head.querySelectorAll("meta[charset]")];
  if (
    charsets.length !== 1 ||
    charsets[0]?.getAttribute("charset")?.trim().toLowerCase() !== "utf-8"
  ) {
    issues.push(
      issue(
        "document_charset",
        'Authoring document head must contain exactly one <meta charset="utf-8">.',
        "head > meta[charset]"
      )
    );
  }

  const viewports = [...document.head.querySelectorAll("meta[name]")].filter(
    (meta) => meta.getAttribute("name")?.trim().toLowerCase() === "viewport"
  );
  if (
    viewports.length !== 1 ||
    !viewports[0]?.getAttribute("content")?.trim()
  ) {
    issues.push(
      issue(
        "document_viewport",
        "Authoring document head must contain exactly one non-empty viewport meta declaration.",
        'head > meta[name="viewport"]'
      )
    );
  }

  if (!findAuthoringArticleRoot(document)) {
    issues.push(
      issue(
        "document_article_root",
        "Authoring document body must contain exactly one article as its sole content root.",
        "body > article"
      )
    );
  }

  if (document.querySelector(STYLESHEET_SELECTOR)) {
    issues.push(
      issue(
        "document_styles_inline",
        "Authoring documents must keep article styles inline and must not depend on style blocks or stylesheet links.",
        STYLESHEET_SELECTOR
      )
    );
  }

  return issues;
}

function validateShell(
  html: string,
  document: Document
): ValidationIssue | undefined {
  try {
    locateHtmlDocument(html.trim(), {
      requireHead: true,
      allowSurroundingContent: false
    });
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (document.doctype?.name.toLowerCase() !== "html") {
      return issue(
        "document_doctype",
        "Authoring document must begin with one valid HTML5 doctype."
      );
    }
    if (
      message.includes("canonical HTML5 doctype") ||
      message.includes("candidate does not start with an HTML5 doctype") ||
      message.includes("doctype and html root are malformed or out of order")
    ) {
      return issue(
        "document_doctype",
        "Authoring document must begin with one valid HTML5 doctype."
      );
    }

    try {
      const counts = inspectHtmlShellTokens(html.trim());
      if (counts.doctypes !== 1) {
        return issue(
          "document_doctype",
          "Authoring document must contain exactly one valid HTML5 doctype."
        );
      }
      if (counts.htmlStarts !== 1 || counts.htmlEnds !== 1) {
        return issue(
          "document_html",
          "Authoring document must contain exactly one explicit html root.",
          "html"
        );
      }
    } catch {
      // The scanner's original structural error is classified below.
    }

    try {
      locateHtmlDocument(html.trim(), {
        requireHead: false,
        allowSurroundingContent: false
      });
      return issue(
        "document_head",
        "Authoring document must contain one explicit head before its body.",
        "html > head"
      );
    } catch {
      // The strict scanner remains the structural authority. The stable scanner
      // diagnostic only selects the most actionable contract code below.
    }

    if (
      message.includes("html root") ||
      message.includes("<html>") ||
      message.includes("html root closes")
    ) {
      return issue(
        "document_html",
        "Authoring document must contain exactly one explicit html root.",
        "html"
      );
    }
    if (message.includes("head") && !message.includes("body")) {
      return issue(
        "document_head",
        "Authoring document must contain one explicit head before its body.",
        "html > head"
      );
    }
    if (message.includes("body")) {
      return issue(
        "document_body",
        "Authoring document must contain one explicit body inside its html root.",
        "html > body"
      );
    }
    return issue(
      "document_shell",
      "Authoring output must contain one well-formed doctype/html/head/body document shell."
    );
  }
}

export function findAuthoringArticleRoot(
  document: Document
): HTMLElement | undefined {
  const body = document.body;
  if (
    body.children.length !== 1 ||
    body.firstElementChild?.localName !== "article"
  ) {
    return undefined;
  }

  const article = body.firstElementChild as HTMLElement;
  const isSoleContentRoot = [...body.childNodes].every(
    (node) =>
      node === article ||
      node.nodeType === Node.COMMENT_NODE ||
      (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())
  );
  return isSoleContentRoot ? article : undefined;
}

function issue(
  code: string,
  message: string,
  selector?: string
): ValidationIssue {
  return {
    code,
    severity: "error",
    message,
    ...(selector === undefined ? {} : { selector })
  };
}
