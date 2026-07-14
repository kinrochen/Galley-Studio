import { describe, expect, it, vi } from "vitest";
import { SourceBodyEditor } from "../../src/editor/SourceBodyEditor";

describe("SourceBodyEditor", () => {
  it("owns only a body-fragment textarea and reports real input once", async () => {
    const host = document.createElement("div");
    const sibling = document.createElement("span");
    host.append(sibling);
    const onChange = vi.fn();
    const editor = new SourceBodyEditor();

    await editor.mount(host, "<p>one</p>", {
      documentBaseUrl: "app://vault/articles/",
      onChange
    });

    const textarea = host.querySelector("textarea");
    expect(textarea?.value).toBe("<p>one</p>");
    expect(onChange).not.toHaveBeenCalled();

    editor.setHtml("<p>two</p>");
    expect(editor.getHtml()).toBe("<p>two</p>");
    expect(onChange).not.toHaveBeenCalled();

    textarea!.value = "<article>typed</article>";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("<article>typed</article>");

    const focus = vi.spyOn(textarea!, "focus");
    editor.focus();
    expect(focus).toHaveBeenCalledOnce();

    editor.destroy();
    expect([...host.childNodes]).toEqual(expect.arrayContaining([sibling]));
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("uses textarea.value rather than parsing the body fragment", async () => {
    const host = document.createElement("div");
    const editor = new SourceBodyEditor();
    const fragment = '<img src=x onerror="window.__galleyProbe = true"><script>probe</script>';

    await editor.mount(host, fragment, {
      documentBaseUrl: "app://vault/",
      onChange: vi.fn()
    });

    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
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

    const detachedTextarea = host.querySelector("textarea")!;
    editor.destroy();
    editor.destroy();
    detachedTextarea.value = "after destroy";
    detachedTextarea.dispatchEvent(new Event("input"));
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
});
