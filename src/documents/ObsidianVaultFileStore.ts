import type { FileStats, TAbstractFile, TFile, TFolder, Vault } from "obsidian";

import { sha256Text } from "./GalleySidecar";

export interface VaultFileStatEvidence {
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

export interface VaultFileObservation {
  readonly path: string;
  readonly text: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly identity: TFile;
  readonly stat: VaultFileStatEvidence;
}

export type VaultOwnedFile = VaultFileObservation;

export interface VaultOwnedFolder {
  readonly path: string;
  readonly identity: TFolder;
}

export interface VaultDirectoryEntry {
  readonly path: string;
  readonly name: string;
  readonly kind: "file" | "folder";
  readonly identity: TAbstractFile;
}

export interface ObsidianVaultFileStoreOptions {
  maxReadAttempts?: number;
}

export type ObsidianVaultFilePort = Pick<
  Vault,
  | "adapter"
  | "getAbstractFileByPath"
  | "getFileByPath"
  | "getFolderByPath"
  | "create"
  | "createFolder"
  | "read"
  | "modify"
  | "delete"
>;

export class VaultPathError extends Error {
  readonly code = "vault_path_invalid";

  constructor() {
    super("Galley requires one canonical normalized vault-relative path.");
    this.name = "VaultPathError";
  }
}

export class VaultFolderConflictError extends Error {
  readonly code = "vault_folder_conflict";

  constructor() {
    super("A Galley folder path component is occupied by a file.");
    this.name = "VaultFolderConflictError";
  }
}

export class VaultFileReadUnstableError extends Error {
  readonly code = "vault_file_read_unstable";

  constructor() {
    super("Galley could not obtain one stable exact vault file observation.");
    this.name = "VaultFileReadUnstableError";
  }
}

export class VaultMutationAmbiguousError extends Error {
  readonly code = "vault_mutation_ambiguous";
  readonly aborted = true;

  constructor(readonly operation: "create-folder") {
    super("Galley observed cancellation after a possible vault mutation.");
    this.name = "VaultMutationAmbiguousError";
  }
}

export type VaultMutationAmbiguity = {
  readonly status: "ambiguous";
  readonly operation: "create" | "modify" | "remove" | "remove-folder";
  readonly outcome: "applied" | "not-applied" | "unknown";
  readonly aborted: boolean;
  readonly observation?: VaultFileObservation | null;
  readonly error?: unknown;
};

export type VaultCreateExclusiveResult =
  | { readonly status: "created"; readonly file: VaultOwnedFile }
  | { readonly status: "collision" }
  | VaultMutationAmbiguity;

export type VaultConditionalModifyResult =
  | { readonly status: "modified"; readonly file: VaultOwnedFile }
  | { readonly status: "conflict" }
  | VaultMutationAmbiguity;

export type VaultConditionalRemoveResult =
  | { readonly status: "removed" }
  | { readonly status: "conflict" }
  | VaultMutationAmbiguity;

export type VaultCreateFolderExclusiveResult =
  | { readonly status: "created"; readonly folder: VaultOwnedFolder }
  | { readonly status: "collision" }
  | VaultMutationAmbiguity;

const DEFAULT_READ_ATTEMPTS = 4;

export class ObsidianVaultFileStore {
  readonly #maxReadAttempts: number;

  constructor(
    private readonly vault: ObsidianVaultFilePort,
    options: ObsidianVaultFileStoreOptions = {}
  ) {
    const attempts = options.maxReadAttempts ?? DEFAULT_READ_ATTEMPTS;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 32) {
      throw new Error("Galley stable-read attempts must be between 1 and 32.");
    }
    this.#maxReadAttempts = attempts;
  }

  async readTextStable(
    path: string,
    signal?: AbortSignal
  ): Promise<VaultFileObservation | null> {
    const normalized = canonicalVaultPath(path);
    for (let attempt = 0; attempt < this.#maxReadAttempts; attempt += 1) {
      throwIfAborted(signal);
      const first = this.vault.getFileByPath(normalized);
      if (!first) {
        if (this.vault.getAbstractFileByPath(normalized)) {
          throw new VaultFolderConflictError();
        }
        await Promise.resolve();
        throwIfAborted(signal);
        if (!this.vault.getAbstractFileByPath(normalized)) return null;
        continue;
      }

      let firstText: string;
      try {
        firstText = await this.vault.read(first);
      } catch (error) {
        if (this.vault.getFileByPath(normalized) !== first) continue;
        throw error;
      }
      throwIfAborted(signal);
      if (this.vault.getFileByPath(normalized) !== first) continue;
      let secondText: string;
      try {
        secondText = await this.vault.read(first);
      } catch (error) {
        if (this.vault.getFileByPath(normalized) !== first) continue;
        throw error;
      }
      throwIfAborted(signal);
      if (
        this.vault.getFileByPath(normalized) !== first ||
        secondText !== firstText
      ) {
        continue;
      }
      const sha256 = await sha256Text(secondText);
      throwIfAborted(signal);
      if (this.vault.getFileByPath(normalized) !== first) continue;
      let finalText: string;
      try {
        finalText = await this.vault.read(first);
      } catch (error) {
        if (this.vault.getFileByPath(normalized) !== first) continue;
        throw error;
      }
      throwIfAborted(signal);
      if (
        this.vault.getFileByPath(normalized) !== first ||
        finalText !== secondText
      ) {
        continue;
      }
      return observation(normalized, finalText, sha256, first);
    }
    throw new VaultFileReadUnstableError();
  }

