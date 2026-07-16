import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { unzipSync } from "fflate";

export const BUNDLE_META_PATH = "release/.galley-esbuild-meta.json";
export const GALLEY_SOURCE_URL = "https://github.com/kinrochen/Galley";
export const UPSTREAM_SOURCE_URL = "https://github.com/isjiamu/gzh-design-skill";
export const UPSTREAM_COMMIT = "ba1f4175519b481cb3566616c9e5178705067904";

export async function loadBundleLicenseInventory() {
  const meta = JSON.parse(await readFile(BUNDLE_META_PATH, "utf8"));
  const roots = new Map();
  for (const input of Object.keys(meta.inputs ?? {})) {
    const root = packageRootForInput(input);
    if (root) roots.set(root.name, root.path);
  }
  const packages = [];
  for (const [name, root] of [...roots].sort(([left], [right]) => left.localeCompare(right))) {
    const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
    if (packageJson.name !== name || typeof packageJson.version !== "string") {
      throw new Error(`Invalid bundled package metadata: ${name}`);
    }
    const licenseNames = (await readdir(root))
      .filter((entry) => /^(?:licen[cs]e|notice|copying)(?:[._-].*)?$/iu.test(entry))
      .sort((left, right) => left.localeCompare(right));
    if (licenseNames.length === 0) {
      throw new Error(`Bundled package has no distributed license/notice file: ${name}`);
    }
    const licenseFiles = [];
    for (const filename of licenseNames) {
      licenseFiles.push({
        filename,
        text: normalizeText(await readFile(resolve(root, filename), "utf8"))
      });
    }
    packages.push(Object.freeze({
      name,
      version: packageJson.version,
      license: typeof packageJson.license === "string" ? packageJson.license : "missing",
      source: sourceUrl(packageJson),
      licenseFiles: Object.freeze(licenseFiles)
    }));
  }
  if (packages.length === 0) throw new Error("Production bundle contains no auditable runtime packages.");
  return Object.freeze(packages);
}

export async function renderThirdPartyNotices() {
  const packages = await loadBundleLicenseInventory();
  const upstreamLicense = await bundledUpstreamLicense();
  const lines = [
    "# Third-Party Notices",
    "",
    "This file is generated from the production esbuild dependency graph. It contains",
    "the complete license/notice files distributed by every bundled runtime package.",
    "",
    "## Galley corresponding source",
    "",
    `- Source: ${GALLEY_SOURCE_URL}`,
    "- Project license: GNU Affero General Public License v3.0 (AGPL-3.0)",
    "",
    "## gzh-design-skill",
    "",
    `- Source: ${UPSTREAM_SOURCE_URL}`,
    `- Pinned commit: \`${UPSTREAM_COMMIT}\``,
    "- License: GNU Affero General Public License v3.0 (AGPL-3.0)",
    "",
    "Galley embeds the regular files from that pinned clean checkout. Bundled scripts",
    "are exposed to the Skill runtime as read-only text and are never executed.",
    "",
    "### gzh-design-skill/LICENSE",
    "",
    beginMarker("gzh-design-skill", "LICENSE"),
    upstreamLicense,
    endMarker("gzh-design-skill", "LICENSE"),
    "",
    "## Bundled runtime dependencies",
    "",
    `Bundle dependency manifest: ${packages.map(({ name, version }) => `${name}@${version}`).join(", ")}`,
    ""
  ];
  for (const packageInfo of packages) {
    lines.push(
      `### ${packageInfo.name}@${packageInfo.version}`,
      "",
      `- Source: ${packageInfo.source}`,
      `- Declared license: ${packageInfo.license}`,
      ""
    );
    for (const file of packageInfo.licenseFiles) {
      lines.push(
        `#### ${file.filename}`,
        "",
        beginMarker(packageInfo.name, file.filename),
        file.text,
        endMarker(packageInfo.name, file.filename),
        ""
      );
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function packageRootForInput(input) {
  const normalized = input.split(sep).join("/");
  const segments = normalized.split("/");
  const nodeModules = segments.lastIndexOf("node_modules");
  if (nodeModules < 0 || !segments[nodeModules + 1]) return null;
  const scoped = segments[nodeModules + 1].startsWith("@");
  const packageSegments = segments.slice(nodeModules + 1, nodeModules + (scoped ? 3 : 2));
  if (packageSegments.length !== (scoped ? 2 : 1)) {
    throw new Error(`Cannot identify bundled package for ${input}`);
  }
  return {
    name: packageSegments.join("/"),
    path: resolve(...segments.slice(0, nodeModules + 1 + packageSegments.length))
  };
}

function sourceUrl(packageJson) {
  const repository = typeof packageJson.repository === "string"
    ? packageJson.repository
    : packageJson.repository?.url;
  const candidate = repository || packageJson.homepage;
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return `https://www.npmjs.com/package/${encodeURIComponent(packageJson.name)}`;
  }
  return candidate
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/u, "");
}

async function bundledUpstreamLicense() {
  const source = await readFile("src/generated/bundledSkill.ts", "utf8");
  const match = /archiveBase64:\s*"([A-Za-z0-9+/=]+)"/u.exec(source);
  if (!match) throw new Error("Bundled Skill archive is missing from generated source.");
  const archive = unzipSync(new Uint8Array(Buffer.from(match[1], "base64")));
  const license = archive.LICENSE;
  if (!license) throw new Error("Bundled Skill archive is missing LICENSE.");
  return normalizeText(new TextDecoder().decode(license));
}

function normalizeText(value) {
  return value
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trimEnd();
}

function beginMarker(name, filename) {
  return `----- BEGIN ${name}/${filename} -----`;
}

function endMarker(name, filename) {
  return `----- END ${name}/${filename} -----`;
}
