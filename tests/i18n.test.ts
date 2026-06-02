import { __setLanguage } from "./obsidianMock";
import {
  ENGLISH_TRANSLATIONS,
  OBSIDIAN_LANGUAGE_CODES,
  SUPPORTED_TRANSLATIONS,
  getResolvedLocale,
  t
} from "../src/i18n";

beforeEach(() => {
  __setLanguage("en");
});

test("exact zh match resolves to zh and uses Chinese raw folder translation", () => {
  __setLanguage("zh");

  expect(getResolvedLocale()).toBe("zh");
  expect(t("settings.rawFolder.name")).toBe("原始文件夹");
});

test("zh-CN falls back to zh", () => {
  __setLanguage("zh-CN");

  expect(getResolvedLocale()).toBe("zh");
  expect(t("settings.rawFolder.name")).toBe("原始文件夹");
});

test("unknown locale falls back to en", () => {
  __setLanguage("xx-YY");

  expect(getResolvedLocale()).toBe("en");
  expect(t("settings.rawFolder.name")).toBe("Raw folder");
});

test("interpolates named placeholders", () => {
  expect(t("status.extractingPdf", { path: "raw/a.pdf" })).toBe("Auto LLM Wiki: extracting text from PDF raw/a.pdf...");
});

test("supported translation keys match Obsidian language codes", () => {
  expect(Object.keys(SUPPORTED_TRANSLATIONS).sort()).toEqual([...OBSIDIAN_LANGUAGE_CODES].sort());
});

test("every supported locale has every English translation key", () => {
  const englishKeys = Object.keys(ENGLISH_TRANSLATIONS);

  for (const locale of OBSIDIAN_LANGUAGE_CODES) {
    expect(Object.keys(SUPPORTED_TRANSLATIONS[locale]).sort()).toEqual([...englishKeys].sort());
  }
});
