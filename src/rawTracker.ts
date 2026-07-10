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

// 64-bit digest from two independent 32-bit hashes (FNV-1a + djb2), concatenated as 16 hex
// chars. Wider than a single 32-bit hash so a content change cannot silently collide with the
// recorded hash and be skipped. Avoids BigInt to stay within the ES2018 build target.
function hash64(length: number, byteAt: (index: number) => number): string {
  let fnv = 2166136261;
  let djb = 5381;
  for (let index = 0; index < length; index++) {
    const value = byteAt(index);
    fnv = Math.imul(fnv ^ value, 16777619);
    djb = (Math.imul(djb, 33) + value) >>> 0;
  }
  return (fnv >>> 0).toString(16).padStart(8, "0") + (djb >>> 0).toString(16).padStart(8, "0");
}

export function hashContent(content: string): string {
  return hash64(content.length, (index) => content.charCodeAt(index));
}

// A legacy 8-char hash (a single 32-bit FNV-1a digest) is exactly the first 8 hex chars of the
// current 16-char hash, so a recorded legacy hash that prefixes the new hash means the content
// is unchanged — restamp with the wider hash rather than re-ingesting on the format upgrade.
function hashMatchesRecorded(recorded: string, current: string): boolean {
  return recorded === current || (recorded.length === 8 && current.startsWith(recorded));
}

export function hashBinaryContent(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return hash64(bytes.length, (index) => bytes[index]);
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
  /** Files that could not be read/parsed this scan; isolated so they do not abort the rest. */
  failed: Array<{ path: string; message: string }>;
}

// Discriminated union: a per-file scan either produced a result or failed with a message.
// Modeling it this way makes "no scan and no error" unrepresentable.
type RawFileScanOutcome =
  | { path: string; scan: RawFileScan }
  | { path: string; error: string };

const RAW_SCAN_CONCURRENCY = 4;

interface RawFileScan {
  changed?: ChangedRawFile;
  stamp?: RawFileStateEntry;
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

async function scanRawFile(
  app: App,
  file: RawCandidateFile,
  state: Record<string, StoredRawFileEntry>,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider,
  imageOcrProvider?: ImageOcrProvider,
  ocrPageConcurrency?: number
): Promise<RawFileScan> {
  const stat = readRawFileStat(file);
  const recorded = normalizeRawFileEntry(state[file.path]);
  // Fast-path: unchanged mtime+size means unchanged content, so skip read/hash entirely.
  // Limitation: a content change that preserves BOTH mtime and size (e.g. an in-place
  // same-length edit, or a sync tool run with --times) is not detected here.
  if (recorded && stat && recorded.mtime === stat.mtime && recorded.size === stat.size) {
    return {};
  }

  // Content is confirmed unchanged but stat drifted (or was legacy/absent): refresh the
  // recorded mtime/size so the fast-path can engage next scan instead of re-hashing forever.
  const restamp = (hash: string): RawFileScan => (stat ? { stamp: { hash, mtime: stat.mtime, size: stat.size } } : {});
  const changed = (content: string, hash: string): RawFileScan => ({
    changed: { path: file.path, content, hash, mtime: stat?.mtime, size: stat?.size }
  });

  const matchesRecorded = (hash: string): boolean => !!recorded && hashMatchesRecorded(recorded.hash, hash);

  if (isOpenXmlRawPath(file.path)) {
    const binaryBuffer = await app.vault.readBinary(file as TFile);
    const hash = await hashOpenXmlContent(binaryBuffer);
    if (matchesRecorded(hash)) return restamp(hash);
    return changed(await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider, ocrPageConcurrency), hash);
  }

  if (isImageRawPath(file.path) || isPdfRawPath(file.path) || isBinaryOfficeRawPath(file.path)) {
    const binaryBuffer = await app.vault.readBinary(file as TFile);
    const hash = hashBinaryContent(binaryBuffer);
    if (matchesRecorded(hash)) return restamp(hash);
    return changed(await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider, ocrPageConcurrency), hash);
  }

  const content = await readRawFileContent(app, file as TFile, onPdfExtract, pdfOcrProvider, imageOcrProvider, ocrPageConcurrency);
  const hash = hashContent(content);
  return matchesRecorded(hash) ? restamp(hash) : changed(content, hash);
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
  const ocrPageConcurrency = settings.ocrPageConcurrency;
  // Isolate per-file failures: one corrupt/unreadable file (or a failed OCR call) must not
  // abort the whole scan or discard siblings' results.
  const outcomes = await mapWithConcurrency<RawCandidateFile, RawFileScanOutcome>(rawFiles, RAW_SCAN_CONCURRENCY, async (file) => {
    try {
      return { path: file.path, scan: await scanRawFile(app, file, state, onPdfExtract, pdfOcrProvider, imageOcrProvider, ocrPageConcurrency) };
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Name the file exactly once: parser/OCR errors already embed the path (rawParseFailed);
      // lower-level errors (readBinary, JSZip) do not, so prepend it only when missing.
      const message = raw.includes(file.path) ? raw : `${file.path}: ${raw}`;
      return { path: file.path, error: message };
    }
  });

  const changedFiles: ChangedRawFile[] = [];
  const stamps: RawFileState = {};
  const failed: Array<{ path: string; message: string }> = [];
  for (const outcome of outcomes) {
    if ("error" in outcome) {
      failed.push({ path: outcome.path, message: outcome.error });
      continue;
    }
    if (outcome.scan.changed) changedFiles.push(outcome.scan.changed);
    if (outcome.scan.stamp) stamps[outcome.path] = outcome.scan.stamp;
  }
  return { changed: changedFiles, stamps, failed };
}

async function readRawFileContent(
  app: App,
  file: TFile,
  onPdfExtract?: (path: string) => void,
  pdfOcrProvider?: PdfOcrProvider,
  imageOcrProvider?: ImageOcrProvider,
  ocrPageConcurrency?: number
): Promise<string> {
  return readRawFileWithParser(app, file, { onPdfExtract, pdfOcrProvider, imageOcrProvider, ocrPageConcurrency });
}

export function updateRawFileState(state: RawFileState, files: ChangedRawFile[]): RawFileState {
  const nextState = { ...state };
  for (const file of files) {
    nextState[file.path] = { hash: file.hash, mtime: file.mtime ?? -1, size: file.size ?? -1 };
  }
  return nextState;
}
