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
      if (exactDisplay) element.setAttribute(attribute, original);
      else element.removeAttribute(attribute);
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
