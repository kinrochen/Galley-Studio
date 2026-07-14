import { expect, it } from "vitest";
import type { App, SecretStorage } from "obsidian";
import {
  MemorySecretStore,
  ObsidianSecretStore
} from "../../src/secrets/SecretStore";

it("returns a secret without exposing persistence details", () => {
  const store = new MemorySecretStore(new Map([["galley-key", "secret"]]));

  expect(store.get("galley-key")).toBe("secret");
  expect(store.get("missing")).toBeNull();
});

it("resolves stored secrets through Obsidian SecretStorage", () => {
  const app = makeAppWithSecrets(new Map([["galley-key", "secret"]]));
  const store = new ObsidianSecretStore(app);

  expect(store.get("galley-key")).toBe("secret");
  expect(store.get("missing")).toBeNull();
});

it("returns null for an empty Secret ID without querying Obsidian", () => {
  const store = new ObsidianSecretStore(makeAppWithSecrets(new Map()));

  expect(store.get("")).toBeNull();
});

function makeAppWithSecrets(values: Map<string, string>): App {
  const secretStorage: Pick<SecretStorage, "getSecret" | "listSecrets" | "setSecret"> = {
    getSecret: (id) => {
      if (!id) {
        throw new Error("Secret IDs must not be empty");
      }

      return values.get(id) ?? null;
    },
    listSecrets: () => [...values.keys()],
    setSecret: (id, secret) => {
      values.set(id, secret);
    }
  };

  return { secretStorage } as App;
}
