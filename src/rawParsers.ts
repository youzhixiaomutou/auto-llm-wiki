import * as mammoth from "mammoth";
import WordExtractor from "word-extractor";
import * as XLSX from "@e965/xlsx";
import * as JSZip from "jszip";
import * as PPT from "ppt-to-text";
import { App, loadPdfJs, TFile } from "obsidian";
import { t } from "./i18n";

export interface PdfTextItem {
  str?: string;
}

export interface PdfViewport {
  width: number;
  height: number;
}

export interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfJs {
  getDocument(data: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

export interface PdfOcrRequest {
  page: PdfPage;
  path: string;
  pageNumber: number;
}

export type PdfOcrProvider = (request: PdfOcrRequest) => Promise<string>;

export interface ImageOcrRequest {
  path: string;
  imageDataUrl: string;
}

export type ImageOcrProvider = (request: ImageOcrRequest) => Promise<string>;

export interface RawParserContext {
  onPdfExtract?: (path: string) => void;
  pdfOcrProvider?: PdfOcrProvider;
  imageOcrProvider?: ImageOcrProvider;
  ocrPageConcurrency?: number;
}

export interface RawParser {
  supports(path: string): boolean;
  read(app: App, file: TFile, context: RawParserContext): Promise<string>;
}

export const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".log",
  ".ts",
  ".js",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".cpp",
  ".sql",
  ".sh"
]);

function getLowercaseExtension(path: string): string {
  const extensionStart = path.lastIndexOf(".");
  if (extensionStart < 0) return "";
  return path.slice(extensionStart).toLowerCase();
}

function requireOfficeText(text: string, path: string): string {
  const trimmedText = text.trim();
  if (!trimmedText) throw new Error(t("error.officeFileEmpty", { path }));
  return trimmedText;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("error.unknown");
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const worker = async (): Promise<void> => {
    for (let index = cursor++; index < items.length; index = cursor++) {
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

function isRawParseFailedMessage(message: string, path: string): boolean {
  const currentLocalePrefix = t("error.rawParseFailed", { path, message: "" });
  const englishPrefix = `Failed to parse raw file ${path}: `;
  return message.startsWith(currentLocalePrefix) || message.startsWith(englishPrefix);
}

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const HTML_BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul"
]);

export function isHtmlRawPath(path: string): boolean {
  return HTML_EXTENSIONS.has(getLowercaseExtension(path));
}

function decodeCommonHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&#39;": "'"
  };
  return text.replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, (entity) => entities[entity.toLowerCase()] ?? entity);
}

function normalizeHtmlText(text: string): string {
  return decodeCommonHtmlEntities(text)
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatHtmlText(title: string, bodyText: string): string {
  const normalizedTitle = normalizeHtmlText(title).replace(/\n+/g, " ");
  const normalizedBody = normalizeHtmlText(bodyText);
  if (normalizedTitle && normalizedBody) return `# ${normalizedTitle}\n\n${normalizedBody}`;
  if (normalizedTitle) return `# ${normalizedTitle}`;
  return normalizedBody;
}

function extractDomNodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return "";

  const element = node.nodeType === 1 ? node as Element : undefined;
  const tagName = element?.tagName.toLowerCase();
  if (tagName === "br") return "\n";

  const childText = Array.from(node.childNodes).map(extractDomNodeText).join("");
  if (tagName && HTML_BLOCK_ELEMENTS.has(tagName)) return `\n${childText}\n`;
  return childText;
}

