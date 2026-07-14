import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const REGISTERED_THEME_HEADING = "已注册主题";
const THEME_TABLE_HEADERS = [
  "主题",
  "主色",
  "适用场景",
  "组件库文件",
  "正文下划线 CSS"
] as const;
const THEME_FILE_PATTERN =
  /^references\/theme-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  alt?: string | null;
  children?: MdastNode[];
}

export interface ThemeDefinition {
  id: string;
  name: string;
  primaryColor: string;
  useCases: string;
  file: string;
  underlineCss: string;
}

export function parseThemeIndex(markdown: string): ThemeDefinition[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
  const children = tree.children as MdastNode[];
  const headingIndex = children.findIndex(
    (node) =>
      node.type === "heading" &&
      node.depth === 2 &&
      renderedText(node) === REGISTERED_THEME_HEADING
  );
  if (headingIndex < 0) {
    throw new Error("Theme index is missing the registered-theme heading");
  }

  let table: MdastNode | undefined;
  for (let index = headingIndex + 1; index < children.length; index += 1) {
    const node = children[index];
    if (node === undefined) {
      break;
    }
    if (node.type === "heading" && (node.depth ?? 6) <= 2) {
      break;
    }
    if (isThemeTable(node)) {
      table = node;
      break;
    }
  }
  const rows = table?.children;
  const header = rows?.[0]?.children;
  if (!rows || !header || header.length !== 5) {
    throw new Error(
      "Theme index is missing the five-column registered-theme table"
    );
  }

  const themes: ThemeDefinition[] = [];
  const seenIds = new Set<string>();
  for (const row of rows.slice(1)) {
    const cells = row.children;
    if (!cells || cells.length !== 5) {
      throw new Error("Every registered theme row must contain five cells");
    }
    const [name, primaryColor, useCases, file, underlineCss] = cells.map(
      (cell) => renderedText(cell).trim()
    );
    if (!name || !primaryColor || !useCases || !underlineCss) {
      throw new Error("Registered theme cells must not be empty");
    }
    if (!file) {
      throw new Error("Registered theme row is missing its component file");
    }

    const fileMatch = THEME_FILE_PATTERN.exec(file);
    const id = fileMatch?.[1];
    if (!id) {
      throw new Error(`Invalid registered theme component file: ${file}`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate theme id: ${id}`);
    }
    seenIds.add(id);

    themes.push({
      id,
      name,
      primaryColor,
      useCases,
      file,
      underlineCss
    });
  }

  if (themes.length === 0) {
    throw new Error("Theme index does not register any themes");
  }
  return themes;
}

function renderedText(node: MdastNode): string {
  if (node.type === "html") {
    return "";
  }
  if (typeof node.value === "string") {
    return node.value;
  }
  if (node.type === "image" || node.type === "imageReference") {
    return node.alt ?? "";
  }
  if (node.type === "break") {
    return "\n";
  }
  return node.children?.map(renderedText).join("") ?? "";
}

function isThemeTable(node: MdastNode): boolean {
  const header =
    node.type === "table" ? node.children?.[0]?.children : undefined;
  return (
    header?.length === THEME_TABLE_HEADERS.length &&
    header.every(
      (cell, index) => renderedText(cell).trim() === THEME_TABLE_HEADERS[index]
    )
  );
}
