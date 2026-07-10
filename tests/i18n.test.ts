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
  expect(t("status.extractingPdf", { path: "raw/a.pdf" })).toBe("ContextOS: extracting text from PDF raw/a.pdf...");
});

test("provides English raw parser error messages", () => {
  const translations = ENGLISH_TRANSLATIONS as Record<string, string>;

  expect(translations["error.rawParseFailed"])
    .toBe("Failed to parse raw file {path}: {message}");
  expect(translations["error.officeFileEmpty"])
    .toBe("No extractable text found in Office file: {path}");
  expect(translations["error.imageOcrEmpty"])
    .toBe("No text found in image: {path}");
});

test("provides zh raw parser error messages", () => {
  const translations = SUPPORTED_TRANSLATIONS.zh as Record<string, string>;

  expect(translations["error.rawParseFailed"])
    .toBe("解析原始文件失败：{path}：{message}");
  expect(translations["error.officeFileEmpty"])
    .toBe("Office 文件中未找到可提取的文本：{path}");
  expect(translations["error.imageOcrEmpty"])
    .toBe("图片中未找到文本：{path}");
});

test("provides English provider reliability error messages", () => {
  const translations = ENGLISH_TRANSLATIONS as Record<string, string>;

  expect(translations["error.openAIResponseTruncated"])
    .toBe("OpenAI response was truncated. Try fewer sources at once or a model with a larger output limit.");
  expect(translations["error.openAIRequestTimedOut"])
    .toBe("OpenAI request timed out. Check your connection or try again.");
});

test("provides zh provider reliability error messages", () => {
  const translations = SUPPORTED_TRANSLATIONS.zh as Record<string, string>;

  expect(translations["error.openAIResponseTruncated"])
    .toBe("OpenAI 响应被截断。请减少单次来源数量，或改用输出上限更大的模型。");
  expect(translations["error.openAIRequestTimedOut"])
    .toBe("OpenAI 请求超时。请检查网络连接或稍后重试。");
});

test("ingest command label reflects that it ingests changed raw files", () => {
  expect((ENGLISH_TRANSLATIONS as Record<string, string>)["command.ingestActiveSource"])
    .toBe("Ingest changed raw files into ContextOS");
  expect((SUPPORTED_TRANSLATIONS.zh as Record<string, string>)["command.ingestActiveSource"])
    .toBe("将变更的原始文件导入 ContextOS");
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
