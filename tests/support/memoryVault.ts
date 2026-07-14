export type MemoryVaultFile = string | Uint8Array;

export interface MemoryVaultStat {
  type: "file";
  ctime: number;
  mtime: number;
  size: number;
}

export class MemoryVault {
  readonly #files: Map<string, MemoryVaultFile>;
  readonly #failRename: boolean;

  constructor(
    initialFiles: Readonly<Record<string, MemoryVaultFile>> = {},
    failRename = false
  ) {
    this.#files = new Map(
      Object.entries(initialFiles).map(([path, contents]) => [
        normalizeVaultPath(path),
        copyContents(contents)
      ])
    );
    this.#failRename = failRename;
  }

  async read(path: string): Promise<string> {
    const contents = this.requiredFile(path);
    if (typeof contents !== "string") {
      throw new Error(`Vault file is binary: ${path}`);
    }
    return contents;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const contents = this.requiredFile(path);
    return typeof contents === "string"
      ? new TextEncoder().encode(contents)
      : new Uint8Array(contents);
  }

  async create(path: string, contents: MemoryVaultFile): Promise<void> {
    const normalized = normalizeVaultPath(path);
    if (this.#files.has(normalized)) {
      throw new Error(`Vault file already exists: ${normalized}`);
    }
    this.#files.set(normalized, copyContents(contents));
  }

  async modify(path: string, contents: MemoryVaultFile): Promise<void> {
    const normalized = normalizeVaultPath(path);
    if (!this.#files.has(normalized)) {
      throw new Error(`Vault file does not exist: ${normalized}`);
    }
    this.#files.set(normalized, copyContents(contents));
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.#failRename) {
      throw new Error("Injected vault rename failure");
    }
    const normalizedFrom = normalizeVaultPath(from);
    const normalizedTo = normalizeVaultPath(to);
    const contents = this.requiredFile(normalizedFrom);
    if (this.#files.has(normalizedTo)) {
      throw new Error(`Vault file already exists: ${normalizedTo}`);
    }
    this.#files.set(normalizedTo, contents);
    this.#files.delete(normalizedFrom);
  }

  async remove(path: string): Promise<void> {
    this.#files.delete(normalizeVaultPath(path));
  }

  async stat(path: string): Promise<MemoryVaultStat | null> {
    const contents = this.#files.get(normalizeVaultPath(path));
    if (contents === undefined) {
      return null;
    }
    return {
      type: "file",
      ctime: 0,
      mtime: 0,
      size:
        typeof contents === "string"
          ? new TextEncoder().encode(contents).byteLength
          : contents.byteLength
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.#files.has(normalizeVaultPath(path));
  }

  snapshot(): Readonly<Record<string, MemoryVaultFile>> {
    return Object.fromEntries(
      [...this.#files].map(([path, contents]) => [path, copyContents(contents)])
    );
  }

  private requiredFile(path: string): MemoryVaultFile {
    const normalized = normalizeVaultPath(path);
    const contents = this.#files.get(normalized);
    if (contents === undefined) {
      throw new Error(`Vault file does not exist: ${normalized}`);
    }
    return contents;
  }
}

export function memoryVault(
  initialFiles: Readonly<Record<string, MemoryVaultFile>> = {}
): MemoryVault {
  return new MemoryVault(initialFiles);
}

export function failingRenameVault(): MemoryVault {
  return new MemoryVault({}, true);
}

function normalizeVaultPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized
      .split("/")
      .some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid vault path: ${path}`);
  }
  return normalized;
}

function copyContents(contents: MemoryVaultFile): MemoryVaultFile {
  return typeof contents === "string" ? contents : new Uint8Array(contents);
}
