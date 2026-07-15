import { ThemeComponentCatalog } from "./ThemeComponentCatalog";

export type ComponentTransformErrorCode =
  | "component_role_unavailable"
  | "component_selection_invalid"
  | "component_slot_ambiguous";

export class ComponentTransformError extends Error {
  constructor(readonly code: ComponentTransformErrorCode) {
    super(code);
    this.name = "ComponentTransformError";
  }
}

export function transformSelectedBlock(
  selected: string | Element,
  targetRole: string,
  catalog: ThemeComponentCatalog
): string {
  const selectedElement = selectionElement(selected);
  const target = catalog.template(targetRole);
  if (!target) throw new ComponentTransformError("component_role_unavailable");

  const slots = [
    ...(target.matches('[data-galley-slot="content"]') ? [target] : []),
    ...target.querySelectorAll<HTMLElement>('[data-galley-slot="content"]')
  ];
  if (slots.length > 1) {
    throw new ComponentTransformError("component_slot_ambiguous");
  }

  const contentSlot = slots[0] ?? target;
  contentSlot.innerHTML = selectedElement.innerHTML;
  target.removeAttribute("data-galley-source");
  const sourceId = selectedElement.getAttribute("data-galley-source");
  if (sourceId) target.setAttribute("data-galley-source", sourceId);
  target.setAttribute("data-galley-role", targetRole);
  return target.outerHTML;
}

function selectionElement(source: string | Element): HTMLElement {
  if (typeof source !== "string") {
    if (source.namespaceURI !== "http://www.w3.org/1999/xhtml") {
      throw new ComponentTransformError("component_selection_invalid");
    }
    return source.cloneNode(true) as HTMLElement;
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const elements = [...template.content.children];
  const hasOtherContent = [...template.content.childNodes].some(
    (node) => node.nodeType !== Node.ELEMENT_NODE && node.textContent?.trim()
  );
  if (
    elements.length !== 1 ||
    hasOtherContent ||
    elements[0]?.namespaceURI !== "http://www.w3.org/1999/xhtml"
  ) {
    throw new ComponentTransformError("component_selection_invalid");
  }
  return elements[0].cloneNode(true) as HTMLElement;
}
