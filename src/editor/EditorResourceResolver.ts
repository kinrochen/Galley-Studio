import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";

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

  rewriteForDisplay(bodyHtml: string): string {
    const fragment = parseFragment(bodyHtml);
    for (const element of fragment.querySelectorAll<HTMLElement>(
      "[src], [href], [data-galley-original-src], [data-galley-original-href]"
    )) {
      for (const attribute of ["src", "href"] as const) {
        this.#rewriteAttribute(element, attribute);
      }
    }
    return serializeFragment(fragment);
  }

  restoreForSave(displayHtml: string): string {
    const fragment = parseFragment(displayHtml);
    for (const element of fragment.querySelectorAll<HTMLElement>(
      "[src], [href], [data-galley-original-src], [data-galley-original-href]"
    )) {
      for (const attribute of ["src", "href"] as const) {
        this.#restoreAttribute(element, attribute);
      }
    }
    return serializeFragment(fragment);
  }

  #rewriteAttribute(element: HTMLElement, attribute: "src" | "href"): void {
    const marker = ORIGINAL_ATTRIBUTE[attribute];
    const existingOriginal = element.getAttribute(marker);
    const current = element.getAttribute(attribute);

    if (existingOriginal !== null) {
      if (
        isCanonicalVaultResource(existingOriginal) &&
        current === this.resourceUrl(existingOriginal)
      ) {
        return;
      }
      element.removeAttribute(marker);
    }
    if (current === null || !isCanonicalVaultResource(current)) return;

    element.setAttribute(marker, current);
    element.setAttribute(attribute, this.resourceUrl(current));
  }

  #restoreAttribute(element: HTMLElement, attribute: "src" | "href"): void {
    const marker = ORIGINAL_ATTRIBUTE[attribute];
    const original = element.getAttribute(marker);
    const current = element.getAttribute(attribute);

    if (original !== null) {
      const exactDisplay =
        isCanonicalVaultResource(original) &&
        current === this.resourceUrl(original);
      if (exactDisplay) {
        element.setAttribute(attribute, original);
      } else if (
        current === null ||
        !isAllowedAuthoringUrl(element, attribute, current)
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

function isCanonicalVaultResource(value: string): boolean {
  return (
    value === value.trim() &&
    !value.includes("?") &&
    !value.includes("#") &&
    isNormalizedVaultRelativePath(value)
  );
}

function isSystemOrRuntimeUrl(value: string): boolean {
  return SYSTEM_OR_RUNTIME_URL.test(value.trim());
}

function isAllowedAuthoringUrl(
  element: HTMLElement,
  attribute: "src" | "href",
  value: string
): boolean {
  if (
    value !== value.trim() ||
    !value ||
    /[\\\u0000-\u001f\u007f-\u009f]/u.test(value) ||
    value.startsWith("//") ||
    isSystemOrRuntimeUrl(value)
  ) {
    return false;
  }
  if (isCanonicalVaultResource(value)) return true;
  if (
    attribute === "href" &&
    (value.startsWith("#") || isCanonicalVaultReference(value))
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

function isCanonicalVaultReference(value: string): boolean {
  const suffixStart = value.search(/[?#]/u);
  return suffixStart > 0 && isCanonicalVaultResource(value.slice(0, suffixStart));
}

function parseFragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function serializeFragment(fragment: DocumentFragment): string {
  const host = document.createElement("div");
  host.append(fragment.cloneNode(true));
  return host.innerHTML;
}
