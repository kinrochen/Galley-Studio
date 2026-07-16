import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = resolve("tools/audit-secrets.mjs");
const canary = "sk-" + "reviewcanary0123456789abcdef";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("post-release secret audit", () => {
  it("fails closed when current main.js or release ZIP is missing", () => {
    const root = temporaryRoot();
    expect(runAudit(root).status).not.toBe(0);
  });

  it("detects canaries in both current main.js and release ZIP entries", () => {
    const mainCanary = temporaryRoot();
    writeFileSync(join(mainCanary, "main.js"), `const leaked = "${canary}";`);
    writeRelease(mainCanary, "clean bundle");
    expect(runAudit(mainCanary).status).not.toBe(0);

    const zipCanary = temporaryRoot();
    writeFileSync(join(zipCanary, "main.js"), "clean bundle");
    writeRelease(zipCanary, `const leaked = "${canary}";`);
    expect(runAudit(zipCanary).status).not.toBe(0);
  });

  it("accepts clean current build and release artifacts", () => {
    const root = temporaryRoot();
    writeFileSync(join(root, "main.js"), "clean bundle");
    writeRelease(root, "clean bundle");
    expect(runAudit(root)).toMatchObject({ status: 0 });
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "galley-secret-audit-"));
  roots.push(root);
  return root;
}

function writeRelease(root: string, main: string): void {
  const release = join(root, "release");
  requireDirectory(release);
  writeFileSync(
    join(release, "galley-0.2.0.zip"),
    zipSync({
      "main.js": strToU8(main),
      "manifest.json": strToU8("{}"),
      "styles.css": strToU8("clean"),
      "LICENSE": strToU8("clean"),
      "THIRD_PARTY_NOTICES.md": strToU8("clean")
    })
  );
}

function requireDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function runAudit(root: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8"
  });
}
