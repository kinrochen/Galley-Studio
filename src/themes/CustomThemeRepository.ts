import { ComponentLibraryValidator } from "../theme-lab/ComponentLibraryValidator";
import type { ThemeArchive } from "./ThemeArchive";
import {
  parseThemeManifest,
  ThemeManifestV1Schema,
  type ThemeManifestV1
} from "./ThemeManifest";

export interface StoredThemeFiles {
  readonly manifest: ThemeManifestV1;
  readonly componentLibrary: string;
  readonly previewHtml: string;
}

export interface AtomicThemeStore {
  listIds(): Promise<readonly string[]>;
  read(id: string): Promise<StoredThemeFiles | null>;
  commit(
    id: string,
    files: StoredThemeFiles,
    expected: "absent" | "present"
  ): Promise<"committed" | "collision">;
  remove(id: string): Promise<boolean>;
}

export class ThemeRepositoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ThemeRepositoryError";
  }
}

export class CustomThemeRepository {
  readonly #builtInIds: ReadonlySet<string>;
  readonly #validator = new ComponentLibraryValidator();

  constructor(
    private readonly store: AtomicThemeStore,
    builtInIds: readonly string[],
    private readonly now: () => Date = () => new Date()
  ) {
    this.#builtInIds = new Set(builtInIds);
  }

  async list(): Promise<readonly StoredThemeFiles[]> {
    const values: StoredThemeFiles[] = [];
    for (const id of await this.store.listIds()) {
      const value = await this.get(id);
      if (value) values.push(value);
    }
    return Object.freeze(values);
  }

  async get(id: string): Promise<StoredThemeFiles | null> {
    const value = await this.store.read(id);
    return value ? validateStored(value, this.#validator) : null;
  }

  async save(files: StoredThemeFiles): Promise<void> {
    const validated = validateStored(files, this.#validator);
    const id = validated.manifest.id;
    if (this.#builtInIds.has(id)) this.#collision(id);
    const result = await this.store.commit(id, validated, "absent");
    if (result === "collision") this.#collision(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const current = await this.get(id);
    if (!current) throw new ThemeRepositoryError("theme_not_found", `Theme not found: ${id}`);
    const manifest = ThemeManifestV1Schema.parse({
      ...current.manifest,
      enabled,
      updatedAt: this.#nextUpdatedAt(current.manifest)
    });
    const result = await this.store.commit(id, { ...current, manifest }, "present");
    if (result === "collision") {
      throw new ThemeRepositoryError("theme_concurrent_change", `Theme changed concurrently: ${id}`);
    }
  }

  async delete(id: string): Promise<boolean> {
    return this.store.remove(id);
  }

  async import(bytes: Uint8Array, archive: ThemeArchive): Promise<void> {
    await this.save(archive.import(bytes));
  }

  async export(id: string, archive: ThemeArchive): Promise<Uint8Array> {
    const files = await this.get(id);
    if (!files) throw new ThemeRepositoryError("theme_not_found", `Theme not found: ${id}`);
    return archive.export(files);
  }

  #collision(id: string): never {
    throw new ThemeRepositoryError("theme_id_collision", `Theme id already exists: ${id}`);
  }

  #nextUpdatedAt(manifest: ThemeManifestV1): string {
    const now = this.now().getTime();
    return new Date(Math.max(now, Date.parse(manifest.updatedAt) + 1)).toISOString();
  }
}

function validateStored(
  files: StoredThemeFiles,
  validator: ComponentLibraryValidator
): StoredThemeFiles {
  const manifest = parseThemeManifest(files.manifest);
  const component = validator.validate(files.componentLibrary);
  if (!component.valid) {
    throw new ThemeRepositoryError(
      "theme_component_invalid",
      `Theme component validation failed: ${component.issues.map(({ code }) => code).join(", ")}`
    );
  }
  if (/<script\b|\son[a-z]+\s*=/iu.test(files.previewHtml)) {
    throw new ThemeRepositoryError("theme_preview_invalid", "Theme preview contains executable content.");
  }
  return Object.freeze({
    manifest: Object.freeze({ ...manifest }),
    componentLibrary: files.componentLibrary,
    previewHtml: files.previewHtml
  });
}
