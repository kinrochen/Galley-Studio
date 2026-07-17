import { describe, expect, it, vi } from "vitest";

import {
  MAX_PREVIEW_IMAGE_BYTES,
  PreviewResourceResolver
} from "../../src/preview/PreviewResourceResolver";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00
]);

describe("PreviewResourceResolver", () => {
  it("embeds a validated document-relative vault image", async () => {
    const read = vi.fn(async () => PNG);
    const resolver = new PreviewResourceResolver(read);

    const html = await resolver.rewriteForPreview(
      '<p><img src="./images/cover.png" alt="cover"></p>',
      "notes/article.html"
    );

    expect(read).toHaveBeenCalledWith("notes/images/cover.png");
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toContain("data-galley-original");
  });

  it("leaves remote, missing, unsafe, unsupported, and oversized sources unchanged", async () => {
    const oversized = new Uint8Array(MAX_PREVIEW_IMAGE_BYTES + 1);
    oversized.set(PNG);
    const read = vi.fn(async (path: string) => {
      if (path.endsWith("missing.png")) return null;
      if (path.endsWith("fake.png")) return new TextEncoder().encode("not an image");
      return oversized;
    });
    const resolver = new PreviewResourceResolver(read);
    const source = [
      '<img src="https://example.com/remote.png">',
      '<img src="../../escape.png">',
      '<img src="missing.png">',
      '<img src="fake.png">',
      '<img src="large.png">'
    ].join("");

    const html = await resolver.rewriteForPreview(source, "notes/article.html");

    expect(html).toContain('src="https://example.com/remote.png"');
    expect(html).toContain('src="../../escape.png"');
    expect(html).toContain('src="missing.png"');
    expect(html).toContain('src="fake.png"');
    expect(html).toContain('src="large.png"');
    expect(html).not.toContain("data:image/");
  });

  it("keeps the rest of the preview available when one vault read fails", async () => {
    const resolver = new PreviewResourceResolver(async (path) => {
      if (path.endsWith("broken.png")) throw new Error("read failed");
      return PNG;
    });

    const html = await resolver.rewriteForPreview(
      '<img src="broken.png"><img src="working.png">',
      "notes/article.html"
    );

    expect(html).toContain('src="broken.png"');
    expect(html).toContain('src="data:image/png;base64,');
  });
});
