import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync } from "fflate";
import { expect, it } from "vitest";

it("contains exactly the five 0.1.0 release files when the release gate has run", () => {
  const path = resolve("release/galley-0.1.0.zip");
  if (!existsSync(path)) {
    // `npm test` intentionally runs before the release gate in CI. The final
    // `npm test -- tests/release` run exercises the archive branch below.
    expect(existsSync(resolve("tools/build-release.mjs"))).toBe(true);
    return;
  }
  const entries = unzipSync(new Uint8Array(readFileSync(path)));
  expect(Object.keys(entries).sort()).toEqual([
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
    "main.js",
    "manifest.json",
    "styles.css"
  ]);
  const manifest = JSON.parse(new TextDecoder().decode(entries["manifest.json"])) as {
    version?: string;
  };
  expect(manifest.version).toBe("0.1.0");
  expect(new TextDecoder().decode(entries.LICENSE)).toContain(
    "GNU AFFERO GENERAL PUBLIC LICENSE"
  );
  expect(new TextDecoder().decode(entries["THIRD_PARTY_NOTICES.md"])).toContain(
    "ba1f4175519b481cb3566616c9e5178705067904"
  );
});