function stripHtmlTagsToText(html: string): string {
  return html
    .replace(/<(br|hr)\b[^>]*\/?>/gi, "\n")
    .replace(/<\/(address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
}

function extractHtmlTextWithoutDomParser(html: string): string {
  const withoutHiddenBlocks = html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?(?:<\/\1>|$)/gi, "");
  const titleMatch = withoutHiddenBlocks.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const bodyMatch = withoutHiddenBlocks.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const title = titleMatch ? stripHtmlTagsToText(titleMatch[1]) : "";
  const bodySource = bodyMatch ? bodyMatch[1] : withoutHiddenBlocks.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");
  return formatHtmlText(title, stripHtmlTagsToText(bodySource));
}

function extractHtmlText(html: string): string {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(html, "text/html");
    document.querySelectorAll("script, style, noscript, template").forEach((element) => element.remove());
    return formatHtmlText(document.title, document.body ? extractDomNodeText(document.body) : "");
  }
  return extractHtmlTextWithoutDomParser(html);
}

const htmlParser: RawParser = {
  supports(path: string): boolean {
    return isHtmlRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    return extractHtmlText(await app.vault.read(file));
  }
};

function isDocxRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".docx";
}

export function isOpenXmlRawPath(path: string): boolean {
  const extension = getLowercaseExtension(path);
  return extension === ".docx" || extension === ".xlsx" || extension === ".pptx";
}

export function isBinaryOfficeRawPath(path: string): boolean {
  return isDocxRawPath(path) || isDocRawPath(path) || isXlsxRawPath(path) || isPptRawPath(path) || isPptxRawPath(path);
}

const docxParser: RawParser = {
  supports(path: string): boolean {
    return isDocxRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    const arrayBuffer = await app.vault.readBinary(file);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return requireOfficeText(result.value, file.path);
  }
};

function isDocRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".doc";
}

const docParser: RawParser = {
  supports(path: string): boolean {
    return isDocRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    const arrayBuffer = await app.vault.readBinary(file);
    const extractor = new WordExtractor();
    const document = await extractor.extract(Buffer.from(new Uint8Array(arrayBuffer)));
    return requireOfficeText(document.getBody(), file.path);
  }
};

function isXlsxRawPath(path: string): boolean {
  const extension = getLowercaseExtension(path);
  return extension === ".xlsx" || extension === ".xls";
}

function formatXlsxCell(cell: unknown): string {
  return cell == null ? "" : String(cell);
}

function hasXlsxCellText(rows: unknown[][]): boolean {
  return rows.some((row) => row.some((cell) => formatXlsxCell(cell).trim().length > 0));
}

const xlsxParser: RawParser = {
  supports(path: string): boolean {
    return isXlsxRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    const buffer = await app.vault.readBinary(file);
    const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
    let hasCellText = false;
    const text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false }) as unknown[][];
      hasCellText = hasCellText || hasXlsxCellText(rows);
      return [`# Sheet: ${sheetName}`, ...rows.map((row) => row.map(formatXlsxCell).join("\t"))].join("\n");
    }).join("\n\n");
    if (!hasCellText) throw new Error(t("error.officeFileEmpty", { path: file.path }));
    return requireOfficeText(text, file.path);
  }
};

function isRtfRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".rtf";
}

function decodeRtfHexByte(hex: string): string {
  return String.fromCharCode(Number.parseInt(hex, 16));
}

function decodeSignedRtfUnicode(value: string): string {
  const code = Number.parseInt(value, 10);
  return String.fromCharCode(code < 0 ? code + 65536 : code);
}

const RTF_NON_TEXT_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "datastore",
  "themedata",
  "generator"
]);

interface RtfGroupState {
  skip: boolean;
  ignorable: boolean;
}

function skipRtfUnicodeFallback(rtf: string, index: number, count: number): number {
  let currentIndex = index;
  for (let skipped = 0; skipped < count && currentIndex < rtf.length; skipped++) {
    if (rtf[currentIndex] === "\\" && rtf[currentIndex + 1] === "'") {
      currentIndex += 4;
    } else {
      currentIndex++;
    }
  }
  return currentIndex;
}

