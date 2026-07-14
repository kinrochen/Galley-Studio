import type {
  DataAdapter,
  FileStats,
  ListedFiles,
  Stat,
  TAbstractFile,
  TFile,
  TFolder,
  Vault
} from "obsidian";

type FakeNode = FakeFileNode | FakeFolderNode;

interface FakeFileNode {
  kind: "file";
  file: TFile;
  text: string;
}

interface FakeFolderNode {
  kind: "folder";
  folder: TFolder;
}

export interface PersistentObsidianHooks {
  afterRead?(path: string, backing: PersistentObsidianBacking): void;
  afterCreate?(path: string, backing: PersistentObsidianBacking): void;
  afterModify?(path: string, backing: PersistentObsidianBacking): void;
  afterDelete?(path: string, backing: PersistentObsidianBacking): void;
}

export class PersistentObsidianBacking {
  readonly nodes = new Map<string, FakeNode>();
  readonly createdPaths: string[] = [];
  clock = 1_000;

  constructor(initialFiles: Readonly<Record<string, string>> = {}) {
    this.nodes.set("", { kind: "folder", folder: makeFolder("") });
    for (const [path, text] of Object.entries(initialFiles)) {
      this.ensureFolders(parentOf(path));
      this.nodes.set(path, {
        kind: "file",
        file: makeFile(path, text, this.tick()),
        text
      });
    }
  }

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  ensureFolders(path: string): void {
    if (!path) return;
    let current = "";
    for (const segment of path.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.nodes.get(current);
      if (existing?.kind === "file") throw new Error("folder component is a file");
      if (!existing) {
        this.nodes.set(current, { kind: "folder", folder: makeFolder(current) });
      }
    }
  }

  read(path: string): string | null {
    const node = this.nodes.get(path);
    return node?.kind === "file" ? node.text : null;
  }

  paths(): string[] {
    return [...this.nodes]
      .filter(([, node]) => node.kind === "file")
      .map(([path]) => path)
      .sort();
  }

  replace(
    path: string,
    text: string,
    options: { sameIdentity?: boolean; preserveStat?: boolean } = {}
  ): void {
    const node = this.nodes.get(path);
    if (node?.kind !== "file") {
      this.ensureFolders(parentOf(path));
      this.nodes.set(path, {
        kind: "file",
        file: makeFile(path, text, this.tick()),
        text
      });
      return;
    }
    const stat = { ...node.file.stat };
    node.text = text;
    if (!options.sameIdentity) node.file = makeFile(path, text, this.tick());
    else node.file.stat = makeStat(text, this.tick());
    if (options.preserveStat) node.file.stat = stat;
  }

  remove(path: string): void {
    this.nodes.delete(path);
  }
}

export function persistentObsidianVault(
  backing = new PersistentObsidianBacking(),
  hooks: PersistentObsidianHooks = {}
): Vault {
  const adapter = {
    getName: () => "persistent-test-vault",
    async exists(path: string) {
      return backing.nodes.has(path);
    },
    async stat(path: string): Promise<Stat | null> {
      const node = backing.nodes.get(path);
      if (!node) return null;
      if (node.kind === "folder") {
        return { type: "folder", ctime: 0, mtime: 0, size: 0 };
      }
      return { type: "file", ...node.file.stat };
    },
    async list(path: string): Promise<ListedFiles> {
      const prefix = path ? `${path}/` : "";
      const files: string[] = [];
      const folders: string[] = [];
      for (const [candidate, node] of backing.nodes) {
        if (!candidate.startsWith(prefix) || candidate === path) continue;
        if (candidate.slice(prefix.length).includes("/")) continue;
        (node.kind === "file" ? files : folders).push(candidate);
      }
      return { files: files.sort(), folders: folders.sort() };
    }
  } as DataAdapter;

  const vault = {
    adapter,
    getAbstractFileByPath(path: string): TAbstractFile | null {
      const node = backing.nodes.get(path);
      return node?.kind === "file" ? node.file : node?.folder ?? null;
    },
    getFileByPath(path: string): TFile | null {
      const node = backing.nodes.get(path);
      return node?.kind === "file" ? node.file : null;
    },
    getFolderByPath(path: string): TFolder | null {
      const node = backing.nodes.get(path);
      return node?.kind === "folder" ? node.folder : null;
    },
    async create(path: string, text: string): Promise<TFile> {
      if (backing.nodes.has(path)) throw new Error("File already exists");
      backing.ensureFolders(parentOf(path));
      const file = makeFile(path, text, backing.tick());
      backing.nodes.set(path, { kind: "file", file, text });
      backing.createdPaths.push(path);
      hooks.afterCreate?.(path, backing);
      return file;
    },
    async createFolder(path: string): Promise<TFolder> {
      if (backing.nodes.has(path)) throw new Error("Folder already exists");
      const parent = backing.nodes.get(parentOf(path));
      if (!parent || parent.kind !== "folder") throw new Error("Missing parent");
      const folder = makeFolder(path);
      backing.nodes.set(path, { kind: "folder", folder });
      backing.createdPaths.push(path);
      return folder;
    },
    async read(file: TFile): Promise<string> {
      const node = backing.nodes.get(file.path);
      if (node?.kind !== "file" || node.file !== file) throw new Error("Stale file");
      const text = node.text;
      hooks.afterRead?.(file.path, backing);
      return text;
    },
    async modify(file: TFile, text: string): Promise<void> {
      const node = backing.nodes.get(file.path);
      if (node?.kind !== "file" || node.file !== file) throw new Error("Stale file");
      node.text = text;
      file.stat = makeStat(text, backing.tick());
      hooks.afterModify?.(file.path, backing);
    },
    async delete(file: TAbstractFile): Promise<void> {
      const node = backing.nodes.get(file.path);
      const identity = node?.kind === "file" ? node.file : node?.folder;
      if (!node || identity !== file) throw new Error("Stale file");
      if (
        node.kind === "folder" &&
        [...backing.nodes.keys()].some((path) => path.startsWith(`${file.path}/`))
      ) {
        throw new Error("Folder is not empty");
      }
      backing.nodes.delete(file.path);
      hooks.afterDelete?.(file.path, backing);
    }
  } as unknown as Vault;
  return vault;
}

function makeFile(path: string, text: string, time: number): TFile {
  return {
    path,
    name: baseName(path),
    basename: baseName(path).replace(/\.[^.]*$/, ""),
    extension: baseName(path).includes(".") ? baseName(path).split(".").at(-1)! : "",
    parent: null,
    vault: null as unknown as Vault,
    stat: makeStat(text, time)
  } as TFile;
}

function makeFolder(path: string): TFolder {
  return {
    path,
    name: baseName(path),
    parent: null,
    vault: null as unknown as Vault,
    children: [],
    isRoot: () => path === ""
  } as TFolder;
}

function makeStat(text: string, time: number): FileStats {
  return { ctime: time, mtime: time, size: new TextEncoder().encode(text).byteLength };
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
