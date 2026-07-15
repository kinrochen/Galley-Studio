import type { DataAdapter } from "obsidian";

import type {
  AtomicThemeStore,
  StoredThemeFiles,
  StoredThemeRecord
} from "./CustomThemeRepository";
import { parseThemeManifest } from "./ThemeManifest";

const ROOT = ".galley/themes";
const queues = new WeakMap<object, Promise<void>>();

interface Pointer {
  readonly generation: number;
  readonly revision: string;
}

interface Journal extends Pointer {
  readonly schemaVersion: 1;
  readonly expectedRevision: string | null;
  readonly stagingPath: string;
  readonly versionPath: string;
  readonly pointerStage: string;
  readonly pointerPath: string;
}

interface CurrentRecord extends StoredThemeRecord {
  readonly generation: number;
}

export class ObsidianCustomThemeStore implements AtomicThemeStore {
  constructor(
    private readonly adapter: DataAdapter,
    private readonly randomUUID: () => string = () => crypto.randomUUID()
  ) {}

  async listIds(): Promise<readonly string[]> {
    return exclusive(this.adapter, async () => {
      if (!(await this.adapter.exists(ROOT))) return [];
      await this.#recoverLegacyRoot();
      const listed = await this.adapter.list(ROOT);
      const ids = listed.folders
        .map((path) => path.slice(`${ROOT}/`.length))
        .filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
        .sort();
      const available: string[] = [];
      for (const id of ids) {
        await this.#recover(id);
        if (await this.#readCurrent(id)) available.push(id);
      }
      return Object.freeze(available);
    });
  }

  async read(id: string): Promise<StoredThemeRecord | null> {
    validateId(id);
    return exclusive(this.adapter, async () => {
      await this.#recoverLegacyRoot(id);
      await this.#recover(id);
      const current = await this.#readCurrent(id);
      return current
        ? Object.freeze({ files: current.files, revision: current.revision })
        : null;
    });
  }

  async commit(
    id: string,
    files: StoredThemeFiles,
    expectedRevision: string | null
  ): Promise<"committed" | "collision"> {
    validateId(id);
    return exclusive(this.adapter, async () => {
      await this.#recoverLegacyRoot(id);
      await this.#recover(id);
      const current = await this.#readCurrent(id);
      if ((current?.revision ?? null) !== expectedRevision) return "collision";

      const revision = await revisionFor(files);
      const generation = (current?.generation ?? 0) + 1;
      const token = this.randomUUID().replaceAll("-", "");
      const root = themeRoot(id);
      const stagingPath = `${root}/.staging-${token}`;
      const versionPath = `${root}/versions/${revision}`;
      const pointerStage = `${root}/.pointer-${token}.json`;
      const pointerPath = `${root}/pointers/${pointerName(generation, revision)}`;
      const journalPath = `${root}/.journal-${token}.json`;
      const journal: Journal = {
        schemaVersion: 1,
        expectedRevision,
        revision,
        generation,
        stagingPath,
        versionPath,
        pointerStage,
        pointerPath
      };

      await ensureDirectory(this.adapter, `${root}/versions`);
      await ensureDirectory(this.adapter, `${root}/pointers`);
      await this.adapter.write(journalPath, `${JSON.stringify(journal)}\n`);
      try {
        await this.adapter.mkdir(stagingPath);
        await writeThemeFiles(this.adapter, stagingPath, files);
        const verified = await readThemeFiles(this.adapter, stagingPath);
        if ((await revisionFor(verified)) !== revision) {
          throw new Error("Custom theme staging verification failed.");
        }
      } catch (error) {
        await removeDirectoryIfPresent(this.adapter, stagingPath);
        await removeFileIfPresent(this.adapter, journalPath);
        throw error;
      }

      if (!(await this.adapter.exists(versionPath, true))) {
        await this.adapter.rename(stagingPath, versionPath);
      } else {
        await removeDirectoryIfPresent(this.adapter, stagingPath);
      }
      await this.adapter.write(
        pointerStage,
        `${JSON.stringify({ generation, revision } satisfies Pointer)}\n`
      );
      await this.adapter.rename(pointerStage, pointerPath);
      await removeFileIfPresent(this.adapter, journalPath);
      await removeFileIfPresent(this.adapter, pointerStage);
      await removeDirectoryIfPresent(this.adapter, stagingPath);
      await this.#removeLegacyFiles(id);
      return "committed";
    });
  }

  async remove(id: string): Promise<boolean> {
    validateId(id);
    return exclusive(this.adapter, async () => {
      await this.#recoverLegacyRoot(id);
      const path = themeRoot(id);
      if (!(await this.adapter.exists(path, true))) return false;
      await this.adapter.rmdir(path, true);
      return true;
    });
  }

  async #recover(id: string): Promise<void> {
    const root = themeRoot(id);
    if (!(await this.adapter.exists(root))) return;
    const listed = await this.adapter.list(root);
    const journals = listed.files
      .filter((path) => /\/\.journal-[^/]+\.json$/u.test(path))
      .sort();
    for (const journalPath of journals) {
      let journal: Journal;
      try {
        journal = parseJournal(JSON.parse(await this.adapter.read(journalPath)));
      } catch {
        await removeFileIfPresent(this.adapter, journalPath);
        continue;
      }
      const current = await this.#readCurrent(id);
      if (current?.revision === journal.revision) {
        await cleanupTransaction(this.adapter, journalPath, journal);
        continue;
      }
      if ((current?.revision ?? null) !== journal.expectedRevision) {
        await cleanupTransaction(this.adapter, journalPath, journal);
        continue;
      }
      if (!(await this.adapter.exists(journal.versionPath, true))) {
        await cleanupTransaction(this.adapter, journalPath, journal);
        continue;
      }
      if (!(await this.adapter.exists(journal.pointerPath, true))) {
        await this.adapter.write(
          journal.pointerStage,
          `${JSON.stringify({
            generation: journal.generation,
            revision: journal.revision
          } satisfies Pointer)}\n`
        );
        await this.adapter.rename(journal.pointerStage, journal.pointerPath);
      }
      await cleanupTransaction(this.adapter, journalPath, journal);
      await this.#removeLegacyFiles(id);
    }
    const remaining = await this.adapter.list(root);
    for (const stagingPath of remaining.folders.filter((path) => /\/\.staging-[^/]+$/u.test(path))) {
      await removeDirectoryIfPresent(this.adapter, stagingPath);
    }
    for (const pointerStage of remaining.files.filter((path) => /\/\.pointer-[^/]+\.json$/u.test(path))) {
      await removeFileIfPresent(this.adapter, pointerStage);
    }
  }

