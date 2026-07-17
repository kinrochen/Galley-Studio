import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import { RichTextClipboard } from "../../src/export/RichTextClipboard";

describe("RichTextClipboard", () => {
  it("prefers the native Electron clipboard with HTML and semantic text", async () => {
    const nativeWrite = vi.fn();
    const execCommand = vi.fn(() => true);
    const clipboard = new RichTextClipboard({
      document,
      navigator: {},
      ClipboardItem: undefined,
      execCommand,
      nativeWrite
    });
    const html = '<section style="color: red"><p>标题</p><p>正文</p></section>';

    await clipboard.copy(html);

    expect(nativeWrite).toHaveBeenCalledWith({
      html,
      text: "标题\n正文"
    });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("writes text/html and semantic text/plain in one ClipboardItem", async () => {
    const write = vi.fn(async (_items: readonly unknown[]) => undefined);
    const ClipboardItem = class {
      constructor(readonly data: Record<string, Blob>) {}
    };
    const clipboard = new RichTextClipboard({
      document,
      navigator: { clipboard: { write } },
      ClipboardItem,
      Blob: NodeBlob as unknown as typeof Blob
    });

    await clipboard.copy("<section><h2>标题</h2><p>正文 <strong>重点</strong></p></section>");

    const item = (write.mock.calls[0]?.[0] as unknown[] | undefined)?.[0] as InstanceType<typeof ClipboardItem>;
    expect(Object.keys(item.data).sort()).toEqual(["text/html", "text/plain"]);
    expect(await item.data["text/html"]?.text()).toContain("<section>");
    expect(await item.data["text/plain"]?.text()).toContain("标题\n正文 重点");
  });

  it("removes fallback DOM in finally after success and failure", async () => {
    const execCommand = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const clipboard = new RichTextClipboard({
      document,
      navigator: {},
      ClipboardItem: undefined,
      execCommand
    });

    await clipboard.copy("<section><span>ok</span></section>");
    expect(document.querySelector("[data-galley-clipboard-fallback]")).toBeNull();
    await expect(clipboard.copy("<section><span>fail</span></section>"))
      .rejects.toMatchObject({ code: "clipboard_copy_failed" });
    expect(document.querySelector("[data-galley-clipboard-fallback]")).toBeNull();
  });

  it("prefers the rendered selection path used by browser preview pages", async () => {
    const write = vi.fn(async () => undefined);
    const execCommand = vi.fn(() => true);
    const ClipboardItem = class {
      constructor(readonly data: Record<string, Blob>) {}
    };
    const clipboard = new RichTextClipboard({
      document,
      navigator: { clipboard: { write } },
      ClipboardItem,
      execCommand
    });

    await clipboard.copy('<section style="color: red"><span>正文</span></section>');

    expect(write).not.toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("[data-galley-clipboard-fallback]")).toBeNull();
  });

  it("selects a rendered DOM range with the original inline styles", async () => {
    const execCommand = vi.fn(() => {
      const selection = document.getSelection();
      const range = selection?.getRangeAt(0);
      const selected = document.createElement("div");
      if (range) selected.append(range.cloneContents());
      expect(selected.innerHTML).toContain('style="color: red"');
      expect(selected.textContent).toBe("正文");
      return true;
    });
    const clipboard = new RichTextClipboard({
      document,
      navigator: {},
      ClipboardItem: undefined,
      execCommand
    });
    const html = '<section style="color: red"><span>正文</span></section>';

    await clipboard.copy(html);

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("[data-galley-clipboard-fallback]")).toBeNull();
  });
});