function extractRtfText(rtf: string): string {
  let text = "";
  let index = 0;
  let unicodeFallbackCount = 1;
  const groupStack: RtfGroupState[] = [{ skip: false, ignorable: false }];

  while (index < rtf.length) {
    const group = groupStack[groupStack.length - 1];
    const char = rtf[index];
    if (char === "{") {
      groupStack.push({ ...group });
      index++;
      continue;
    }
    if (char === "}") {
      if (groupStack.length > 1) groupStack.pop();
      index++;
      continue;
    }
    if (char !== "\\") {
      if (!group.skip) text += char;
      index++;
      continue;
    }

    const next = rtf[index + 1];
    if (next === "*") {
      group.ignorable = true;
      index += 2;
      continue;
    }
    if (next === "\\" || next === "{" || next === "}") {
      if (!group.skip) text += next;
      index += 2;
      continue;
    }
    if (next === "'") {
      if (!group.skip) text += decodeRtfHexByte(rtf.slice(index + 2, index + 4));
      index += 4;
      continue;
    }

    const controlMatch = rtf.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!controlMatch) {
      index += 2;
      continue;
    }

    const control = controlMatch[1];
    const argument = controlMatch[2];
    if (RTF_NON_TEXT_DESTINATIONS.has(control) || group.ignorable) group.skip = true;
    if (control === "uc" && argument !== undefined) unicodeFallbackCount = Number.parseInt(argument, 10);
    if (control === "bin" && argument !== undefined) {
      index += 1 + controlMatch[0].length + Number.parseInt(argument, 10);
      continue;
    }
    if (!group.skip) {
      if (control === "par" || control === "line") text += "\n";
      if (control === "tab") text += "\t";
      if (control === "u" && argument !== undefined) text += decodeSignedRtfUnicode(argument);
    }
    index += 1 + controlMatch[0].length;
    if (control === "u" && argument !== undefined) index = skipRtfUnicodeFallback(rtf, index, unicodeFallbackCount);
  }
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

const rtfParser: RawParser = {
  supports(path: string): boolean {
    return isRtfRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    return requireOfficeText(extractRtfText(await app.vault.read(file)), file.path);
  }
};

function isPptRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".ppt";
}

const pptParser: RawParser = {
  supports(path: string): boolean {
    return isPptRawPath(path);
  },
  async read(app: App, file: TFile): Promise<string> {
    const arrayBuffer = await app.vault.readBinary(file);
    const text = PPT.extractText(Buffer.from(new Uint8Array(arrayBuffer)), { separator: "\n\n" });
    const slides = text
      .split(/\n{2,}/)
      .map((slide) => slide.trim())
      .filter((slide) => slide.length > 0)
      .map((slide, index) => `# Slide ${index + 1}\n${slide}`);
    return requireOfficeText(slides.join("\n\n"), file.path);
  }
};

function isPptxRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".pptx";
}

function decodeCommonXmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": "\"",
    "&apos;": "'"
  };
  return text.replace(/&(amp|lt|gt|quot|apos);/gi, (entity) => entities[entity.toLowerCase()] ?? entity);
}

interface PptxArchiveFile {
  async(type: "text" | "base64"): Promise<string>;
}

type PptxArchiveFiles = Record<string, PptxArchiveFile | undefined>;

interface PptxSlideEntry {
  path: string;
  filenameSlideNumber: number;
}

function parseXmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match = attributePattern.exec(tag);
  while (match) {
    attributes[match[1]] = decodeCommonXmlEntities(match[3]);
    match = attributePattern.exec(tag);
  }
  return attributes;
}

function extractPptxPresentationSlideRelationshipIds(presentationXml: string): string[] {
  const relationshipIds: string[] = [];
  const slideIdPattern = /<(?:\w+:)?sldId\b[^>]*>/g;
  let match = slideIdPattern.exec(presentationXml);
  while (match) {
    const attributes = parseXmlAttributes(match[0]);
    const relationshipId = attributes["r:id"];
    if (relationshipId) relationshipIds.push(relationshipId);
    match = slideIdPattern.exec(presentationXml);
  }
  return relationshipIds;
}

