import { hasAsciiControl } from "../security/ControlCharacters";

export type ElementPropertyCommand =
  | { type: "alignment"; value: "left" | "center" | "right" | "justify" }
  | { type: "text-color" | "background-color"; value: string }
  | { type: "spacing"; value: number }
  | { type: "image-alt" | "image-caption" | "link-title"; value: string }
  | { type: "image-alignment"; value: "left" | "center" | "right" }
  | { type: "link-url"; value: string }
  | { type: "table-row" | "table-column"; value: "add" | "remove" }
  | { type: "role"; value: string };

const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([0-9.% ,+-]+\)|transparent)$/iu;

export function applyElementProperty(
  element: HTMLElement,
  command: Exclude<ElementPropertyCommand, { type: "role" }>
): void {
  switch (command.type) {
    case "alignment":
      element.style.textAlign = command.value;
      return;
    case "text-color":
      element.style.color = safeColor(command.value);
      return;
    case "background-color":
      element.style.backgroundColor = safeColor(command.value);
      return;
    case "spacing":
      if (!Number.isFinite(command.value) || command.value < 0 || command.value > 128) {
        throw new Error("Paragraph spacing must be between 0 and 128 pixels.");
      }
      element.style.marginBlockEnd = `${command.value}px`;
      return;
    case "image-alt": {
      const image = imageElement(element);
      image.alt = command.value.slice(0, 1_000);
      return;
    }
    case "image-caption": {
      const image = imageElement(element);
      const figure = image.closest("figure");
      if (!figure) throw new Error("Image captions require a figure element.");
      let caption = figure.querySelector(":scope > figcaption");
      if (!caption) {
        caption = figure.ownerDocument.createElement("figcaption");
        figure.append(caption);
      }
      caption.textContent = command.value.slice(0, 2_000);
      return;
    }
    case "image-alignment": {
      const image = imageElement(element);
      const target = image.closest("figure") ?? image;
      target.style.marginInlineStart = command.value === "left" ? "0" : "auto";
      target.style.marginInlineEnd = command.value === "right" ? "0" : "auto";
      return;
    }
    case "link-url": {
      const link = linkElement(element);
      link.setAttribute("href", safeLink(command.value));
      return;
    }
    case "link-title":
      linkElement(element).title = command.value.slice(0, 1_000);
      return;
    case "table-row":
      mutateTable(element, "row", command.value);
      return;
    case "table-column":
      mutateTable(element, "column", command.value);
      return;
  }
}

