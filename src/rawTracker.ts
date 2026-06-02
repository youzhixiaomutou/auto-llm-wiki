import { App, loadPdfJs, TFile } from "obsidian";
import { LLMWikiSettings } from "./types";
import { normalizePath } from "./changePlan";
import { t } from "./i18n";

export interface ChangedRawFile {
  path: string;
  content: string;
  hash: string;
}

interface PdfTextItem {
  str?: string;
}

interface PdfViewport {
  width: number;
  height: number;
}

interface PdfPage {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
  getViewport(options: { scale: number }): PdfViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }): { promise: Promise<void> };
}

export interface PdfOcrRequest {
  page: PdfPage;
  path: string;
  pageNumber: number;
}

export async function renderPdfPageToPngDataUrl(page: PdfPage, scale = 2): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("error.renderPdfPageForOcr"));
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/png");
}

export type PdfOcrProvider = (request: PdfOcrRequest) => Promise<string>;

interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
}

interface PdfJs {
  getDocument(data: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

export type RawFileState = Record<string, string>;

interface RawCandidateFile {
  path: string;
}

export interface RawFileCandidates<T extends RawCandidateFile = RawCandidateFile> {
  sourceFiles: T[];
  pdfPaths: string[];
}

export function hashContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index++) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function findRawFileCandidates<T extends RawCandidateFile>(files: T[], settings: LLMWikiSettings): RawFileCandidates<T> {
  const rawFolder = normalizePath(settings.rawFolder);
  const sourceFiles = files.filter((file) => file.path.startsWith(`${rawFolder}/`) && isSupportedRawFile(file.path));
  return {
    sourceFiles,
    pdfPaths: sourceFiles.filter((file) => isPdfPath(file.path)).map((file) => file.path)
  };
}

export async function findChangedRawFiles(
  app: App,
  settings: LLMWikiSettings,
  state: RawFileState,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider
): Promise<ChangedRawFile[]> {
  const rawFiles = findRawFileCandidates(app.vault.getFiles(), settings).sourceFiles;

  const changedFiles: ChangedRawFile[] = [];
  for (const file of rawFiles) {
    const content = await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider);
    const hash = hashContent(content);
    if (state[file.path] !== hash) {
      changedFiles.push({ path: file.path, content, hash });
    }
  }
  return changedFiles;
}

function isSupportedRawFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith(".md") || lowerPath.endsWith(".pdf");
}

function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith(".pdf");
}

async function readRawFileContent(
  app: App,
  file: TFile,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider
): Promise<string> {
  if (isPdfPath(file.path)) {
    onPdfExtract?.(file.path);
    return readPdfText(app, file, pdfOcrProvider);
  }
  return app.vault.read(file);
}

async function readPdfText(app: App, file: TFile, pdfOcrProvider?: PdfOcrProvider): Promise<string> {
  const pdfJs = await loadPdfJs() as PdfJs;
  const data = new Uint8Array(await app.vault.readBinary(file));
  const document = await pdfJs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item) => item.str ?? "").join(" ").trim();
    if (pageText) {
      pages.push(pageText);
    } else if (pdfOcrProvider) {
      const ocrText = (await pdfOcrProvider({ page, path: file.path, pageNumber })).trim();
      if (ocrText) pages.push(ocrText);
    }
  }
  const text = pages.join("\n\n");
  if (!text) throw new Error(t("error.noExtractablePdfText", { path: file.path }));
  return text;
}

export function updateRawFileState(state: RawFileState, files: ChangedRawFile[]): RawFileState {
  const nextState = { ...state };
  for (const file of files) {
    nextState[file.path] = file.hash;
  }
  return nextState;
}
