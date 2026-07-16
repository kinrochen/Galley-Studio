import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const requiredReleaseFiles = [
  "main.js",
  "manifest.json",
  "styles.css",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md"
] as const;

describe("0.2.2 release configuration", () => {
  it("exposes real acceptance, benchmark, license, and release gates", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.["test:acceptance"]).toMatch(/vitest/u);
    expect(packageJson.scripts?.["benchmark:long"]).toMatch(/node/u);
    expect(packageJson.scripts?.["audit:licenses"]).toMatch(/node/u);
    expect(packageJson.scripts?.release).toMatch(/node/u);
    expect(packageJson.scripts?.["audit:secrets"]).toMatch(/node/u);
    expect(packageJson.scripts?.["audit:mobile"]).toMatch(/node/u);
    const release = packageJson.scripts?.release ?? "";
    expect(release.indexOf("build-release")).toBeLessThan(
      release.indexOf("audit:secrets")
    );
  });

  it("ships AGPL and pinned upstream attribution inputs", () => {
    expect(existsSync(resolve("LICENSE"))).toBe(true);
    expect(readFileSync(resolve("LICENSE"), "utf8")).toContain(
      "GNU AFFERO GENERAL PUBLIC LICENSE"
    );
    expect(readFileSync(resolve("THIRD_PARTY_NOTICES.md"), "utf8")).toContain(
      "ba1f4175519b481cb3566616c9e5178705067904"
    );
    const notices = readFileSync(resolve("THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toContain("https://github.com/kinrochen/Galley-Studio");
    expect(notices).toContain("Permission is hereby granted, free of charge");
    expect(notices).toContain("Apache License");
    expect(notices).toContain("Mozilla Public License Version 2.0");
    expect(notices).toContain("Copyright");
    expect(JSON.parse(readFileSync(resolve("manifest.json"), "utf8"))).toMatchObject({
      version: "0.2.2",
      id: "galley-studio",
      name: "Galley Studio",
      author: "Kinrochen",
      fundingUrl: "https://ifdian.net/a/kinrochen",
      isDesktopOnly: false
    });
  });

  it("declares the exact release ZIP allowlist", () => {
    const builder = readFileSync(resolve("tools/build-release.mjs"), "utf8");
    for (const file of requiredReleaseFiles) expect(builder).toContain(file);
    expect(builder).toContain("release/galley-studio-0.2.2.zip");
  });

  it("documents desktop/mobile boundaries, secrets, Skill ZIP safety, and AGPL source obligations", () => {
    const readme = readFileSync(resolve("README.md"), "utf8");
    const security = readFileSync(resolve("SECURITY.md"), "utf8");
    const workflow = readFileSync(resolve(".github/workflows/ci.yml"), "utf8");
    expect(readme).toContain("Desktop");
    expect(readme).toContain("Mobile");
    expect(readme).toContain("OpenAI-compatible");
    expect(readme).toContain("https://ifdian.net/a/kinrochen");
    expect(security).toContain("SecretStorage");
    expect(security).toContain("symbolic link");
    expect(security).toContain("never executed");
    expect(security).toContain("AGPL-3.0");
    expect(workflow).toContain("npm run test:acceptance");
    expect(workflow).toContain("npm run benchmark:long");
    expect(workflow).toContain("npm run audit:licenses");
    expect(workflow).toContain("npm run release");
    expect(workflow.lastIndexOf("npm run audit:secrets")).toBeGreaterThan(
      workflow.indexOf("npm run release")
    );
  });
});
