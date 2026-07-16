import { EN, type MessageKey } from "./Resources";

export type GalleyLanguage = "auto" | "zh-CN" | "en";
export type GalleyLocale = Exclude<GalleyLanguage, "auto">;
export type TranslationParameters = Readonly<
  Record<string, string | number>
>;

export interface LocalizedText {
  configuredLanguage(): GalleyLanguage;
  locale(): GalleyLocale;
  t(key: MessageKey, parameters?: TranslationParameters): string;
  subscribe(listener: () => void): () => void;
}

export interface LocalizedMessage {
  readonly key: MessageKey;
  readonly parameters?: TranslationParameters;
}

export function translateMessage(
  text: Pick<LocalizedText, "t">,
  message: LocalizedMessage
): string {
  return text.t(message.key, message.parameters);
}

export const ENGLISH_LOCALIZED_TEXT: LocalizedText = Object.freeze({
  configuredLanguage: () => "en" as const,
  locale: () => "en" as const,
  t: (key: MessageKey, parameters?: TranslationParameters) => {
    const template = EN[key];
    if (!parameters) return template;
    return template.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (token: string, name: string) =>
      Object.hasOwn(parameters, name) ? String(parameters[name]) : token
    );
  },
  subscribe: () => () => undefined
});
