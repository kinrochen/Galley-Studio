import { describe, expect, it } from "vitest";
import {
  assertShellFreeHtmlFragment,
  locateHtmlDocument
} from "../../src/documents/HtmlShellScanner";
import {
  acceptedHtmlDocuments,
  recoveryDependentFragments,
  wrapBodyFragment
} from "../fixtures/htmlBoundaryCorpus";

describe("HtmlShellScanner strict lexical boundary", () => {
  it.each(acceptedHtmlDocuments)(
    "agrees with DOMParser on the explicit shell for $label",
    ({ html }) => {
      const range = locateHtmlDocument(html, {
        requireHead: true,
        allowSurroundingContent: false
      });
      const parsed = new DOMParser().parseFromString(html, "text/html");

      expect(html.slice(range.start, range.end)).toBe(html);
      expect(parsed.doctype?.name.toLowerCase()).toBe("html");
      expect(parsed.documentElement.localName).toBe("html");
      expect(parsed.querySelectorAll("html")).toHaveLength(1);
      expect(parsed.head.parentElement).toBe(parsed.documentElement);
      expect(parsed.body.parentElement).toBe(parsed.documentElement);
    }
  );

  it("accepts normal shell-free comments, quoted attributes, title, textarea, and script fragments", () => {
    const fragment =
      '<!-- valid --><p title="</body></html>">safe</p><title>plain</title><textarea>plain</textarea><script>alert(1)</script>';

    expect(() => assertShellFreeHtmlFragment(fragment, "body")).not.toThrow();
  });

  it.each(recoveryDependentFragments)(
    "fails closed for $label",
    ({ fragment }) => {
      expect(() => assertShellFreeHtmlFragment(fragment, "body")).toThrow(
        /fragment|malformed|invalid|ambiguous|unsupported|raw|comment|control|namespace|foreign/i
      );
      expect(() =>
        locateHtmlDocument(wrapBodyFragment(fragment), {
          requireHead: true,
          allowSurroundingContent: false
        })
      ).toThrow(/document|doctype|shell|malformed|invalid/i);
    }
  );
});
