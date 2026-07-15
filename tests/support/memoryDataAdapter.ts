import type { DataAdapter, ListedFiles, Stat } from "obsidian";

type StoredValue = string | Uint8Array;

export interface RenameFault {
  readonly call: number;
  readonly when: "before" | "after";
}

export class MemoryDataAdapter {
  readonly files = new Map<string, StoredValue>();
  readonly folders = new Set<string>([""]);
  renameCalls = 0;
  renameFault: RenameFault | null = null;

  asDataAdapter(): DataAdapter {
    return this as unknown as DataAdapter;
  }

  getName(): string { return "galley-memory-adapter"; }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async stat(path: string): Promise<Stat | null> {
    const value = this.files.get(path);
    if (value !== undefined) {
      return {
        type: "file",
        ctime: 0,
        mtime: 0,
        size: typeof value === "string"
          ? new TextEncoder().encode(value).byteLength
          : value.byteLength
      };
    }
    return this.folders.has(path)
      ? { type: "folder", ctime: 0, mtime: 0, size: 0 }
      : null;
  }

  async list(path: string): Promise<ListedFiles> {
    const prefix = path ? `${path}/` : "";
    const files = [...this.files.keys()].filter((candidate) =>
      candidate.startsWith(prefix) &&
      !candidate.slice(prefix.length).includes("/")
    );
    const folders = [...this.folders].filter((candidate) =>
      candidate !== path &&
      candidate.startsWith(prefix) &&
      !candidate.slice(prefix.length).includes("/")
    );
    return { files: files.sort(), folders: folders.sort() };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (typeof value !== "string") throw new Error(`Missing text file: ${path}`);
    return value;
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing binary file: ${path}`);
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  async write(path: string, value: string): Promise<void> {
    this.requireParent(path);
    this.files.set(path, value);
  }

  async writeBinary(path: string, value: ArrayBuffer): Promise<void> {
    this.requireParent(path);
    this.files.set(path, new Uint8Array(value.slice(0)));
  }

  async mkdir(path: string): Promise<void> {
    this.requireParent(path);
    if (this.files.has(path) || this.folders.has(path)) {
      throw new Error(`Path exists: ${path}`);
    }
    this.folders.add(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rmdir(path: string, recursive: boolean): Promise<void> {
    const descendants = [...this.files.keys(), ...this.folders].filter(
      (candidate) => candidate.startsWith(`${path}/`)
    );
    if (descendants.length > 0 && !recursive) throw new Error("Folder not empty");
    for (const candidate of descendants) {
      this.files.delete(candidate);
      this.folders.delete(candidate);
    }
    this.folders.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    this.renameCalls += 1;
    if (this.renameFault?.call === this.renameCalls && this.renameFault.when === "before") {
      throw new Error(`Injected rename fault before ${this.renameCalls}`);
    }
    if (this.files.has(to) || this.folders.has(to)) throw new Error(`Target exists: ${to}`);
    if (this.files.has(from)) {
      this.requireParent(to);
      this.files.set(to, this.files.get(from)!);
      this.files.delete(from);
    } else if (this.folders.has(from)) {
      this.requireParent(to);
      const folders = [...this.folders]
        .filter((path) => path === from || path.startsWith(`${from}/`))
        .sort((left, right) => left.length - right.length);
      const files = [...this.files]
        .filter(([path]) => path.startsWith(`${from}/`));
      for (const path of folders) {
        this.folders.delete(path);
        this.folders.add(`${to}${path.slice(from.length)}`);
      }
      for (const [path, value] of files) {
        this.files.delete(path);
        this.files.set(`${to}${path.slice(from.length)}`, value);
      }
    } else {
      throw new Error(`Rename source missing: ${from}`);
    }
    if (this.renameFault?.call === this.renameCalls && this.renameFault.when === "after") {
      throw new Error(`Injected rename fault after ${this.renameCalls}`);
    }
  }

  allPaths(): readonly string[] {
    return [...this.files.keys(), ...this.folders].sort();
  }

  private requireParent(path: string): void {
    const index = path.lastIndexOf("/");
    const parent = index < 0 ? "" : path.slice(0, index);
    if (!this.folders.has(parent)) throw new Error(`Missing parent: ${parent}`);
  }
}
