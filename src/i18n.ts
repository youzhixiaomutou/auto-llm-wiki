import { getLanguage } from "obsidian";

export const OBSIDIAN_LANGUAGE_CODES = [
  "en",
  "af",
  "am",
  "ar",
  "az",
  "be",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "dv",
  "el",
  "en-GB",
  "eo",
  "es",
  "eu",
  "fa",
  "fi",
  "fr",
  "ga",
  "gl",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ka",
  "kh",
  "kn",
  "ko",
  "ky",
  "la",
  "lt",
  "lv",
  "ml",
  "ms",
  "nan-TW",
  "ne",
  "nl",
  "nn",
  "no",
  "oc",
  "or",
  "pl",
  "pt",
  "pt-BR",
  "ro",
  "ru",
  "sa",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tl",
  "tr",
  "tt",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh",
  "zh-TW"
] as const;

export type SupportedLocale = typeof OBSIDIAN_LANGUAGE_CODES[number];

export const ENGLISH_TRANSLATIONS = {
  "settings.title": "Auto LLM Wiki",
  "settings.rawFolder.name": "Raw folder",
  "settings.rawFolder.desc": "Immutable source documents.",
  "settings.wikiFolder.name": "Wiki folder",
  "settings.wikiFolder.desc": "LLM-maintained markdown pages.",
  "settings.assetsFolder.name": "Assets folder",
  "settings.assetsFolder.desc": "Local attachments for raw sources.",
  "settings.indexPath.name": "Index path",
  "settings.indexPath.desc": "Content-oriented wiki index.",
  "settings.logPath.name": "Log path",
  "settings.logPath.desc": "Newest-first wiki operation log.",
  "settings.openAIApiUrl.name": "OpenAI API URL",
  "settings.openAIApiUrl.desc": "Chat completions endpoint URL.",
  "settings.openAIApiKey.name": "OpenAI API key",
  "settings.openAIApiKey.desc": "Stored in Obsidian plugin data.",
  "settings.openAIModel.name": "OpenAI model",
  "settings.openAIModel.desc": "Model used for wiki maintenance.",
  "settings.autoIngestEnabled.name": "Auto ingest raw file changes",
  "settings.autoIngestEnabled.desc": "Automatically analyze and apply changes when supported raw files change.",
  "settings.testConnection.name": "Test OpenAI connection",
  "settings.testConnection.desc": "Checks whether the configured endpoint returns HTTP 2xx.",
  "notice.openAIConnectionSucceeded": "OpenAI connection test succeeded.",
  "notice.openAIConnectionFailed": "OpenAI connection test failed: {message}",
  "error.unknown": "Unknown error",
  "error.invalidChangePlanShape": "Invalid change plan shape",
  "error.unsafePath": "Unsafe path: {path}",
  "error.pathOutsideWiki": "Operation path is outside wiki folder: {path}",
  "error.pathInsideReadOnly": "Operation path is inside a read-only folder: {path}",
  "error.invalidOperationKind": "Invalid operation kind",
  "error.invalidOperationPath": "Invalid operation path",
  "error.invalidOperationContent": "Invalid operation content",
  "error.invalidOperationRationale": "Invalid operation rationale",
  "error.indexOutsideWiki": "Index path must be inside the wiki folder",
  "error.logOutsideWiki": "Log path must be inside the wiki folder",
  "error.markdownExtensionRequired": "Markdown files must use the .md extension",
  "error.fileAlreadyExists": "File already exists: {path}",
  "error.openAIRequestFailed": "OpenAI request failed: {message}",
  "error.openAIResponseMissingContent": "OpenAI response did not include message content",
  "error.openAIResponseInvalidJson": "OpenAI response was not JSON. Check the API URL; it should point to a chat completions endpoint.",
  "error.openAIResponseTruncated": "OpenAI response was truncated. Try fewer sources at once or a model with a larger output limit.",
  "error.openAIRequestTimedOut": "OpenAI request timed out. Check your connection or try again.",
  "error.renderPdfPageForOcr": "Unable to render PDF page for OCR",
  "error.noExtractablePdfText": "No extractable text found in PDF: {path}",
  "error.imageOcrProviderMissing": "Image OCR provider is not configured: {path}",
  "error.rawParseFailed": "Failed to parse raw file {path}: {message}",
  "error.officeFileEmpty": "No extractable text found in Office file: {path}",
  "error.imageOcrEmpty": "No text found in image: {path}",
  "command.ingestActiveSource": "Ingest active source into Auto LLM Wiki",
  "command.queryWiki": "Query Auto LLM Wiki",
  "command.lintWiki": "Lint Auto LLM Wiki",
  "status.idle": "Auto LLM Wiki: idle",
  "status.scanningRaw": "Auto LLM Wiki: scanning raw folder for changes...",
  "status.extractingPdf": "Auto LLM Wiki: extracting text from PDF {path}...",
  "status.noRawChanges": "Auto LLM Wiki: no raw changes",
  "notice.noRawChanges": "Auto LLM Wiki: no new or changed raw files.",
  "status.readingVaultContext": "Auto LLM Wiki: reading vault context...",
  "status.error": "Auto LLM Wiki: error - {message}",
  "status.rawCandidatesNonePdf": "Auto LLM Wiki: found {sourceCount} raw {sourceLabel}, no PDF candidates",
  "status.rawCandidatesIncludingPdf": "Auto LLM Wiki: found {sourceCount} raw {sourceLabel}, including PDFs: {pdfPaths}",
  "label.sourceCandidate.one": "source candidate",
  "label.sourceCandidate.other": "source candidates",
  "status.ocrPdfPage": "Auto LLM Wiki: OCR PDF page {pageNumber} from {path}...",
  "status.ocrImage": "Auto LLM Wiki: OCR image {path}...",
  "prompt.queryQuestion": "Ask the Auto LLM Wiki a question",
  "notice.missingOpenAIKey": "Set your OpenAI API key in Auto LLM Wiki settings.",
  "status.waitingModel": "Auto LLM Wiki: waiting for model response...",
  "status.validatingChanges": "Auto LLM Wiki: validating proposed changes...",
  "status.reviewChanges": "Auto LLM Wiki: review proposed changes",
  "status.applyingChanges": "Auto LLM Wiki: applying changes...",
  "status.applied": "Auto LLM Wiki: applied",
  "notice.reviewChanges": "Auto LLM Wiki: review proposed changes.",
  "notice.changesApplied": "Auto LLM Wiki changes applied.",
  "notice.applyChangesFailed": "Failed to apply Auto LLM Wiki changes: {message}",
  "preview.title": "Review Auto LLM Wiki changes",
  "preview.noSummary": "No summary provided by the model.",
  "preview.proposedFileChanges": "{count} proposed file changes",
  "preview.operationCount": "{count} {kind}",
  "preview.noFileChanges": "No file changes were proposed by the model.",
  "operation.create": "CREATE",
  "operation.update": "UPDATE",
  "operation.append": "APPEND",
  "operation.prepend": "PREPEND",
  "preview.applyChanges": "Apply changes",
  "preview.cancel": "Cancel",
  "error.ingestFailed": "Auto LLM Wiki ingest failed.",
  "error.requestFailed": "Auto LLM Wiki request failed.",
  "prompt.outputLanguageInstruction": "Write user-visible natural-language output in {language}.",
  "prompt.ocrPdfPage": "Transcribe all visible text from PDF page {pageNumber} of {path}. Return only the transcription, preserving text and line breaks as much as possible.",
  "prompt.ocrImage": "Transcribe all visible text from image {path}. Return only the transcription, preserving text and line breaks as much as possible."
} as const;

