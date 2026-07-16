import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export interface RasterDimensions {
  width: number;
  height: number;
}

export interface SourceResourceVault {
  exists(vaultPath: string): boolean | Promise<boolean>;
  readRasterDimensions?(
    vaultPath: string,
    mediaType: string
  ):
    | RasterDimensions
    | undefined
    | Promise<RasterDimensions | undefined>;
}

export interface SourceResource {
  vaultPath: string;
  alt: string;
  mediaType: string;
  width?: number;
  height?: number;
}

interface PositionedNode {
  type: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: PositionedNode[];
  url?: string;
  alt?: string | null;
  identifier?: string;
}

interface ResourceCandidate {
  offset: number;
  target: string;
  alt: string;
  width?: number;
  height?: number;
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  webp: "image/webp"
};

export async function resolveSourceResources(
  markdown: string,
  sourcePath: string,
  vault: SourceResourceVault
): Promise<SourceResource[]> {
  const sourceDirectory = normalizeSourceDirectory(sourcePath);
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  }) as PositionedNode;
  const definitions = collectDefinitions(tree);
  const protectedRanges: Array<{ start: number; end: number }> = [];
  const candidates: ResourceCandidate[] = [];

  collectMarkdownImages(tree, definitions, protectedRanges, candidates);
  collectObsidianEmbeds(markdown, protectedRanges, candidates);
  candidates.sort((left, right) => left.offset - right.offset);

  const resources: SourceResource[] = [];
  for (const candidate of candidates) {
    const resolved = resolveVaultPath(candidate.target, sourceDirectory);
    if (!resolved || !(await vault.exists(resolved.vaultPath))) {
      continue;
    }

    let width = candidate.width;
    let height = candidate.height;
    if (
      resolved.mediaType !== "image/svg+xml" &&
      (width === undefined || height === undefined) &&
      vault.readRasterDimensions
    ) {
      const measured = await vault.readRasterDimensions(
        resolved.vaultPath,
        resolved.mediaType
      );
      if (
        measured &&
        validDimension(measured.width) &&
        validDimension(measured.height)
      ) {
        width ??= measured.width;
        height ??= measured.height;
      }
    }

    resources.push({
      vaultPath: resolved.vaultPath,
      alt: candidate.alt,
      mediaType: resolved.mediaType,
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height })
    });
  }

  return resources;
}

function collectDefinitions(root: PositionedNode): Map<string, string> {
  const definitions = new Map<string, string>();
  visit(root, (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      const identifier = normalizeIdentifier(node.identifier);
      if (!definitions.has(identifier)) {
        definitions.set(identifier, node.url);
      }
    }
  });
  return definitions;
}

function collectMarkdownImages(
  root: PositionedNode,
  definitions: ReadonlyMap<string, string>,
  protectedRanges: Array<{ start: number; end: number }>,
  candidates: ResourceCandidate[]
): void {
  visit(root, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (
      start !== undefined &&
      end !== undefined &&
      (node.type === "code" ||
        node.type === "inlineCode" ||
        node.type === "html")
    ) {
      protectedRanges.push({ start, end });
    }

    if (start === undefined) {
      return;
    }
    if (node.type === "image" && node.url) {
      candidates.push({ offset: start, target: node.url, alt: node.alt ?? "" });
      return;
    }
    if (node.type === "imageReference" && node.identifier) {
      const target = definitions.get(normalizeIdentifier(node.identifier));
      if (target) {
        candidates.push({ offset: start, target, alt: node.alt ?? "" });
      }
    }
  });
}

function collectObsidianEmbeds(
  markdown: string,
  protectedRanges: readonly { start: number; end: number }[],
  candidates: ResourceCandidate[]
): void {
  const embedPattern = /!\[\[([^\]\r\n]+)\]\]/g;
  for (const match of markdown.matchAll(embedPattern)) {
    const offset = match.index;
    const content = match[1];
    if (
      offset === undefined ||
      !content ||
      isEscapedAt(markdown, offset) ||
      protectedRanges.some(({ start, end }) => offset >= start && offset < end)
    ) {
      continue;
    }

    const [targetPart, ...displayParts] = content.split("|");
    const target = targetPart?.trim();
    if (!target) {
      continue;
    }

    let alt = displayParts.join("|").trim();
    let dimensions: Pick<ResourceCandidate, "width" | "height"> = {};
    const size = displayParts.at(-1)?.trim() ?? "";
    const sizeMatch = /^(\d+)(?:x(\d+))?$/.exec(size);
    if (sizeMatch) {
      const width = Number(sizeMatch[1]);
      const height = sizeMatch[2] ? Number(sizeMatch[2]) : undefined;
      dimensions = {
        ...(validDimension(width) ? { width } : {}),
        ...(height !== undefined && validDimension(height) ? { height } : {})
      };
      alt = displayParts.slice(0, -1).join("|").trim();
    }

    candidates.push({ offset, target, alt, ...dimensions });
  }
}

function isEscapedAt(markdown: string, offset: number): boolean {
  let backslashes = 0;
  for (
    let index = offset - 1;
    index >= 0 && markdown[index] === "\\";
    index -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function normalizeSourceDirectory(sourcePath: string): string[] {
  const segments = sourcePath.split("/");
  if (
    !sourcePath ||
    sourcePath !== sourcePath.trim() ||
    sourcePath.includes("\\") ||
    sourcePath.includes("?") ||
    sourcePath.includes("#") ||
    sourcePath.includes("\0") ||
    /%[0-9a-f]{2}/i.test(sourcePath) ||
    sourcePath.startsWith("/") ||
    sourcePath.startsWith("~/") ||
    (sourcePath.startsWith("<") && sourcePath.endsWith(">")) ||
    /^[a-z]:/i.test(sourcePath) ||
    /^[a-z][a-z0-9+.-]*:/i.test(sourcePath) ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".."
    )
  ) {
    throw new Error("Source path must be canonical vault-relative form");
  }
  segments.pop();
  return segments;
}

function resolveVaultPath(
  target: string,
  sourceDirectory: readonly string[]
): { vaultPath: string; mediaType: string } | undefined {
  const normalized = normalizeLocalReference(target);
  if (!normalized) {
    return undefined;
  }

  const segments = [...sourceDirectory];
  for (const segment of normalized.split("/")) {
    if (segment === "." || segment === "") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return undefined;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const vaultPath = segments.join("/");
  const extension = vaultPath.match(/\.([^./]+)$/)?.[1]?.toLowerCase();
  const mediaType = extension ? MEDIA_TYPES[extension] : undefined;
  return mediaType ? { vaultPath, mediaType } : undefined;
}

function normalizeLocalReference(input: string): string | undefined {
  let value = input.trim();
  if (value.startsWith("<") && value.endsWith(">")) {
    value = value.slice(1, -1).trim();
  }
  value = value.split(/[?#]/, 1)[0] ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  value = value.replaceAll("\\", "/");

  if (
    !value ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.startsWith("~/") ||
    /^[a-z]:/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    return undefined;
  }

  return value;
}

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().replace(/\s+/g, " ").toLowerCase();
}

function validDimension(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function visit(
  node: PositionedNode,
  callback: (node: PositionedNode) => void
): void {
  callback(node);
  for (const child of node.children ?? []) {
    visit(child, callback);
  }
}
