import { expect, it } from "vitest";
import { memoryVault } from "./memoryVault";

it("returns frozen sorted paths that track create, rename, and remove", async () => {
  const vault = memoryVault({
    "z-last.md": "last",
    "a-first.md": "first"
  });

  const initialPaths = vault.paths();
  expect(initialPaths).toEqual(["a-first.md", "z-last.md"]);
  expect(Object.isFrozen(initialPaths)).toBe(true);
  expect(() => initialPaths.push("caller-change.md")).toThrow();
  expect(vault.paths()).toEqual(["a-first.md", "z-last.md"]);

  await vault.create("middle.md", "middle");
  await vault.rename("z-last.md", "b-renamed.md");
  await vault.remove("a-first.md");

  expect(vault.paths()).toEqual(["b-renamed.md", "middle.md"]);
});