function extractPptxPresentationRelationships(relationshipsXml: string): Map<string, string> {
  const relationships = new Map<string, string>();
  const relationshipPattern = /<Relationship\b[^>]*>/g;
  let match = relationshipPattern.exec(relationshipsXml);
  while (match) {
    const attributes = parseXmlAttributes(match[0]);
    const id = attributes.Id;
    const target = attributes.Target;
    if (id && target) relationships.set(id, target);
    match = relationshipPattern.exec(relationshipsXml);
  }
  return relationships;
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return parts.join("/");
}

function stripRelationshipTargetSuffix(target: string): string {
  return target.split("#")[0].split("?")[0];
}

function resolvePptxRelationshipTarget(target: string): string {
  const targetWithoutQuery = stripRelationshipTargetSuffix(target);
  if (targetWithoutQuery.startsWith("/")) return normalizeZipPath(targetWithoutQuery.slice(1));
  if (targetWithoutQuery.startsWith("ppt/")) return normalizeZipPath(targetWithoutQuery);
  return normalizeZipPath(`ppt/${targetWithoutQuery}`);
}

function resolvePptxSlideRelationshipTarget(slidePath: string, target: string): string {
  const targetWithoutQuery = stripRelationshipTargetSuffix(target);
  if (targetWithoutQuery.startsWith("/")) return normalizeZipPath(targetWithoutQuery.slice(1));
  const slideDirectory = slidePath.slice(0, slidePath.lastIndexOf("/"));
  return normalizeZipPath(`${slideDirectory}/${targetWithoutQuery}`);
}

function getFilenameSortedPptxSlides(files: PptxArchiveFiles): PptxSlideEntry[] {
  return Object.keys(files)
    .map((path) => {
      const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
      if (!match) return undefined;
      return { path, filenameSlideNumber: Number(match[1]) };
    })
    .filter((slide): slide is PptxSlideEntry => slide !== undefined)
    .sort((left, right) => left.filenameSlideNumber - right.filenameSlideNumber);
}

function getRelationshipOrderedPptxSlides(
  files: PptxArchiveFiles,
  presentationXml: string,
  relationshipsXml: string
): PptxSlideEntry[] | undefined {
  const relationshipIds = extractPptxPresentationSlideRelationshipIds(presentationXml);
  if (relationshipIds.length === 0) return undefined;

  const relationships = extractPptxPresentationRelationships(relationshipsXml);
  const slides: PptxSlideEntry[] = [];
  for (const relationshipId of relationshipIds) {
    const target = relationships.get(relationshipId);
    if (!target) return undefined;

    const path = resolvePptxRelationshipTarget(target);
    const match = path.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (!match || !files[path]) return undefined;

    slides.push({ path, filenameSlideNumber: Number(match[1]) });
  }
  return slides;
}

async function getPptxSlides(files: PptxArchiveFiles): Promise<PptxSlideEntry[]> {
  const presentationFile = files["ppt/presentation.xml"];
  const relationshipsFile = files["ppt/_rels/presentation.xml.rels"];
  if (presentationFile && relationshipsFile) {
    try {
      const [presentationXml, relationshipsXml] = await Promise.all([
        presentationFile.async("text"),
        relationshipsFile.async("text")
      ]);
      const relationshipOrderedSlides = getRelationshipOrderedPptxSlides(files, presentationXml, relationshipsXml);
      if (relationshipOrderedSlides) return relationshipOrderedSlides;
    } catch {
      // Fall back to filename sorting when presentation metadata cannot be read or parsed.
    }
  }
  return getFilenameSortedPptxSlides(files);
}

function extractPptxSlideText(xml: string): string[] {
  const textNodes: string[] = [];
  const textNodePattern = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
  let match = textNodePattern.exec(xml);
  while (match) {
    textNodes.push(decodeCommonXmlEntities(match[1]));
    match = textNodePattern.exec(xml);
  }
  return textNodes;
}