type TranslationKey = keyof typeof ENGLISH_TRANSLATIONS;
type TranslationTable = Record<TranslationKey, string>;

const DEFAULT_TRANSLATIONS: TranslationTable = { ...ENGLISH_TRANSLATIONS };

export const SUPPORTED_TRANSLATIONS = {} as Record<SupportedLocale, TranslationTable>;

const ZH_TRANSLATIONS: Partial<TranslationTable> = {
  "settings.title": "Auto LLM Wiki",
  "settings.rawFolder.name": "原始文件夹",
  "settings.rawFolder.desc": "不可变的源文档。",
  "settings.wikiFolder.name": "Wiki 文件夹",
  "settings.wikiFolder.desc": "由 LLM 维护的 Markdown 页面。",
  "settings.assetsFolder.name": "附件文件夹",
  "settings.assetsFolder.desc": "原始来源的本地附件。",
  "settings.indexPath.name": "索引路径",
  "settings.indexPath.desc": "面向内容的 Wiki 索引。",
  "settings.logPath.name": "日志路径",
  "settings.logPath.desc": "最新在前的 Wiki 操作日志。",
  "settings.openAIApiUrl.name": "OpenAI API URL",
  "settings.openAIApiUrl.desc": "聊天补全端点 URL。",
  "settings.openAIApiKey.name": "OpenAI API 密钥",
  "settings.openAIApiKey.desc": "存储在 Obsidian 插件数据中。",
  "settings.openAIModel.name": "OpenAI 模型",
  "settings.openAIModel.desc": "用于维护 Wiki 的模型。",
  "settings.autoIngestEnabled.name": "自动摄入原始文件变更",
  "settings.autoIngestEnabled.desc": "受支持的原始文件变更时，自动分析并应用变更。",
  "settings.testConnection.name": "测试 OpenAI 连接",
  "settings.testConnection.desc": "检查配置的端点是否返回 HTTP 2xx。",
  "notice.openAIConnectionSucceeded": "OpenAI 连接测试成功。",
  "notice.openAIConnectionFailed": "OpenAI 连接测试失败：{message}",
  "error.unknown": "未知错误",
  "error.invalidChangePlanShape": "变更计划结构无效",
  "error.unsafePath": "不安全的路径：{path}",
  "error.pathOutsideWiki": "操作路径不在 wiki 文件夹中：{path}",
  "error.pathInsideReadOnly": "操作路径位于只读文件夹中：{path}",
  "error.invalidOperationKind": "操作类型无效",
  "error.invalidOperationPath": "操作路径无效",
  "error.invalidOperationContent": "操作内容无效",
  "error.invalidOperationRationale": "操作理由无效",
  "error.indexOutsideWiki": "索引路径必须位于 wiki 文件夹中",
  "error.logOutsideWiki": "日志路径必须位于 wiki 文件夹中",
  "error.markdownExtensionRequired": "Markdown 文件必须使用 .md 扩展名",
  "error.fileAlreadyExists": "文件已存在：{path}",
  "error.openAIRequestFailed": "OpenAI 请求失败：{message}",
  "error.openAIResponseMissingContent": "OpenAI 响应未包含消息内容",
  "error.openAIResponseInvalidJson": "OpenAI 响应不是 JSON。请检查 API URL；它应指向聊天补全端点。",
  "error.openAIResponseTruncated": "OpenAI 响应被截断。请减少单次来源数量，或改用输出上限更大的模型。",
  "error.openAIRequestTimedOut": "OpenAI 请求超时。请检查网络连接或稍后重试。",
  "error.renderPdfPageForOcr": "无法渲染 PDF 页面以进行 OCR",
  "error.noExtractablePdfText": "未在 PDF 中找到可提取的文本：{path}",
  "error.imageOcrProviderMissing": "未配置图片 OCR 提供程序：{path}",
  "error.rawParseFailed": "解析原始文件失败：{path}：{message}",
  "error.officeFileEmpty": "Office 文件中未找到可提取的文本：{path}",
  "error.imageOcrEmpty": "图片中未找到文本：{path}",
  "command.ingestActiveSource": "将当前源资料导入 Auto LLM Wiki",
  "command.queryWiki": "查询 Auto LLM Wiki",
  "command.lintWiki": "检查 Auto LLM Wiki",
  "status.idle": "Auto LLM Wiki：空闲",
  "status.scanningRaw": "Auto LLM Wiki：正在扫描原始文件夹中的更改...",
  "status.extractingPdf": "Auto LLM Wiki：正在从 PDF {path} 提取文本...",
  "status.noRawChanges": "Auto LLM Wiki：没有原始文件更改",
  "notice.noRawChanges": "Auto LLM Wiki：没有新的或已更改的原始文件。",
  "status.readingVaultContext": "Auto LLM Wiki：正在读取库上下文...",
  "status.error": "Auto LLM Wiki：错误 - {message}",
  "status.rawCandidatesNonePdf": "Auto LLM Wiki：找到 {sourceCount} 个原始{sourceLabel}，没有 PDF 候选项",
  "status.rawCandidatesIncludingPdf": "Auto LLM Wiki：找到 {sourceCount} 个原始{sourceLabel}，包含 PDF：{pdfPaths}",
  "label.sourceCandidate.one": "源候选项",
  "label.sourceCandidate.other": "源候选项",
  "status.ocrPdfPage": "Auto LLM Wiki：正在 OCR PDF 页面 {pageNumber}，文件 {path}...",
  "status.ocrImage": "Auto LLM Wiki：正在 OCR 图片 {path}...",
  "prompt.queryQuestion": "向 Auto LLM Wiki 提问",
  "notice.missingOpenAIKey": "请在 Auto LLM Wiki 设置中填写 OpenAI API 密钥。",
  "status.waitingModel": "Auto LLM Wiki：正在等待模型响应...",
  "status.validatingChanges": "Auto LLM Wiki：正在验证建议的更改...",
  "status.reviewChanges": "Auto LLM Wiki：请审阅建议的更改",
  "status.applyingChanges": "Auto LLM Wiki：正在应用变更...",
  "status.applied": "Auto LLM Wiki：已应用",
  "notice.reviewChanges": "Auto LLM Wiki：请审阅建议的更改。",
  "notice.changesApplied": "Auto LLM Wiki 变更已应用。",
  "notice.applyChangesFailed": "应用 Auto LLM Wiki 变更失败：{message}",
  "preview.title": "审阅 Auto LLM Wiki 变更",
  "preview.noSummary": "模型未提供摘要。",
  "preview.proposedFileChanges": "{count} 个建议的文件变更",
  "preview.operationCount": "{count} 个{kind}",
  "preview.noFileChanges": "模型未建议任何文件变更。",
  "operation.create": "创建",
  "operation.update": "更新",
  "operation.append": "追加",
  "operation.prepend": "前置",
  "preview.applyChanges": "应用变更",
  "preview.cancel": "取消",
  "error.ingestFailed": "Auto LLM Wiki 导入失败。",
  "error.requestFailed": "Auto LLM Wiki 请求失败。",
  "prompt.outputLanguageInstruction": "Write user-visible natural-language output in {language}.",
  "prompt.ocrPdfPage": "转录 PDF 第 {pageNumber} 页（{path}）中所有可见文本。只返回转录内容，并尽可能保留文本和换行。",
  "prompt.ocrImage": "转录图片 {path} 中所有可见文本。只返回转录内容，并尽可能保留文本和换行。"
};

