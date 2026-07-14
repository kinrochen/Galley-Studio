import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

const FIXTURE_DIRECTORY = resolve(process.cwd(), "tests/fixtures");

export function loadFixture(name: string): string {
  const fixturePath = resolve(FIXTURE_DIRECTORY, name);
  if (!fixturePath.startsWith(`${FIXTURE_DIRECTORY}${sep}`)) {
    throw new Error(`Fixture path escapes tests/fixtures: ${name}`);
  }
  return readFileSync(fixturePath, "utf8");
}

export function makeLongDocumentMarkdown(sectionCount = 10): string {
  return Array.from(
    { length: sectionCount },
    (_, index) => `## Section ${index + 1}\n\nBody ${index + 1}.`
  ).join("\n\n");
}
