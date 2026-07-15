import type { EventRef, TAbstractFile, TFile, Vault } from "obsidian";
import type { ArtifactVault } from "../documents/ArtifactRepository";
import { isNormalizedVaultRelativePath } from "../documents/GalleySidecar";

interface ObsidianOwnedArtifact {
  readonly path: string;
  readonly file: TFile;
  readonly contents: string;
}

const FINAL_IDENTITY_TIMEOUT_MS = 1_000;

export class ObsidianArtifactVault
  implements ArtifactVault<ObsidianOwnedArtifact>
{
  constructor(private readonly vault: Vault) {}

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(path) !== null;
  }

  async ensureFolder(path: string): Promise<void> {
    const parts = path.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
      const folder = parts.slice(0, index).join("/");
      const existing = this.vault.getAbstractFileByPath(folder);
      if (existing) {
        if (isFolder(existing)) {
          continue;
        }
        throw new Error("Configured Galley output folder conflicts with a file.");
      }
      await this.vault.createFolder(folder);
    }
  }

  async createOwned(path: string, contents: string): Promise<ObsidianOwnedArtifact> {
    const file = await this.vault.create(path, contents);
    return { path, file, contents };
  }

  async commitOwned(
    handle: ObsidianOwnedArtifact,
    finalPath: string,
    signal?: AbortSignal
  ): Promise<
    | { status: "committed"; handle: ObsidianOwnedArtifact }
    | { status: "collision" }
  > {
    if (!(await this.owns(handle))) {
      throw new Error("Galley temporary artifact ownership was lost.");
    }
    if (!isNormalizedVaultRelativePath(finalPath)) {
      throw new Error("Galley final artifact path is not normalized.");
    }
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (await this.vault.adapter.exists(finalPath)) return { status: "collision" };

    const observer = observeFinalFile(this.vault, finalPath, handle.contents);
    try {
      await this.vault.adapter.copy(handle.path, finalPath);
    } catch (error) {
      observer.dispose();
      if (await this.vault.adapter.exists(finalPath)) return { status: "collision" };
      throw error;
    }

    try {
      const file = await observer.wait(signal);
      return {
        status: "committed",
        handle: { path: finalPath, file, contents: handle.contents }
      };
    } finally {
      observer.dispose();
    }
  }

  async owns(handle: ObsidianOwnedArtifact): Promise<boolean> {
    return this.vault.getAbstractFileByPath(handle.path) === handle.file;
  }

  async removeOwned(handle: ObsidianOwnedArtifact): Promise<void> {
    if (await this.owns(handle)) await this.vault.delete(handle.file, true);
  }
}

interface FinalFileObserver {
  wait(signal?: AbortSignal): Promise<TFile>;
  dispose(): void;
}

function observeFinalFile(
  vault: Vault,
  finalPath: string,
  expectedContents: string
): FinalFileObserver {
  let armed = false;
  let enqueueCandidate: ((file: TFile) => void) | null = null;
  const eventRef: EventRef = vault.on("create", (file) => {
    const created = asTFile(file);
    if (!armed || file.path !== finalPath || !created) return;
    enqueueCandidate?.(created);
  });

  return {
    async wait(signal) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return new Promise<TFile>((resolve, reject) => {
        let settled = false;
        let verifying = false;
        const candidates: TFile[] = [];
        const finish = (action: () => void): void => {
          if (settled) return;
          settled = true;
          armed = false;
          window.clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          enqueueCandidate = null;
          action();
        };
        const onAbort = (): void =>
          finish(() => reject(new DOMException("Aborted", "AbortError")));
        const timeout = window.setTimeout(() => {
          finish(() => reject(new Error("Galley final artifact identity was not observed.")));
        }, FINAL_IDENTITY_TIMEOUT_MS);
        const verifyCandidates = async (): Promise<void> => {
          if (verifying || settled) return;
          verifying = true;
          try {
            while (candidates.length > 0 && !settled) {
              const candidate = candidates.shift();
              if (
                candidate &&
                (await verifiesFinalFile(vault, finalPath, expectedContents, candidate))
              ) {
                finish(() => resolve(candidate));
              }
            }
          } finally {
            verifying = false;
            if (candidates.length > 0 && !settled) void verifyCandidates();
          }
        };
        enqueueCandidate = (file) => {
          candidates.push(file);
          void verifyCandidates();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        armed = true;
        const current = asTFile(vault.getAbstractFileByPath(finalPath));
        if (current) enqueueCandidate(current);
      });
    },
    dispose() {
      armed = false;
      enqueueCandidate = null;
      vault.offref(eventRef);
    }
  };
}

async function verifiesFinalFile(
  vault: Vault,
  finalPath: string,
  expectedContents: string,
  candidate: TFile
): Promise<boolean> {
  if (
    candidate.path !== finalPath ||
    vault.getAbstractFileByPath(finalPath) !== candidate
  ) return false;
  let actualContents: string;
  try {
    actualContents = await vault.adapter.read(finalPath);
  } catch {
    return false;
  }
  return (
    actualContents === expectedContents &&
    candidate.path === finalPath &&
    vault.getAbstractFileByPath(finalPath) === candidate
  );
}

function asTFile(file: TAbstractFile | null): TFile | null {
  return !file || isFolder(file) ? null : (file as TFile);
}

function isFolder(file: TAbstractFile): boolean {
  return "children" in file;
}
