export function parseHtmlFragment(
  source: string,
  context?: Element
): DocumentFragment {
  const ownerDocument = context?.ownerDocument ?? document;
  const parsed = new DOMParser().parseFromString(
    context?.localName === "head"
      ? `<!doctype html><html><head>${source}</head><body></body></html>`
      : `<!doctype html><html><head></head><body>${source}</body></html>`,
    "text/html"
  );
  const parsedContainer = context?.localName === "head"
    ? parsed.head
    : parsed.body;
  if (
    context?.localName === "head" &&
    [...parsed.body.childNodes].some((node) =>
      node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim())
    )
  ) {
    throw new Error("Head fragment changed parsing context.");
  }
  const fragment = ownerDocument.createDocumentFragment();
  fragment.append(
    ...[...parsedContainer.childNodes].map((node) =>
      ownerDocument.importNode(node, true)
    )
  );
  return fragment;
}

export function replaceChildrenWithHtml(
  target: Element,
  source: string
): void {
  target.replaceChildren(parseHtmlFragment(source, target));
}

export function replaceChildrenWithClones(
  target: Element,
  source: ParentNode
): void {
  target.replaceChildren(
    ...[...source.childNodes].map((node) => node.cloneNode(true))
  );
}

export function serializeHtmlFragment(
  source: ParentNode,
  ownerDocument: Document = document
): string {
  const host = ownerDocument.createElement("div");
  host.append(
    ...[...source.childNodes].map((node) => node.cloneNode(true))
  );
  return host.innerHTML;
}
