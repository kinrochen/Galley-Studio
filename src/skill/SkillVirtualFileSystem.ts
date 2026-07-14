export function normalizeSkillPath(input: string): string {
  const value = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !value ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  ) {
    throw new Error(`Invalid skill path: ${input}`);
  }

  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid skill path: ${input}`);
  }

  return parts.join("/");
}

export class SkillVirtualFileSystem {
  readonly #files: ReadonlyMap<string, string>;

  constructor(files: ReadonlyMap<string, string>) {
    for (const path of files.keys()) {
      if (normalizeSkillPath(path) !== path) {
        throw new Error(`Skill registered path must be normalized: ${path}`);
      }
    }

    this.#files = new Map(files);
  }

  read(path: string): string {
    const normalizedPath = normalizeSkillPath(path);
    const content = this.#files.get(normalizedPath);
    if (content === undefined) {
      throw new Error(`Skill file is not registered: ${normalizedPath}`);
    }

    return content;
  }

  has(path: string): boolean {
    return this.#files.has(normalizeSkillPath(path));
  }
}
