import { describe, expect, it, vi } from "vitest";
import { EditorView } from "codemirror";
import {
  SourceBodyEditor,
  formatSourceHtml
} from "../../src/editor/SourceBodyEditor";

if (!Range.prototype.getClientRects) {
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => []
  });
}

describe("SourceBodyEditor", () => {
  it("mounts a formatted HTML CodeMirror editor and reports document edits once", async () => {
    const host = document.createElement("div");
    const sibling = document.createElement("span");
    host.append(sibling);
    const onChange = vi.fn();
    const editor = new SourceBodyEditor();

    await editor.mount(host, "<p>one</p>", {
      documentBaseUrl: "app://vault/articles/",
      onChange
    });

    const editorElement = host.querySelector<HTMLElement>(".cm-editor");
    const view = EditorView.findFromDOM(editorElement!);
    expect(view?.state.doc.toString()).toBe("<p>one</p>\n");
    expect(host.querySelectorAll(".cm-line span").length).toBeGreaterThan(0);
    expect(host.querySelector("textarea")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    editor.setHtml("<p>two</p>");
    expect(editor.getHtml()).toBe("<p>two</p>");
    expect(onChange).not.toHaveBeenCalled();

    view!.dispatch({
      changes: {
        from: 0,
        to: view!.state.doc.length,
        insert: "<article>typed</article>"
      }
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("<article>typed</article>");

    const focus = vi.spyOn(view!.contentDOM, "focus");
    editor.focus();
    expect(focus).toHaveBeenCalledOnce();

    editor.destroy();
    expect([...host.childNodes]).toEqual(expect.arrayContaining([sibling]));
    expect(host.querySelector(".cm-editor")).toBeNull();
  });

  it("renders unsafe-looking source only as editable text", async () => {
    const host = document.createElement("div");
    const editor = new SourceBodyEditor();
    const fragment = '<img src=x onerror="window.__galleyProbe = true"><script>probe</script>';

    await editor.mount(host, fragment, {
      documentBaseUrl: "app://vault/",
      onChange: vi.fn()
    });

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("window.__galleyProbe");
    expect(editor.getHtml()).toBe(fragment);
    editor.destroy();
  });

  it("rejects duplicate mount and makes destruction idempotent", async () => {
    const host = document.createElement("div");
    const editor = new SourceBodyEditor();
    const options = {
      documentBaseUrl: "app://vault/",
      onChange: vi.fn()
    };

    await editor.mount(host, "<p>one</p>", options);
    await expect(editor.mount(host, "<p>again</p>", options)).rejects.toMatchObject({
      code: "editor_already_mounted"
    });

    editor.destroy();
    editor.destroy();
    expect(host.querySelector(".cm-editor")).toBeNull();
    expect(options.onChange).not.toHaveBeenCalled();
  });

  it("keeps lifecycle methods safe outside the mounted interval", () => {
    const editor = new SourceBodyEditor();

    expect(editor.getHtml()).toBe("");
    expect(() => editor.focus()).not.toThrow();
    expect(() => editor.setHtml("<p>queued</p>")).not.toThrow();
    expect(editor.getHtml()).toBe("<p>queued</p>");
    expect(() => editor.destroy()).not.toThrow();
    expect(() => editor.focus()).not.toThrow();
    expect(() => editor.setHtml("<p>after</p>")).not.toThrow();
    expect(editor.getHtml()).toBe("<p>after</p>");
  });

  it("formats nested body fragments with IDE-style indentation", async () => {
    await expect(
      formatSourceHtml("<section><section><p>text</p></section></section>")
    ).resolves.toBe(
      "<section>\n  <section><p>text</p></section>\n</section>\n"
    );
  });

  it("applies the visible automatic formatting when Format HTML is clicked", async () => {
    const host = document.createElement("div");
    const onChange = vi.fn();
    const editor = new SourceBodyEditor();
    const source = "<section><section><p>text</p></section></section>";
    await editor.mount(host, source, {
      documentBaseUrl: "app://vault/",
      onChange,
      sourceFormatLabel: "Format HTML"
    });

    (host.querySelector('[data-action="format-source"]') as HTMLButtonElement).click();

    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        "<section>\n  <section><p>text</p></section>\n</section>\n"
      )
    );
    expect(editor.getHtml()).toContain("\n  <section>");
    editor.destroy();
  });
});