export function renderPropertyInspector(
  host: HTMLElement,
  selected: HTMLElement | null,
  availableRoles: readonly string[],
  onChange: (command: ElementPropertyCommand) => void | Promise<void>,
  text: LocalizedText = ENGLISH_LOCALIZED_TEXT
): void {
  const document = host.ownerDocument;
  const fragment = document.createDocumentFragment();
  const heading = document.createElement("h3");
  heading.textContent = text.t("workbench.properties.title");
  fragment.append(heading);

  const roleLabel = document.createElement("label");
  roleLabel.textContent = text.t("workbench.properties.componentRole");
  const role = document.createElement("select");
  role.dataset.control = "role";
  role.append(option(document, text.t("workbench.properties.paragraph"), ""));
  for (const value of availableRoles) role.append(option(document, value, value));
  role.value = selected?.dataset.galleyRole ?? "";
  role.disabled = availableRoles.length === 0;
  role.addEventListener("change", () => void onChange({ type: "role", value: role.value }));
  roleLabel.append(role);
  fragment.append(roleLabel);

  const alignment = document.createElement("select");
  alignment.dataset.control = "alignment";
  for (const [value, key] of [
    ["left", "workbench.properties.alignment.left"],
    ["center", "workbench.properties.alignment.center"],
    ["right", "workbench.properties.alignment.right"],
    ["justify", "workbench.properties.alignment.justify"]
  ] as const) {
    alignment.append(option(document, text.t(key), value));
  }
  alignment.disabled = selected === null;
  alignment.addEventListener("change", () =>
    void onChange({
      type: "alignment",
      value: alignment.value as "left" | "center" | "right" | "justify"
    })
  );
  fragment.append(alignment);

  const spacing = document.createElement("input");
  spacing.type = "number";
  spacing.min = "0";
  spacing.max = "128";
  spacing.step = "1";
  spacing.dataset.control = "spacing";
  spacing.title = text.t("workbench.properties.spacing");
  spacing.disabled = selected === null;
  spacing.addEventListener("change", () =>
    void onChange({ type: "spacing", value: Number(spacing.value) })
  );
  fragment.append(spacing);

  for (const [type, label] of [
    ["text-color", text.t("workbench.properties.textColor")],
    ["background-color", text.t("workbench.properties.backgroundColor")]
  ] as const) {
    const input = document.createElement("input");
    input.type = "color";
    input.title = label;
    input.dataset.control = type;
    input.disabled = selected === null;
    input.addEventListener("change", () => void onChange({ type, value: input.value }));
    fragment.append(input);
  }


  const image = selected ? descendant(selected, "img") : null;
  if (image) {
    const alt = textControl(
      document,
      "image-alt",
      image.getAttribute("alt") ?? "",
      text.t("workbench.properties.imageAlt")
    );
    alt.addEventListener("change", () =>
      void onChange({ type: "image-alt", value: alt.value })
    );
    fragment.append(alt);
    const figure = image.closest("figure");
    const caption = textControl(
      document,
      "image-caption",
      figure?.querySelector(":scope > figcaption")?.textContent ?? "",
      text.t("workbench.properties.imageCaption")
    );
    caption.disabled = figure === null;
    caption.addEventListener("change", () =>
      void onChange({ type: "image-caption", value: caption.value })
    );
    fragment.append(caption);
    const imageAlignment = document.createElement("select");
    imageAlignment.dataset.control = "image-alignment";
    for (const value of ["left", "center", "right"] as const) {
      imageAlignment.append(
        option(
          document,
          text.t(`workbench.properties.alignment.${value}`),
          value
        )
      );
    }
    imageAlignment.addEventListener("change", () =>
      void onChange({
        type: "image-alignment",
        value: imageAlignment.value as "left" | "center" | "right"
      })
    );
    fragment.append(imageAlignment);
  }

  const link = selected ? descendant(selected, "a") : null;
  if (link) {
    const url = textControl(
      document,
      "link-url",
      link.getAttribute("href") ?? "",
      text.t("workbench.properties.linkUrl")
    );
    url.addEventListener("change", () =>
      void onChange({ type: "link-url", value: url.value })
    );
    fragment.append(url);
    const title = textControl(
      document,
      "link-title",
      link.getAttribute("title") ?? "",
      text.t("workbench.properties.linkTitle")
    );
    title.addEventListener("change", () =>
      void onChange({ type: "link-title", value: title.value })
    );
    fragment.append(title);
  }

  const table = selected ? descendant(selected, "table") : null;
  if (table) {
    for (const [dimension, operation] of [
      ["row", "add"],
      ["row", "remove"],
      ["column", "add"],
      ["column", "remove"]
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.control = `table-${dimension}-${operation}`;
      button.textContent = text.t("workbench.properties.tableAction", {
        action: text.t(
          operation === "add" ? "common.action.add" : "common.action.remove"
        ),
        dimension: text.t(
          dimension === "row"
            ? "workbench.properties.row"
            : "workbench.properties.column"
        )
      });
      button.addEventListener("click", () =>
        void onChange({
          type: dimension === "row" ? "table-row" : "table-column",
          value: operation
        })
      );
      fragment.append(button);
    }
  }
  host.replaceChildren(fragment);
}

function option(document: Document, label: string, value: string): HTMLOptionElement {
  const result = document.createElement("option");
  result.textContent = label;
  result.value = value;
  return result;
}

function textControl(
  document: Document,
  control: string,
  value: string,
  label: string
): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.dataset.control = control;
  input.value = value;
  input.title = label;
  input.setAttribute("aria-label", label);
  return input;
}

function descendant(element: HTMLElement, localName: string): HTMLElement | null {
  return element.localName === localName
    ? element
    : element.querySelector(localName);
}

function safeColor(value: string): string {
  const normalized = value.trim();
  if (!COLOR.test(normalized)) throw new Error("Unsupported color value.");
  return normalized;
}

function safeLink(value: string): string {
  const normalized = value.trim();
  if (!normalized || hasAsciiControl(normalized)) {
    throw new Error("Link URL is invalid.");
  }
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(normalized)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto", "tel"].includes(scheme)) {
    throw new Error("Link URL uses an unsupported scheme.");
  }
  if (normalized.startsWith("//")) throw new Error("Protocol-relative links are unsupported.");
  return normalized;
}


function imageElement(element: HTMLElement): HTMLImageElement {
  const image = element.localName === "img"
    ? element as HTMLImageElement
    : element.querySelector("img");
  if (!image) throw new Error("The selected block does not contain an image.");
  return image;
}

function linkElement(element: HTMLElement): HTMLAnchorElement {
  const link = element.localName === "a"
    ? element as HTMLAnchorElement
    : element.querySelector("a");
  if (!link) throw new Error("The selected block does not contain a link.");
  return link;
}

function mutateTable(
  element: HTMLElement,
  dimension: "row" | "column",
  operation: "add" | "remove"
): void {
  const table = element.localName === "table"
    ? element as HTMLTableElement
    : element.closest("table") ?? element.querySelector("table");
  if (!table) throw new Error("The selected block does not contain a table.");
  if (dimension === "row") {
    if (operation === "remove") {
      if (table.rows.length <= 1) throw new Error("A table must retain one row.");
      table.deleteRow(table.rows.length - 1);
      return;
    }
    const columns = Math.max(1, table.rows[0]?.cells.length ?? 1);
    const row = table.insertRow();
    for (let index = 0; index < columns; index += 1) row.insertCell();
    return;
  }
  if (operation === "remove") {
    if ((table.rows[0]?.cells.length ?? 0) <= 1) {
      throw new Error("A table must retain one column.");
    }
    for (const row of [...table.rows]) row.deleteCell(row.cells.length - 1);
    return;
  }
  for (const row of [...table.rows]) row.insertCell();
}
import { ENGLISH_LOCALIZED_TEXT, type LocalizedText } from "../i18n/LocalizedText";
