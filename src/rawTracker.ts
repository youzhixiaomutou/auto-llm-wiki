import * as JSZip from "jszip";
import { App, TFile } from "obsidian";
import { LLMWikiSettings, RawFileState, RawFileStateEntry } from "./types";
import { normalizePath } from "./changePlan";
import { t } from "./i18n";
import { isBinaryOfficeRawPath, isImageRawPath, isOpenXmlRawPath, isPdfRawPath, isSupportedRawPath, readRawFileWithParser } from "./rawParsers";
import type { ImageOcrProvider, PdfOcrProvider, PdfPage } from "./rawParsers";

export interface ChangedRawFile {
  path: string;
  content: string;
  hash: string;
  mtime?: number;
  size?: number;
}

export type { ImageOcrProvider, ImageOcrRequest, PdfOcrProvider, PdfOcrRequest } from "./rawParsers";

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

export type { RawFileState, RawFileStateEntry } from "./types";

type StoredRawFileEntry = string | RawFileStateEntry;

function normalizeRawFileEntry(entry: StoredRawFileEntry | undefined): RawFileStateEntry | undefined {
  if (entry === undefined) return undefined;
  if (typeof entry === "string") return { hash: entry, mtime: -1, size: -1 };
  return { hash: entry.hash, mtime: entry.mtime ?? -1, size: entry.size ?? -1 };
}

export function migrateRawFileState(state: Record<string, StoredRawFileEntry> | undefined): RawFileState {
  const migrated: RawFileState = {};
  if (!state) return migrated;
  for (const [path, entry] of Object.entries(state)) {
    const normalized = normalizeRawFileEntry(entry);
    if (normalized) migrated[path] = normalized;
  }
  return migrated;
}

interface RawCandidateFile {
  path: string;
}

interface RawFileStat {
  mtime: number;
  size: number;
}

function readRawFileStat(file: RawCandidateFile): RawFileStat | undefined {
  const stat = (file as { stat?: { mtime?: unknown; size?: unknown } }).stat;
  if (!stat || typeof stat.mtime !== "number" || typeof stat.size !== "number") return undefined;
  return { mtime: stat.mtime, size: stat.size };
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

export function hashBinaryContent(buffer: ArrayBuffer): string {
  let hash = 2166136261;
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const OPEN_XML_IGNORED_PREFIXES = ["docProps/"];

function isIgnoredOpenXmlEntry(path: string): boolean {
  return OPEN_XML_IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function hashOpenXmlContent(buffer: ArrayBuffer): Promise<string> {
  const archive = await JSZip.loadAsync(buffer);
  const parts: string[] = [];
  for (const path of Object.keys(archive.files).sort()) {
    const file = archive.files[path];
    if (!file || file.dir || isIgnoredOpenXmlEntry(path)) continue;
    parts.push(path, await file.async("base64"));
  }
  return hashContent(parts.join("\0"));
}

export function findRawFileCandidates<T extends RawCandidateFile>(files: T[], settings: LLMWikiSettings): RawFileCandidates<T> {
  const rawFolder = normalizePath(settings.rawFolder);
  const sourceFiles = files.filter((file) => file.path.startsWith(`${rawFolder}/`) && isSupportedRawPath(file.path));
  return {
    sourceFiles,
    pdfPaths: sourceFiles.filter((file) => isPdfRawPath(file.path)).map((file) => file.path)
  };
}

export interface RawScanResult {
  /** Files whose content changed and should be ingested. */
  changed: ChangedRawFile[];
  /** Files confirmed unchanged whose recorded mtime/size drifted and should be refreshed. */
  stamps: RawFileState;
}

export async function findChangedRawFiles(
  app: App,
  settings: LLMWikiSettings,
  state: Record<string, StoredRawFileEntry>,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider,
  imageOcrProvider?: ImageOcrProvider
): Promise<RawScanResult> {
  const rawFiles = findRawFileCandidates(app.vault.getFiles(), settings).sourceFiles;

  const changedFiles: ChangedRawFile[] = [];
  const stamps: RawFileState = {};
  for (const file of rawFiles) {
    const stat = readRawFileStat(file);
    const recorded = normalizeRawFileEntry(state[file.path]);
    // Fast-path: unchanged mtime+size means unchanged content, so skip read/hash entirely.
    // Limitation: a content change that preserves BOTH mtime and size (e.g. an in-place
    // same-length edit, or a sync tool run with --times) is not detected here.
    if (recorded && stat && recorded.mtime === stat.mtime && recorded.size === stat.size) {
      continue;
    }

    // Content is confirmed unchanged but stat drifted (or was legacy/absent): refresh the
    // recorded mtime/size so the fast-path can engage next scan instead of re-hashing forever.
    const restamp = (hash: string) => {
      if (stat) stamps[file.path] = { hash, mtime: stat.mtime, size: stat.size };
    };

    if (isOpenXmlRawPath(file.path)) {
      const binaryBuffer = await app.vault.readBinary(file as TFile);
      const hash = await hashOpenXmlContent(binaryBuffer);
      if (recorded?.hash === hash) { restamp(hash); continue; }
      const content = await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider);
      changedFiles.push({ path: file.path, content, hash, mtime: stat?.mtime, size: stat?.size });
      continue;
    }

    if (isImageRawPath(file.path) || isPdfRawPath(file.path) || isBinaryOfficeRawPath(file.path)) {
      const binaryBuffer = await app.vault.readBinary(file as TFile);
      const hash = hashBinaryContent(binaryBuffer);
      if (recorded?.hash === hash) { restamp(hash); continue; }
      const content = await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider);
      changedFiles.push({ path: file.path, content, hash, mtime: stat?.mtime, size: stat?.size });
      continue;
    }

    const content = await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider);
    const hash = hashContent(content);
    if (recorded?.hash !== hash) {
      changedFiles.push({ path: file.path, content, hash, mtime: stat?.mtime, size: stat?.size });
    } else {
      restamp(hash);
    }
  }
  return { changed: changedFiles, stamps };
}

async function readRawFileContent(
  app: App,
  file: TFile,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider,
  imageOcrProvider?: ImageOcrProvider
): Promise<string> {
  return readRawFileWithParser(app, file, { onPdfExtract, pdfOcrProvider, imageOcrProvider });
}

export function updateRawFileState(state: RawFileState, files: ChangedRawFile[]): RawFileState {
  const nextState = { ...state };
  for (const file of files) {
    nextState[file.path] = { hash: file.hash, mtime: file.mtime ?? -1, size: file.size ?? -1 };
  }
  return nextState;
}