for (const locale of OBSIDIAN_LANGUAGE_CODES) {
  SUPPORTED_TRANSLATIONS[locale] = {
    ...DEFAULT_TRANSLATIONS,
    ...(locale === "zh" ? ZH_TRANSLATIONS : {})
  };
}

const SUPPORTED_LOCALES = new Set<string>(OBSIDIAN_LANGUAGE_CODES);

export function getResolvedLocale(): SupportedLocale {
  const language = getLanguage();

  if (SUPPORTED_LOCALES.has(language)) {
    return language as SupportedLocale;
  }

  const baseLanguage = language.split("-")[0];
  if (SUPPORTED_LOCALES.has(baseLanguage)) {
    return baseLanguage as SupportedLocale;
  }

  return "en";
}

const OUTPUT_LANGUAGE_NAMES: Partial<Record<SupportedLocale, string>> = {
  en: "English",
  "en-GB": "English",
  zh: "Simplified Chinese",
  "zh-TW": "Traditional Chinese"
};

export function getOutputLanguageName(): string {
  const locale = getResolvedLocale();
  return OUTPUT_LANGUAGE_NAMES[locale] ?? locale;
}

export function t(key: TranslationKey, params: Record<string, string | number> = {}): string {
  const locale = getResolvedLocale();
  const template = SUPPORTED_TRANSLATIONS[locale][key] ?? ENGLISH_TRANSLATIONS[key];

  return template.replace(/\{([^}]+)\}/g, (match, placeholder: string) => {
    const value = params[placeholder];
    return value === undefined ? match : String(value);
  });
}
