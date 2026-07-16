import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  HUGERTE_CONTENT_CSS,
  HUGERTE_CONTENT_SHA256,
  HUGERTE_INLINE_SKIN_CSS,
  HUGERTE_SKIN_SHA256,
  HUGERTE_SKIN_VERSION
} from "../../src/generated/hugerteSkin";

const execFileAsync = promisify(execFile);
const generatedPath = resolve(process.cwd(), "src/generated/hugerteSkin.ts");
const generatorPath = resolve(process.cwd(), "tools/embed-hugerte-assets.mjs");
const stylesPath = resolve(process.cwd(), "styles.css");

describe("embedded HugeRTE assets", () => {
  it("exports non-empty, pinned, hashed CSS with the approved font stack and no remote loads", () => {
    expect(HUGERTE_SKIN_VERSION).toBe("1.0.12");
    expect(HUGERTE_INLINE_SKIN_CSS.length).toBeGreaterThan(1_000);
    expect(HUGERTE_CONTENT_CSS.length).toBeGreaterThan(100);
    expect(HUGERTE_SKIN_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(HUGERTE_CONTENT_SHA256).toMatch(/^[a-f0-9]{64}$/u);
    expect(`${HUGERTE_INLINE_SKIN_CSS}\n${HUGERTE_CONTENT_CSS}`)
      .toContain("Inter,\"Noto Sans SC\",\"Noto Sans\",sans-serif");
    expect(`${HUGERTE_INLINE_SKIN_CSS}\n${HUGERTE_CONTENT_CSS}`)
      .not.toMatch(/@import\s+[^;]*(?:https?:)?\/\//iu);
    expect(`${HUGERTE_INLINE_SKIN_CSS}\n${HUGERTE_CONTENT_CSS}`)
      .not.toMatch(/url\(\s*["']?(?:https?:)?\/\//iu);
  });

  it("embeds the pinned UI skin in the plugin stylesheet", async () => {
    const styles = await readFile(stylesPath, "utf8");
    expect(styles).toContain("BEGIN GALLEY STUDIO BUNDLED HUGERTE SKIN");
    expect(styles).toContain(HUGERTE_INLINE_SKIN_CSS.slice(0, 200));
    expect(styles).toContain("END GALLEY STUDIO BUNDLED HUGERTE SKIN");
  });

  it("generates byte-identical output on repeated runs", async () => {
    await execFileAsync(process.execPath, [generatorPath]);
    const first = await readFile(generatedPath, "utf8");
    await execFileAsync(process.execPath, [generatorPath]);
    const second = await readFile(generatedPath, "utf8");
    expect(second).toBe(first);
  });

  it("rejects an installed package version other than the pinned version", async () => {
    await expect(execFileAsync(process.execPath, [
      generatorPath,
      "--expected-version=0.0.0"
    ])).rejects.toMatchObject({
      stderr: expect.stringContaining("Expected hugerte 0.0.0")
    });
  });
});