function getPptxSlideRelationshipsPath(slidePath: string): string {
  const lastSlash = slidePath.lastIndexOf("/");
  const slideDirectory = slidePath.slice(0, lastSlash);
  const slideFilename = slidePath.slice(lastSlash + 1);
  return `${slideDirectory}/_rels/${slideFilename}.rels`;
}

function getPptxImageMimeType(path: string): string | undefined {
  const extension = getLowercaseExtension(path);
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".gif") return "image/gif";
  if (extension === ".webp") return "image/webp";
  return undefined;
}

async function getPptxSlideImagePaths(files: PptxArchiveFiles, slidePath: string): Promise<string[]> {
  const relationshipsFile = files[getPptxSlideRelationshipsPath(slidePath)];
  if (!relationshipsFile) return [];

  const relationshipsXml = await relationshipsFile.async("text");
  const imagePaths: string[] = [];
  const relationshipPattern = /<Relationship\b[^>]*>/g;
  let match = relationshipPattern.exec(relationshipsXml);
  while (match) {
    const attributes = parseXmlAttributes(match[0]);
    if (!attributes.Type?.endsWith("/image") || !attributes.Target) {
      match = relationshipPattern.exec(relationshipsXml);
      continue;
    }

    const imagePath = resolvePptxSlideRelationshipTarget(slidePath, attributes.Target);
    if (files[imagePath] && getPptxImageMimeType(imagePath)) imagePaths.push(imagePath);
    match = relationshipPattern.exec(relationshipsXml);
  }
  return imagePaths;
}

async function extractPptxSlideImageText(
  files: PptxArchiveFiles,
  slidePath: string,
  slideNumber: number,
  deckPath: string,
  imageOcrProvider?: ImageOcrProvider
): Promise<string[]> {
  if (!imageOcrProvider) return [];

  const imagePaths = await getPptxSlideImagePaths(files, slidePath);
  const texts: string[] = [];
  for (let imageIndex = 0; imageIndex < imagePaths.length; imageIndex++) {
    const imagePath = imagePaths[imageIndex];
    const imageFile = files[imagePath];
    const mimeType = getPptxImageMimeType(imagePath);
    if (!imageFile || !mimeType) continue;

    const imageDataUrl = `data:${mimeType};base64,${await imageFile.async("base64")}`;
    const text = (await imageOcrProvider({
      path: `${deckPath}#slide-${slideNumber}-image-${imageIndex + 1}`,
      imageDataUrl
    })).trim();
    if (text) texts.push(text);
  }
  return texts;
}

const pptxParser: RawParser = {
  supports(path: string): boolean {
    return isPptxRawPath(path);
  },
  async read(app: App, file: TFile, context: RawParserContext): Promise<string> {
    const buffer = await app.vault.readBinary(file);
    const archive = await JSZip.loadAsync(buffer);
    const slides = await getPptxSlides(archive.files);

    const slideText = await Promise.all(slides.map(async ({ path }, index) => {
      const slideFile = archive.files[path];
      if (!slideFile) return "";
      const slideNumber = index + 1;
      const xml = await slideFile.async("text");
      const textNodes = extractPptxSlideText(xml);
      const readableText = textNodes.filter((text) => text.trim().length > 0);
      if (readableText.length > 0) return [`# Slide ${slideNumber}`, ...textNodes].join("\n");

      const imageText = await extractPptxSlideImageText(archive.files, path, slideNumber, file.path, context.imageOcrProvider);
      if (imageText.length === 0) return "";
      return [`# Slide ${slideNumber}`, ...imageText].join("\n");
    }));
    return requireOfficeText(slideText.filter((slide) => slide.trim().length > 0).join("\n\n"), file.path);
  }
};

const textParser: RawParser = {
  supports(path: string): boolean {
    return TEXT_EXTENSIONS.has(getLowercaseExtension(path));
  },
  async read(app: App, file: TFile): Promise<string> {
    return app.vault.read(file);
  }
};

