import { expect, it } from "vitest";
import {
  SkillVirtualFileSystem,
  normalizeSkillPath
} from "../../src/skill/SkillVirtualFileSystem";

const files = new Map([
  ["SKILL.md", "workflow"],
  ["references/theme-index.md", "themes"]
]);

it("reads registered normalized paths", () => {
  const vfs = new SkillVirtualFileSystem(files);

  expect(vfs.read("./references/theme-index.md")).toBe("themes");
  expect(vfs.read("references\\theme-index.md")).toBe("themes");
});

it("reports only registered normalized paths", () => {
  const vfs = new SkillVirtualFileSystem(files);

  expect(vfs.has("./SKILL.md")).toBe(true);
  expect(vfs.has("missing.md")).toBe(false);
});

it.each([
  "",
  ".",
  "..",
  "../secret",
  "/etc/passwd",
  "C:secret",
  "C:\\Windows\\system.ini",
  "file:secret",
  "data:text/plain,x",
  "https:/host/x",
  "git+ssh:host/x",
  "a.b-c:value",
  "https://example.com/x",
  "file:///etc/passwd",
  "references/../../x",
  "references//theme-index.md",
  "references/./theme-index.md",
  "././SKILL.md"
])("rejects invalid skill path %j", (path) => {
  expect(() => normalizeSkillPath(path)).toThrow(/Invalid skill path/);
});

it("rejects valid but unregistered paths", () => {
  const vfs = new SkillVirtualFileSystem(files);

  expect(() => vfs.read("references/not-registered.md")).toThrow(
    /Skill file is not registered/
  );
});

it.each([
  "C:secret",
  "file:secret",
  "data:text/plain,x",
  "https:/host/x"
])("rejects drive and scheme path %j at the read boundary", (path) => {
  const vfs = new SkillVirtualFileSystem(files);

  expect(() => vfs.read(path)).toThrow(/Invalid skill path/);
});

it("copies the allowlist so callers cannot mutate the virtual filesystem", () => {
  const mutableFiles = new Map(files);
  const vfs = new SkillVirtualFileSystem(mutableFiles);

  mutableFiles.set("secret.md", "secret");

  expect(vfs.has("secret.md")).toBe(false);
});

it("rejects non-normalized allowlist entries", () => {
  expect(
    () => new SkillVirtualFileSystem(new Map([["./SKILL.md", "workflow"]]))
  ).toThrow(/registered path must be normalized/);
});

it.each([
  "C:secret",
  "file:secret",
  "data:text/plain,x",
  "https:/host/x"
])("rejects drive and scheme path %j at registration", (path) => {
  expect(
    () => new SkillVirtualFileSystem(new Map([[path, "untrusted"]]))
  ).toThrow(/Invalid skill path/);
});