  async createExclusive(
    path: string,
    text: string,
    signal?: AbortSignal
  ): Promise<VaultCreateExclusiveResult> {
    const normalized = canonicalVaultPath(path);
    throwIfAborted(signal);
    if (this.vault.getAbstractFileByPath(normalized)) {
      return { status: "collision" };
    }
    let created: TFile;
    try {
      created = await this.vault.create(normalized, text);
    } catch (error) {
      const current = await this.#observeAfterPossibleMutation(normalized);
      if (current && current.text !== text) return { status: "collision" };
      if (current === null) throw error;
      if (current === undefined) {
        return ambiguity("create", null, signal, error, false);
      }
      return ambiguity("create", current, signal, error, current.text === text);
    }
    const current = await this.#observeAfterPossibleMutation(normalized);
    if (signal?.aborted) {
      return ambiguity(
        "create",
        current ?? null,
        signal,
        new DOMException("Aborted", "AbortError"),
        current?.identity === created && current.text === text
      );
    }
    if (current?.identity === created && current.text === text) {
      return { status: "created", file: current };
    }
    return ambiguity("create", current ?? null, signal, undefined, false);
  }

  async modifyOwned(
    owned: VaultOwnedFile,
    nextText: string,
    signal?: AbortSignal
  ): Promise<VaultConditionalModifyResult> {
    const path = canonicalVaultPath(owned.path);
    throwIfAborted(signal);
    const current = await this.readTextStable(path, signal);
    if (!sameOwnedFile(current, owned)) return { status: "conflict" };
    throwIfAborted(signal);
    try {
      await this.vault.modify(owned.identity, nextText);
    } catch (error) {
      const after = await this.#observeAfterPossibleMutation(path);
      return ambiguity(
        "modify",
        after ?? null,
        signal,
        error,
        after?.identity === owned.identity && after.text === nextText
      );
    }
    const after = await this.#observeAfterPossibleMutation(path);
    if (signal?.aborted) {
      return ambiguity(
        "modify",
        after ?? null,
        signal,
        new DOMException("Aborted", "AbortError"),
        after?.identity === owned.identity && after.text === nextText
      );
    }
    if (after?.identity === owned.identity && after.text === nextText) {
      return { status: "modified", file: after };
    }
    return ambiguity("modify", after ?? null, signal, undefined, false);
  }

  async removeOwned(
    owned: VaultOwnedFile,
    signal?: AbortSignal
  ): Promise<VaultConditionalRemoveResult> {
    const path = canonicalVaultPath(owned.path);
    throwIfAborted(signal);
    const current = await this.readTextStable(path, signal);
    if (!sameOwnedFile(current, owned)) return { status: "conflict" };
    throwIfAborted(signal);
    try {
      await this.vault.delete(owned.identity);
    } catch (error) {
      const after = await this.#observeAfterPossibleMutation(path);
      return ambiguity("remove", after ?? null, signal, error, after === null);
    }
    const after = await this.#observeAfterPossibleMutation(path);
    if (signal?.aborted) {
      return ambiguity(
        "remove",
        after ?? null,
        signal,
        new DOMException("Aborted", "AbortError"),
        after === null
      );
    }
    return after === null
      ? { status: "removed" }
      : ambiguity("remove", after ?? null, signal, undefined, false);
  }