export function isPdfRawPath(path: string): boolean {
  return getLowercaseExtension(path) === ".pdf";
}

const pdfParser: RawParser = {
  supports(path: string): boolean {
    return isPdfRawPath(path);
  },
  async read(app: App, file: TFile, context: RawParserContext): Promise<string> {
    context.onPdfExtract?.(file.path);
    const pdfJs = await loadPdfJs() as PdfJs;
    const data = new Uint8Array(await app.vault.readBinary(file));
    const document = await pdfJs.getDocument({ data }).promise;
    const pages: string[] = new Array(document.numPages);
    const ocrPages: Array<{ pageNumber: number; page: PdfPage }> = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item) => item.str ?? "").join(" ").trim();
      if (pageText) {
        pages[pageNumber - 1] = pageText;
      } else if (context.pdfOcrProvider) {
        ocrPages.push({ pageNumber, page });
      } else {
        pages[pageNumber - 1] = "";
      }
    }
    if (ocrPages.length > 0 && context.pdfOcrProvider) {
      const concurrency = Math.max(1, context.ocrPageConcurrency ?? 1);
      const ocrProvider = context.pdfOcrProvider;
      const ocrResults = await mapWithConcurrency(ocrPages, concurrency, async ({ pageNumber, page }) => {
        const ocrText = (await ocrProvider({ page, path: file.path, pageNumber })).trim();
        return { pageNumber, text: ocrText };
      });
      for (const { pageNumber, text } of ocrResults) {
        pages[pageNumber - 1] = text;
      }
    }
    const text = pages.filter((p) => p).join("\n\n");
    if (!text) throw new Error(t("error.noExtractablePdfText", { path: file.path }));
    return text;
  }
};

const IMAGE_MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"]
]);

function getImageMimeType(path: string): string | undefined {
  return IMAGE_MIME_BY_EXTENSION.get(getLowercaseExtension(path));
}

export function isImageRawPath(path: string): boolean {
  return getImageMimeType(path) !== undefined;
}

const BASE64_CHUNK_SIZE = 32766;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoded = "";
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    const end = Math.min(offset + BASE64_CHUNK_SIZE, bytes.length);
    let binary = "";
    for (let index = offset; index < end; index++) {
      binary += String.fromCharCode(bytes[index]);
    }
    encoded += btoa(binary);
  }
  return encoded;
}

const imageParser: RawParser = {
  supports(path: string): boolean {
    return isImageRawPath(path);
  },
  async read(app: App, file: TFile, context: RawParserContext): Promise<string> {
    if (!context.imageOcrProvider) throw new Error(t("error.imageOcrProviderMissing", { path: file.path }));
    const mimeType = getImageMimeType(file.path);
    if (!mimeType) return "";
    const imageBuffer = await app.vault.readBinary(file);
    const imageDataUrl = `data:${mimeType};base64,${arrayBufferToBase64(imageBuffer)}`;
    const text = (await context.imageOcrProvider({ path: file.path, imageDataUrl })).trim();
    if (!text) throw new Error(t("error.imageOcrEmpty", { path: file.path }));
    return text;
  }
};

const rawParsers: RawParser[] = [htmlParser, docxParser, docParser, xlsxParser, rtfParser, pptParser, pptxParser, textParser, pdfParser, imageParser];

export function getRawParser(path: string): RawParser | undefined {
  return rawParsers.find((parser) => parser.supports(path));
}

export function isSupportedRawPath(path: string): boolean {
  return getRawParser(path) !== undefined;
}

export async function readRawFileWithParser(app: App, file: TFile, context: RawParserContext = {}): Promise<string> {
  const parser = getRawParser(file.path);
  if (!parser) return "";
  try {
    return await parser.read(app, file, context);
  } catch (error) {
    const message = getErrorMessage(error);
    if (isRawParseFailedMessage(message, file.path)) throw error;
    throw new Error(t("error.rawParseFailed", { path: file.path, message }));
  }
}
