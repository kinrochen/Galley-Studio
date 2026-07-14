export type MemoryVaultFile = string | Uint8Array;

export interface MemoryVaultStat {
  type: "file";
  ctime: number;
  mtime: number;
  size: number;
}

export interface MemoryVaultOwnedHandle {
  readonly path: string;
  readonly identity: object;
  readonly contents: MemoryVaultFile;
}

export class MemoryVault {
  readonly #files: Map<string, MemoryVaultFile>;
  readonly #identities = new Map<string, object>();
  readonly #folders = new Set<string>();
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
    for (const path of this.#files.keys()) {
      this.#identities.set(path, {});
    }
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
    this.#identities.set(normalized, {});
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
    const identity = this.#identities.get(normalizedFrom);
    if (this.#files.has(normalizedTo)) {
      throw new Error(`Vault file already exists: ${normalizedTo}`);
    }
    this.#files.set(normalizedTo, contents);
    if (identity) {
      this.#identities.set(normalizedTo, identity);
    }
    this.#files.delete(normalizedFrom);
    this.#identities.delete(normalizedFrom);
  }

  async remove(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    this.#files.delete(normalized);
    this.#identities.delete(normalized);
  }

  async createOwned(
    path: string,
    contents: MemoryVaultFile
  ): Promise<MemoryVaultOwnedHandle> {
    await this.create(path, contents);
    const normalized = normalizeVaultPath(path);
    const identity = this.#identities.get(normalized);
    if (!identity) {
      throw new Error(`Vault ownership identity is missing: ${normalized}`);
    }
    return {
      path: normalized,
      identity,
      contents: copyContents(contents)
    };
  }

  async commitOwned(
    handle: MemoryVaultOwnedHandle,
    finalPath: string
  ): Promise<
    | { status: "committed"; handle: MemoryVaultOwnedHandle }
    | { status: "collision" }
  > {
    if (!(await this.owns(handle))) {
      throw new Error("Owned temporary file was replaced before commit");
    }
    const normalized = normalizeVaultPath(finalPath);
    if (this.#files.has(normalized)) {
      return { status: "collision" };
    }
    const committed = await this.createOwned(normalized, handle.contents);
    return { status: "committed", handle: committed };
  }

  async owns(handle: MemoryVaultOwnedHandle): Promise<boolean> {
    return this.#identities.get(handle.path) === handle.identity;
  }

  async removeOwned(handle: MemoryVaultOwnedHandle): Promise<void> {
    if (await this.owns(handle)) {
      await this.remove(handle.path);
    }
  }

  async ensureFolder(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    const segments = normalized.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      this.#folders.add(segments.slice(0, index).join("/"));
    }
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

  paths(): string[] {
    const paths = [...this.#files.keys()].sort();
    Object.freeze(paths);
    return paths;
  }

  folders(): string[] {
    return [...this.#folders].sort();
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
