const REGISTERED_THEME_HEADING = "已注册主题";
const THEME_FILE_PATTERN =
  /^references\/theme-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export interface ThemeDefinition {
  id: string;
  name: string;
  primaryColor: string;
  useCases: string;
  file: string;
  underlineCss: string;
}

export function parseThemeIndex(markdown: string): ThemeDefinition[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const headingIndex = lines.findIndex(
    (line) => headingText(line) === REGISTERED_THEME_HEADING
  );
  if (headingIndex < 0) {
    throw new Error("Theme index is missing the registered-theme heading");
  }

  let tableIndex = headingIndex + 1;
  while (tableIndex < lines.length && lines[tableIndex]?.trim() === "") {
    tableIndex += 1;
  }

  const header = parseTableRow(lines[tableIndex]);
  const separator = parseTableRow(lines[tableIndex + 1]);
  if (
    header === undefined ||
    header.length !== 5 ||
    separator === undefined ||
    separator.length !== 5 ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  ) {
    throw new Error(
      "Theme index is missing the five-column registered-theme table"
    );
  }

  const themes: ThemeDefinition[] = [];
  const seenIds = new Set<string>();
  for (let lineIndex = tableIndex + 2; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined || !line.trim().startsWith("|")) {
      break;
    }

    const cells = parseTableRow(line);
    if (cells === undefined || cells.length !== 5) {
      throw new Error("Every registered theme row must contain five cells");
    }
    const [name, primaryColor, useCases, file, underlineCss] = cells.map(
      cleanCell
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

function headingText(line: string): string | undefined {
  return /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line)?.[1]?.trim();
}

function parseTableRow(line: string | undefined): string[] | undefined {
  if (!line?.trim().startsWith("|")) {
    return undefined;
  }

  const trimmed = line.trim();
  const content = trimmed.endsWith("|")
    ? trimmed.slice(1, -1)
    : trimmed.slice(1);
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of content) {
    if (escaped) {
      cell += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      cell += character;
      continue;
    }
    if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  if (escaped) {
    cell += "\\";
  }
  cells.push(cell.trim());
  return cells;
}

function cleanCell(cell: string): string {
  return cell
    .replace(/`([^`]*)`/g, "$1")
    .replaceAll("\\|", "|")
    .trim();
}
