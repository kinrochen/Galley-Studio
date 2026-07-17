import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";
import { parseHtmlFragment } from "../dom/HtmlFragment";
import { hasAsciiControl } from "../security/ControlCharacters";

export type VaultResourceUrl = (vaultPath: string) => string;

const ORIGINAL_ATTRIBUTE = {
  src: "data-galley-original-src",
  href: "data-galley-original-href"
} as const;

const SYSTEM_OR_RUNTIME_URL = /^(?:file:|app:|\/|~\/|[a-z]:[\\/])/iu;

/**
 * Rewrites vault-relative authoring URLs only for editor display. The paired
 * original marker is temporary editor state and must be restored before the
 * body is passed back to DocumentSession.
 */
export class EditorResourceResolver {
  constructor(private readonly resourceUrl: VaultResourceUrl) {}

  rewriteForDisplay(bodyHtml: string, documentPath = ""): string {
    const fragment = parseFragment(bodyHtml);
    for (const element of fragment.querySelectorAll<HTMLElement>(
      "[src], [href], [data-galley-original-src], [data-galley-original-href]"
    )) {
      for (const attribute of ["src", "href"] as const) {
        this.#rewriteAttribute(element, attribute, documentPath);
      }
    }
    return serializeFragment(fragment);
  }

  restoreForSave(displayHtml: string, documentPath = ""): string {
    const fragment = parseFragment(displayHtml);
    for (const element of fragment.querySelectorAll<HTMLElement>(
      "[src], [href], [data-galley-original-src], [data-galley-original-href]"
    )) {
      for (const attribute of ["src", "href"] as const) {
        this.#restoreAttribute(element, attribute, documentPath);
      }
    }
    return serializeFragment(fragment);
  }

  #rewriteAttribute(
    element: HTMLElement,
    attribute: "src" | "href",
    documentPath: string
  ): void {
    const marker = ORIGINAL_ATTRIBUTE[attribute];
    const existingOriginal = element.getAttribute(marker);
    const current = element.getAttribute(attribute);

    if (existingOriginal !== null) {
      const existingVaultPath = resolveVaultResourcePath(
        existingOriginal,
        documentPath
      );
      if (
        existingVaultPath !== null &&
        current === this.resourceUrl(existingVaultPath)
      ) {
        return;
      }
      element.removeAttribute(marker);
    }
    if (current === null) return;
    const vaultPath = resolveVaultResourcePath(current, documentPath);
    if (vaultPath === null) return;

    element.setAttribute(marker, current);
    element.setAttribute(attribute, this.resourceUrl(vaultPath));
  }

  #restoreAttribute(
    element: HTMLElement,
    attribute: "src" | "href",
    documentPath: string
  ): void {
    const marker = ORIGINAL_ATTRIBUTE[attribute];
    const original = element.getAttribute(marker);
    const current = element.getAttribute(attribute);

    if (original !== null) {
      const originalVaultPath = resolveVaultResourcePath(original, documentPath);
      const exactDisplay =
        originalVaultPath !== null &&
        current === this.resourceUrl(originalVaultPath);
      if (exactDisplay) {
        element.setAttribute(attribute, original);
      } else if (
        current === null ||
        !isAllowedAuthoringUrl(element, attribute, current, documentPath)
      ) {
        element.removeAttribute(attribute);
      }
      element.removeAttribute(marker);
      return;
    }

    if (current !== null && isSystemOrRuntimeUrl(current)) {
      element.removeAttribute(attribute);
    }
  }
}

export function resolveVaultResourcePath(
  value: string,
  documentPath: string
): string | null {
  if (
    value !== value.trim() ||
    !value ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.startsWith("//") ||
    hasAsciiControl(value) ||
    isSystemOrRuntimeUrl(value)
  ) {
    return null;
  }
  const base = documentFolderSegments(documentPath);
  if (base === null) return null;
  const resolved = [...base];
  for (const segment of value.split("/")) {
    if (segment === ".") continue;
    if (!segment) return null;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  const path = resolved.join("/");
  return isNormalizedVaultRelativePath(path) ? path : null;
}

function documentFolderSegments(documentPath: string): string[] | null {
  if (!documentPath) return [];
  if (!isNormalizedVaultRelativePath(documentPath)) return null;
  return documentPath.split("/").slice(0, -1);
}

function isSystemOrRuntimeUrl(value: string): boolean {
  return SYSTEM_OR_RUNTIME_URL.test(value.trim());
}

function isAllowedAuthoringUrl(
  element: HTMLElement,
  attribute: "src" | "href",
  value: string,
  documentPath: string
): boolean {
  if (
    value !== value.trim() ||
    !value ||
    value.includes("\\") ||
    hasAsciiControl(value) ||
    value.startsWith("//") ||
    isSystemOrRuntimeUrl(value)
  ) {
    return false;
  }
  if (resolveVaultResourcePath(value, documentPath) !== null) return true;
  if (
    attribute === "href" &&
    (value.startsWith("#") || isVaultReference(value, documentPath))
  ) {
    return true;
  }

  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
  if (scheme === "http" || scheme === "https") return true;
  if (attribute === "href") {
    return scheme === "mailto" || scheme === "tel" || scheme === "obsidian";
  }
  return (
    scheme === "data" &&
    element.localName === "img" &&
    /^data:image\/(?:avif|bmp|gif|jpeg|png|svg\+xml|vnd\.microsoft\.icon|webp|x-icon)(?:;[^,;=]+=[^,;]*)*(?:;base64)?,/iu.test(value)
  );
}

function isVaultReference(value: string, documentPath: string): boolean {
  const suffixStart = value.search(/[?#]/u);
  return (
    suffixStart > 0 &&
    resolveVaultResourcePath(value.slice(0, suffixStart), documentPath) !== null
  );
}

function parseFragment(html: string): DocumentFragment {
  return parseHtmlFragment(html);
}

function serializeFragment(fragment: DocumentFragment): string {
  const host = document.createElement("div");
  host.append(fragment.cloneNode(true));
  return host.innerHTML;
}
