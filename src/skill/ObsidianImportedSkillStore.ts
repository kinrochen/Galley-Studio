import type { DataAdapter } from "obsidian";

import type { AtomicSkillArchiveStore } from "./ImportedSkillRepository";

export class ObsidianImportedSkillStore implements AtomicSkillArchiveStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly root: string,
    private readonly randomUUID: () => string = () => crypto.randomUUID()
  ) {}

  async listVersions(): Promise<readonly string[]> {
    if (!(await this.adapter.exists(this.root))) return [];
    const listed = await this.adapter.list(this.root);
    return Object.freeze(
      listed.files
        .map((path) => path.slice(`${this.root}/`.length).replace(/\.zip$/u, ""))
        .filter((version) => /^import-[a-f0-9]{12}$/u.test(version))
        .sort()
    );
  }

  async read(version: string): Promise<Uint8Array | null> {
    validateVersion(version);
    const path = `${this.root}/${version}.zip`;
    if (!(await this.adapter.exists(path, true))) return null;
    return new Uint8Array(await this.adapter.readBinary(path));
  }

  async commit(
    version: string,
    archive: Uint8Array
  ): Promise<"committed" | "exists"> {
    validateVersion(version);
    await ensureDirectory(this.adapter, this.root);
    const finalPath = `${this.root}/${version}.zip`;
    if (await this.adapter.exists(finalPath, true)) return "exists";
    const staging = `${this.root}/.staging-${this.randomUUID()}.zip`;
    const buffer = archive.buffer.slice(
      archive.byteOffset,
      archive.byteOffset + archive.byteLength
    ) as ArrayBuffer;
    await this.adapter.writeBinary(staging, buffer);
    try {
      const observed = new Uint8Array(await this.adapter.readBinary(staging));
      if (!equalBytes(observed, archive)) {
        throw new Error("Imported Skill staging verification failed.");
      }
      if (await this.adapter.exists(finalPath, true)) return "exists";
      await this.adapter.rename(staging, finalPath);
      return "committed";
    } finally {
      if (await this.adapter.exists(staging)) await this.adapter.remove(staging);
    }
  }
}

async function ensureDirectory(adapter: DataAdapter, path: string): Promise<void> {
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    const current = parts.slice(0, index).join("/");
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

function validateVersion(version: string): void {
  if (!/^import-[a-f0-9]{12}$/u.test(version)) {
    throw new Error("Imported Skill version is invalid.");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