  async #readCurrent(id: string): Promise<CurrentRecord | null> {
    const root = themeRoot(id);
    const pointersRoot = `${root}/pointers`;
    if (await this.adapter.exists(pointersRoot)) {
      const listed = await this.adapter.list(pointersRoot);
      for (const path of [...listed.files].sort().reverse()) {
        try {
          const pointer = parsePointer(JSON.parse(await this.adapter.read(path)));
          const files = await readThemeFiles(
            this.adapter,
            `${root}/versions/${pointer.revision}`
          );
          if ((await revisionFor(files)) !== pointer.revision) continue;
          return { files, revision: pointer.revision, generation: pointer.generation };
        } catch {
          // A torn or corrupt pointer is ignored in favor of the prior commit.
        }
      }
    }

    const legacyManifest = `${root}/theme.json`;
    if (await this.adapter.exists(legacyManifest, true)) {
      const files = await readThemeFiles(this.adapter, root);
      return { files, revision: await revisionFor(files), generation: 0 };
    }
    return null;
  }

  async #recoverLegacyRoot(onlyId?: string): Promise<void> {
    if (!(await this.adapter.exists(ROOT))) return;
    const listed = await this.adapter.list(ROOT);
    const backups = listed.folders.filter((path) =>
      /\/\.backup-[a-z0-9]+(?:-[a-z0-9]+)*-[^/]+$/u.test(path)
    );
    for (const backup of backups) {
      const match = /\/\.backup-([a-z0-9]+(?:-[a-z0-9]+)*)-[^/]+$/u.exec(backup);
      const id = match?.[1];
      if (!id || (onlyId && onlyId !== id)) continue;
      const finalPath = themeRoot(id);
      if (await this.adapter.exists(finalPath, true)) {
        await this.adapter.rmdir(backup, true);
      } else {
        await this.adapter.rename(backup, finalPath);
      }
    }
    for (const staging of listed.folders.filter((path) => /\/\.staging-/u.test(path))) {
      if (!onlyId || staging.includes(`-${onlyId}-`)) {
        await this.adapter.rmdir(staging, true);
      }
    }
  }

  async #removeLegacyFiles(id: string): Promise<void> {
    const root = themeRoot(id);
    for (const name of ["theme.json", "component-library.md", "preview.html"]) {
      await removeFileIfPresent(this.adapter, `${root}/${name}`);
    }
  }
}

