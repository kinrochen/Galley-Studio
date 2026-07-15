import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it, vi } from "vitest";

import { RichTextClipboard } from "../../src/export/RichTextClipboard";

describe("RichTextClipboard", () => {
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
});