  async ensureFolder(path: string, signal?: AbortSignal): Promise<void> {
    const normalized = canonicalVaultPath(path);
    let current = "";
    for (const segment of normalized.split("/")) {
      current = current ? `${current}/${segment}` : segment;
      throwIfAborted(signal);
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing) {
        if (!this.vault.getFolderByPath(current)) throw new VaultFolderConflictError();
        continue;
      }
      try {
        await this.vault.createFolder(current);
      } catch (error) {
        if (this.vault.getFolderByPath(current)) continue;
        if (this.vault.getAbstractFileByPath(current)) {
          throw new VaultFolderConflictError();
        }
        throw error;
      }
      if (signal?.aborted) {
        throw new VaultMutationAmbiguousError("create-folder");
      }
    }
  }

  async createFolderExclusive(
    path: string,
    signal?: AbortSignal
  ): Promise<VaultCreateFolderExclusiveResult> {
    const normalized = canonicalVaultPath(path);
    throwIfAborted(signal);
    if (this.vault.getAbstractFileByPath(normalized)) return { status: "collision" };
    try {
      const folder = await this.vault.createFolder(normalized);
      if (signal?.aborted) {
        return {
          status: "ambiguous",
          operation: "create",
          outcome: this.vault.getFolderByPath(normalized) === folder ? "applied" : "unknown",
          aborted: true,
          error: new DOMException("Aborted", "AbortError")
        };
      }
      if (this.vault.getFolderByPath(normalized) !== folder) {
        return {
          status: "ambiguous",
          operation: "create",
          outcome: "unknown",
          aborted: false
        };
      }
      return { status: "created", folder: { path: normalized, identity: folder } };
    } catch (error) {
      if (this.vault.getAbstractFileByPath(normalized)) {
        return {
          status: "ambiguous",
          operation: "create",
          outcome: "unknown",
          aborted: signal?.aborted === true,
          error
        };
      }
      throw error;
    }
  }

  async list(path: string, signal?: AbortSignal): Promise<VaultDirectoryEntry[]> {
    const normalized = canonicalVaultPath(path);
    throwIfAborted(signal);
    let component = "";
    for (const segment of normalized.split("/")) {
      component = component ? `${component}/${segment}` : segment;
      const existing = this.vault.getAbstractFileByPath(component);
      if (existing && !this.vault.getFolderByPath(component)) {
        throw new VaultFolderConflictError();
      }
    }
    if (!this.vault.getFolderByPath(normalized)) {
      if (this.vault.getAbstractFileByPath(normalized)) throw new VaultFolderConflictError();
      return [];
    }
    const listed = await this.vault.adapter.list(normalized);
    throwIfAborted(signal);
    const entries: VaultDirectoryEntry[] = [];
    for (const candidate of [...listed.files, ...listed.folders].sort(compareText)) {
      const identity = this.vault.getAbstractFileByPath(candidate);
      if (!identity) continue;
      entries.push({
        path: candidate,
        name: candidate.slice(candidate.lastIndexOf("/") + 1),
        kind: this.vault.getFileByPath(candidate) ? "file" : "folder",
        identity
      });
    }
    return entries;
  }

  async removeEmptyFolderOwned(
    owned: VaultOwnedFolder,
    signal?: AbortSignal
  ): Promise<VaultConditionalRemoveResult> {
    const path = canonicalVaultPath(owned.path);
    throwIfAborted(signal);
    if (this.vault.getFolderByPath(path) !== owned.identity) return { status: "conflict" };
    if ((await this.list(path, signal)).length > 0) return { status: "conflict" };
    throwIfAborted(signal);
    try {
      await this.vault.delete(owned.identity);
    } catch (error) {
      return {
        status: "ambiguous",
        operation: "remove-folder",
        outcome: this.vault.getAbstractFileByPath(path) ? "unknown" : "applied",
        aborted: signal?.aborted === true,
        error
      };
    }
    if (signal?.aborted) {
      return {
        status: "ambiguous",
        operation: "remove-folder",
        outcome: this.vault.getAbstractFileByPath(path) ? "unknown" : "applied",
        aborted: true,
        error: new DOMException("Aborted", "AbortError")
      };
    }
    return this.vault.getAbstractFileByPath(path)
      ? {
          status: "ambiguous",
          operation: "remove-folder",
          outcome: "unknown",
          aborted: false
        }
      : { status: "removed" };
  }

  async #observeAfterPossibleMutation(
    path: string
  ): Promise<VaultFileObservation | null | undefined> {
    try {
      return await this.readTextStable(path);
    } catch {
      return undefined;
    }
  }
}

function observation(
  path: string,
  text: string,
  sha256: string,
  identity: TFile
): VaultFileObservation {
  return {
    path,
    text,
    sha256,
    byteLength: new TextEncoder().encode(text).byteLength,
    identity,
    stat: copyStat(identity.stat)
  };
}

function copyStat(stat: FileStats): VaultFileStatEvidence {
  return { ctime: stat.ctime, mtime: stat.mtime, size: stat.size };
}

function sameOwnedFile(
  current: VaultFileObservation | null,
  expected: VaultOwnedFile
): boolean {
  return (
    current !== null &&
    current.path === expected.path &&
    current.identity === expected.identity &&
    current.sha256 === expected.sha256 &&
    current.byteLength === expected.byteLength &&
    current.text === expected.text
  );
}

function ambiguity(
  operation: VaultMutationAmbiguity["operation"],
  observationValue: VaultFileObservation | null,
  signal: AbortSignal | undefined,
  error: unknown,
  applied: boolean
): VaultMutationAmbiguity {
  return {
    status: "ambiguous",
    operation,
    outcome: applied ? "applied" : "unknown",
    aborted: signal?.aborted === true,
    observation: observationValue,
    ...(error === undefined ? {} : { error })
  };
}

export function canonicalVaultPath(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.normalize("NFC") !== path ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    /^[a-z]:/iu.test(path) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(path) ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new VaultPathError();
  }
  return path;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
