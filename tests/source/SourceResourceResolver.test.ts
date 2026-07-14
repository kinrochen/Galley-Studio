import { describe, expect, it, vi } from "vitest";
import { resolveSourceResources } from "../../src/source/SourceResourceResolver";

function resourceVault(
  existing: readonly string[],
  dimensions: Record<string, { width: number; height: number }> = {}
) {
  const paths = new Set(existing);
  return {
    exists: vi.fn(async (vaultPath: string) => paths.has(vaultPath)),
    readRasterDimensions: vi.fn(async (vaultPath: string) =>
      dimensions[vaultPath]
    )
  };
}

describe("resolveSourceResources", () => {
  it("resolves Markdown images relative to the source and reads raster dimensions", async () => {
    const vault = resourceVault(["notes/assets/hero.png"], {
      "notes/assets/hero.png": { width: 1200, height: 630 }
    });

    const resources = await resolveSourceResources(
      "![Launch art](assets/hero.png)",
      "notes/article.md",
      vault
    );

    expect(resources).toEqual([
      {
        vaultPath: "notes/assets/hero.png",
        alt: "Launch art",
        mediaType: "image/png",
        width: 1200,
        height: 630
      }
    ]);
    expect(vault.readRasterDimensions).toHaveBeenCalledWith(
      "notes/assets/hero.png",
      "image/png"
    );
  });

  it("uses the first normalized definition for a Markdown image reference", async () => {
    const vault = resourceVault([
      "notes/assets/first.png",
      "notes/assets/second.png"
    ]);
    const markdown = [
      "![Launch art][hero]",
      "",
      "[HERO]: assets/first.png",
      "[hero]: assets/second.png"
    ].join("\n");

    const resources = await resolveSourceResources(
      markdown,
      "notes/article.md",
      vault
    );

    expect(resources).toEqual([
      {
        vaultPath: "notes/assets/first.png",
        alt: "Launch art",
        mediaType: "image/png"
      }
    ]);
    expect(vault.exists).not.toHaveBeenCalledWith("notes/assets/second.png");
  });

  it("recognizes Obsidian embeds and honors explicit embed dimensions", async () => {
    const vault = resourceVault([
      "notes/media/cover.webp",
      "notes/media/poster.jpg"
    ], {
      "notes/media/cover.webp": { width: 800, height: 600 },
      "notes/media/poster.jpg": { width: 100, height: 100 }
    });

    const resources = await resolveSourceResources(
      "![[media/cover.webp|Cover art]]\n\n![[media/poster.jpg|640x480]]",
      "notes/article.md",
      vault
    );

    expect(resources).toEqual([
      {
        vaultPath: "notes/media/cover.webp",
        alt: "Cover art",
        mediaType: "image/webp",
        width: 800,
        height: 600
      },
      {
        vaultPath: "notes/media/poster.jpg",
        alt: "",
        mediaType: "image/jpeg",
        width: 640,
        height: 480
      }
    ]);
    expect(vault.readRasterDimensions).not.toHaveBeenCalledWith(
      "notes/media/poster.jpg",
      "image/jpeg"
    );
  });

  it("ignores odd-backslash escaped embeds but keeps even-backslash embeds", async () => {
    const vault = resourceVault([
      "notes/escaped.png",
      "notes/even.png"
    ]);
    const markdown = [
      "\\![[escaped.png]]",
      "\\\\![[even.png]]"
    ].join("\n\n");

    const resources = await resolveSourceResources(
      markdown,
      "notes/article.md",
      vault
    );

    expect(resources).toEqual([
      {
        vaultPath: "notes/even.png",
        alt: "",
        mediaType: "image/png"
      }
    ]);
    expect(vault.exists).not.toHaveBeenCalledWith("notes/escaped.png");
    expect(vault.readRasterDimensions).not.toHaveBeenCalledWith(
      "notes/escaped.png",
      "image/png"
    );
  });

  it("rejects network, absolute-system, and vault-escaping paths", async () => {
    const vault = resourceVault([]);
    const markdown = [
      "![network](https://example.com/image.png)",
      "![unix](/Users/alice/private.png)",
      "![windows](C:\\Users\\alice\\private.png)",
      "![[../../outside.jpg]]",
      "![data](data:image/png;base64,AAAA)"
    ].join("\n\n");

    expect(
      await resolveSourceResources(markdown, "article.md", vault)
    ).toEqual([]);
    expect(vault.exists).not.toHaveBeenCalled();
    expect(markdown).not.toContain("file://");
  });

  it("decodes encoded reserved filename characters after stripping literal suffixes", async () => {
    const vault = resourceVault([
      "notes/image#v1.png",
      "notes/image?v1.png",
      "notes/image.png"
    ]);
    const markdown = [
      "![hash](image%23v1.png)",
      "![question](image%3Fv1.png)",
      "![suffix](image.png?cache=1#preview)"
    ].join("\n\n");

    const resources = await resolveSourceResources(
      markdown,
      "notes/article.md",
      vault
    );

    expect(resources.map(({ vaultPath }) => vaultPath)).toEqual([
      "notes/image#v1.png",
      "notes/image?v1.png",
      "notes/image.png"
    ]);
  });

  it("rejects a source path that is not normalized inside the vault", async () => {
    const vault = resourceVault(["image.png"]);

    await expect(
      resolveSourceResources(
        "![image](image.png)",
        "notes/../../private/article.md",
        vault
      )
    ).rejects.toThrow(/source path.*vault-relative/i);
    expect(vault.exists).not.toHaveBeenCalled();
  });

  it.each([
    "notes\\article.md",
    "notes%2Farticle.md",
    "notes/article.md?query",
    "notes/article.md#fragment",
    "<notes/article.md>"
  ])("rejects non-canonical source path %j before vault access", async (sourcePath) => {
    const vault = resourceVault(["notes/image.png"]);

    await expect(
      resolveSourceResources("![image](image.png)", sourcePath, vault)
    ).rejects.toThrow(/source path.*canonical vault-relative/i);
    expect(vault.exists).not.toHaveBeenCalled();
    expect(vault.readRasterDimensions).not.toHaveBeenCalled();
  });

  it("does not treat image syntax inside code as a source resource", async () => {
    const vault = resourceVault(["notes/real.svg", "notes/ignored.png"]);
    const markdown = [
      "`![inline](ignored.png)`",
      "",
      "```md",
      "![[ignored.png]]",
      "```",
      "",
      "![real](real.svg)"
    ].join("\n");

    const resources = await resolveSourceResources(
      markdown,
      "notes/article.md",
      vault
    );

    expect(resources).toEqual([
      {
        vaultPath: "notes/real.svg",
        alt: "real",
        mediaType: "image/svg+xml"
      }
    ]);
    expect(vault.readRasterDimensions).not.toHaveBeenCalled();
  });

  it("returns metadata only and leaves the Markdown unchanged", async () => {
    const vault = resourceVault(["img.gif"], {
      "img.gif": { width: 10, height: 20 }
    });
    const markdown = "![pixel](img.gif)";

    const [resource] = await resolveSourceResources(markdown, "post.md", vault);

    expect(markdown).toBe("![pixel](img.gif)");
    expect(Object.keys(resource ?? {}).sort()).toEqual([
      "alt",
      "height",
      "mediaType",
      "vaultPath",
      "width"
    ]);
  });
});
