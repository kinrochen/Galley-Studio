import type { DataAdapter } from "obsidian";

import type {
  AtomicThemeStore,
  StoredThemeFiles
} from "./CustomThemeRepository";
import { parseThemeManifest } from "./ThemeManifest";

const ROOT = ".galley/themes";

export class ObsidianCustomThemeStore implements AtomicThemeStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly randomUUID: () => string = () => crypto.randomUUID()
  ) {}

  async listIds(): Promise<readonly string[]> {
    if (!(await this.adapter.exists(ROOT))) return [];
    const listed = await this.adapter.list(ROOT);
    const ids = listed.folders
      .map((path) => path.slice(`${ROOT}/`.length))
      .filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
      .sort();
    return Object.freeze(ids);
  }

  async read(id: string): Promise<StoredThemeFiles | null> {
    validateId(id);
    const root = `${ROOT}/${id}`;
    if (!(await this.adapter.exists(root))) return null;
    try {
      return {
        manifest: parseThemeManifest(
          JSON.parse(await this.adapter.read(`${root}/theme.json`)) as unknown
        ),
        componentLibrary: await this.adapter.read(`${root}/component-library.md`),
        previewHtml: await this.adapter.read(`${root}/preview.html`)
      };
    } catch {
      throw new Error(`Stored custom theme is incomplete or invalid: ${id}`);
    }
  }

  async commit(
    id: string,
    files: StoredThemeFiles,
    expected: "absent" | "present"
  ): Promise<"committed" | "collision"> {
    validateId(id);
    const finalPath = `${ROOT}/${id}`;
    const exists = await this.adapter.exists(finalPath, true);
    if ((expected === "absent" && exists) || (expected === "present" && !exists)) {
      return "collision";
    }
    await ensureDirectory(this.adapter, ROOT);
    const token = this.randomUUID().replaceAll("-", "");
    const staging = `${ROOT}/.staging-${id}-${token}`;
    const backup = `${ROOT}/.backup-${id}-${token}`;
    const serialized = {
      "theme.json": `${JSON.stringify(files.manifest, null, 2)}\n`,
      "component-library.md": files.componentLibrary,
      "preview.html": files.previewHtml
    };
    await this.adapter.mkdir(staging);
    try {
      for (const [name, value] of Object.entries(serialized)) {
        await this.adapter.write(`${staging}/${name}`, value);
      }
      for (const [name, value] of Object.entries(serialized)) {
        if ((await this.adapter.read(`${staging}/${name}`)) !== value) {
          throw new Error("Custom theme staging verification failed.");
        }
      }

      if (expected === "absent") {
        if (await this.adapter.exists(finalPath, true)) return "collision";
        await this.adapter.rename(staging, finalPath);
        return "committed";
      }

      await this.adapter.rename(finalPath, backup);
      try {
        await this.adapter.rename(staging, finalPath);
      } catch (error) {
        if (!(await this.adapter.exists(finalPath)) && (await this.adapter.exists(backup))) {
          await this.adapter.rename(backup, finalPath);
        }
        throw error;
      }
      await this.adapter.rmdir(backup, true);
      return "committed";
    } finally {
      if (await this.adapter.exists(staging)) await this.adapter.rmdir(staging, true);
    }
  }

  async remove(id: string): Promise<boolean> {
    validateId(id);
    const path = `${ROOT}/${id}`;
    if (!(await this.adapter.exists(path, true))) return false;
    await this.adapter.rmdir(path, true);
    return true;
  }
}

async function ensureDirectory(adapter: DataAdapter, path: string): Promise<void> {
  const parts = path.split("/");
  for (let index = 1; index <= parts.length; index += 1) {
    const current = parts.slice(0, index).join("/");
    if (!(await adapter.exists(current))) await adapter.mkdir(current);
  }
}

function validateId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id)) {
    throw new Error("Custom theme id is not canonical.");
  }
}
