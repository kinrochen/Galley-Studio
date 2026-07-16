import type {
  GalleyLanguage,
  GalleyLocale,
  LocalizedText,
  TranslationParameters
} from "./LocalizedText";
import {
  EN,
  RESOURCES,
  type MessageKey,
  type MessageResources
} from "./Resources";

export interface LocaleStoreOptions {
  readonly language: GalleyLanguage;
  readonly obsidianLocale: () => string | undefined;
  readonly resources?: Readonly<{
    en: Readonly<Record<string, string>>;
    "zh-CN": Readonly<Record<string, string>>;
  }>;
}

export class LocaleStore implements LocalizedText {
  #language: GalleyLanguage;
  readonly #obsidianLocale: () => string | undefined;
  readonly #resources: LocaleStoreOptions["resources"];
  readonly #listeners = new Set<() => void>();

  constructor(options: LocaleStoreOptions) {
    this.#language = options.language;
    this.#obsidianLocale = options.obsidianLocale;
    this.#resources = options.resources ?? RESOURCES;
  }

  configuredLanguage(): GalleyLanguage {
    return this.#language;
  }

  locale(): GalleyLocale {
    return this.#language === "auto"
      ? resolveGalleyLocale(this.#obsidianLocale())
      : this.#language;
  }

  configure(language: GalleyLanguage): void {
    if (language === this.#language) return;
    this.#language = language;
    for (const listener of [...this.#listeners]) listener();
  }

  t(key: MessageKey, parameters?: TranslationParameters): string {
    const localized = this.#resources?.[this.locale()]?.[key];
    const template = localized ?? EN[key];
    if (!parameters) return template;
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token: string, name: string) =>
      Object.hasOwn(parameters, name) ? String(parameters[name]) : token
    );
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.#listeners.delete(listener);
    };
  }
}

export function resolveGalleyLocale(locale: string | undefined): GalleyLocale {
  return /^zh(?:[-_]|$)/i.test(locale ?? "") ? "zh-CN" : "en";
}

export function isGalleyLanguage(value: unknown): value is GalleyLanguage {
  return value === "auto" || value === "zh-CN" || value === "en";
}

export type { GalleyLanguage, GalleyLocale, MessageResources };