async function exclusive<T>(adapter: object, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(adapter) ?? Promise.resolve();
  let release = (): void => undefined;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  const next = previous.then(() => lock);
  queues.set(adapter, next);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (queues.get(adapter) === next) queues.delete(adapter);
  }
}

function themeRoot(id: string): string {
  return `${ROOT}/${id}`;
}

function pointerName(generation: number, revision: string): string {
  return `commit-${String(generation).padStart(12, "0")}-${revision}.json`;
}

async function writeThemeFiles(
  adapter: DataAdapter,
  root: string,
  files: StoredThemeFiles
): Promise<void> {
  await adapter.write(`${root}/theme.json`, `${JSON.stringify(files.manifest, null, 2)}\n`);
  await adapter.write(`${root}/component-library.md`, files.componentLibrary);
  await adapter.write(`${root}/preview.html`, files.previewHtml);
}

async function readThemeFiles(
  adapter: DataAdapter,
  root: string
): Promise<StoredThemeFiles> {
  return {
    manifest: parseThemeManifest(
      JSON.parse(await adapter.read(`${root}/theme.json`)) as unknown
    ),
    componentLibrary: await adapter.read(`${root}/component-library.md`),
    previewHtml: await adapter.read(`${root}/preview.html`)
  };
}

async function revisionFor(files: StoredThemeFiles): Promise<string> {
  const bytes = new TextEncoder().encode([
    JSON.stringify(parseThemeManifest(files.manifest)),
    files.componentLibrary,
    files.previewHtml
  ].map((value) => `${value.length}:${value}`).join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parsePointer(value: unknown): Pointer {
  if (
    typeof value !== "object" ||
    value === null ||
    !Number.isSafeInteger((value as Pointer).generation) ||
    (value as Pointer).generation < 1 ||
    !/^[a-f0-9]{64}$/u.test((value as Pointer).revision)
  ) throw new Error("Invalid custom theme pointer.");
  return value as Pointer;
}

function parseJournal(value: unknown): Journal {
  const pointer = parsePointer(value);
  const journal = value as Journal;
  if (
    journal.schemaVersion !== 1 ||
    (journal.expectedRevision !== null &&
      !/^[a-f0-9]{64}$/u.test(journal.expectedRevision)) ||
    ![journal.stagingPath, journal.versionPath, journal.pointerStage, journal.pointerPath]
      .every((path) => typeof path === "string" && path.startsWith(`${ROOT}/`))
  ) throw new Error("Invalid custom theme journal.");
  return { ...journal, ...pointer };
}

async function cleanupTransaction(
  adapter: DataAdapter,
  journalPath: string,
  journal: Journal
): Promise<void> {
  await removeDirectoryIfPresent(adapter, journal.stagingPath);
  await removeFileIfPresent(adapter, journal.pointerStage);
  await removeFileIfPresent(adapter, journalPath);
}

async function removeFileIfPresent(adapter: DataAdapter, path: string): Promise<void> {
  if (await adapter.exists(path, true)) await adapter.remove(path);
}

async function removeDirectoryIfPresent(adapter: DataAdapter, path: string): Promise<void> {
  if (await adapter.exists(path, true)) await adapter.rmdir(path, true);
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
