import type { App } from "obsidian";

export interface SecretStore {
  get(id: string): string | null;
}

export class ObsidianSecretStore implements SecretStore {
  constructor(private readonly app: App) {}

  get(id: string): string | null {
    return id ? this.app.secretStorage.getSecret(id) : null;
  }
}

export class MemorySecretStore implements SecretStore {
  constructor(private readonly values: ReadonlyMap<string, string>) {}

  get(id: string): string | null {
    return this.values.get(id) ?? null;
  }
}
