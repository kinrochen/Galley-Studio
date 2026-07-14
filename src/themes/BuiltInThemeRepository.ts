import type { SkillVirtualFileSystem } from "../skill/SkillVirtualFileSystem";
import { parseThemeIndex, type ThemeDefinition } from "./ThemeIndex";

const THEME_INDEX_FILE = "references/theme-index.md";

export class BuiltInThemeRepository {
  readonly #themes: readonly ThemeDefinition[];
  readonly #themesById: ReadonlyMap<string, ThemeDefinition>;

  constructor(vfs: SkillVirtualFileSystem) {
    const themes = parseThemeIndex(vfs.read(THEME_INDEX_FILE)).map((theme) =>
      Object.freeze({ ...theme })
    );
    for (const theme of themes) {
      if (!vfs.has(theme.file)) {
        throw new Error(`Theme file is not registered: ${theme.file}`);
      }
    }

    this.#themes = Object.freeze(themes);
    this.#themesById = new Map(themes.map((theme) => [theme.id, theme]));
  }

  list(): readonly ThemeDefinition[] {
    return this.#themes;
  }

  get(id: string): ThemeDefinition | undefined {
    return this.#themesById.get(id);
  }
}
