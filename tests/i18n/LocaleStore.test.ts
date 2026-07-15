import { describe, expect, it, vi } from "vitest";
import { EN, ZH_CN } from "../../src/i18n/Resources";
import {
  LocaleStore,
  resolveGalleyLocale
} from "../../src/i18n/LocaleStore";

describe("LocaleStore", () => {
  it("keeps English and Simplified Chinese resource keys identical", () => {
    expect(Object.keys(ZH_CN).sort()).toEqual(Object.keys(EN).sort());
  });

  it.each([
    ["zh", "zh-CN"],
    ["zh-cn", "zh-CN"],
    ["zh_Hans", "zh-CN"],
    ["ZH-TW", "zh-CN"],
    ["en-US", "en"],
    ["fr", "en"],
    [undefined, "en"]
  ] as const)("resolves Obsidian locale %s to %s", (source, expected) => {
    expect(resolveGalleyLocale(source)).toBe(expected);
  });

  it("follows Obsidian in auto mode and honors explicit overrides", () => {
    let obsidianLocale = "zh-cn";
    const store = new LocaleStore({
      language: "auto",
      obsidianLocale: () => obsidianLocale
    });

    expect(store.configuredLanguage()).toBe("auto");
    expect(store.locale()).toBe("zh-CN");
    obsidianLocale = "en-US";
    expect(store.locale()).toBe("en");

    store.configure("zh-CN");
    expect(store.locale()).toBe("zh-CN");
    store.configure("en");
    expect(store.locale()).toBe("en");
  });

  it("publishes one change and supports idempotent unsubscription", () => {
    const store = new LocaleStore({ language: "auto", obsidianLocale: () => "en" });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = store.subscribe(first);
    store.subscribe(second);

    store.configure("zh-CN");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();
    unsubscribeFirst();
    store.configure("en");
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("interpolates parameters as inert text and preserves unknown tokens", () => {
    const store = new LocaleStore({ language: "en", obsidianLocale: () => "zh" });

    expect(
      store.t("common.confirm.delete", {
        target: '<img src=x onerror="alert(1)">'
      })
    ).toBe('Delete “<img src=x onerror="alert(1)">”?');
    expect(store.t("common.confirm.delete")).toBe("Delete “{target}”?");
  });

  it("falls back to canonical English for a missing localized message", () => {
    const chinese = { ...ZH_CN } as Record<string, string>;
    delete chinese["console.title"];
    const store = new LocaleStore({
      language: "zh-CN",
      obsidianLocale: () => "en",
      resources: { en: EN, "zh-CN": chinese }
    });

    expect(store.t("console.title")).toBe(EN["console.title"]);
  });
});
