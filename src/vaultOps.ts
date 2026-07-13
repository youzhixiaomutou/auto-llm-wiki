import { App, TFile } from "obsidian";
import { ChangePlan, FileOperation, LLMWikiSettings } from "./types";
import { normalizePath } from "./changePlan";
import { t } from "./i18n";

export function isRawPath(path: string, settings: LLMWikiSettings): boolean {
  const rawFolder = normalizePath(settings.rawFolder);
  return normalizePath(path).startsWith(`${rawFolder}/`);
}

export function ensureMarkdownPath(path: string): string {
  const normalized = normalizePath(path);
  if (!normalized.endsWith(".md")) {
    throw new Error(t("error.markdownExtensionRequired"));
  }
  return normalized;
}

// Prefer Obsidian's cached reader for read-only access: it serves recently-read content from an
// in-memory cache and invalidates it on change, so repeated reads across chat turns avoid disk
// without any custom cache. Falls back to read() for stubs/older builds without cachedRead.
function readVaultFile(app: App, file: TFile): Promise<string> {
  return app.vault.cachedRead ? app.vault.cachedRead(file) : app.vault.read(file);
}

export async function readTextFile(app: App, path: string): Promise<string> {
  const normalized = ensureMarkdownPath(path);
  const file = app.vault.getAbstractFileByPath(normalized);
  if (file instanceof TFile) return readVaultFile(app, file);
  return "";
}

export async function listMarkdownFiles(app: App, folder: string): Promise<Array<{ path: string; content: string }>> {
  const normalizedFolder = normalizePath(folder);
  const files = app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalizedFolder}/`));
  const pages = [];
  for (const file of files) {
    pages.push({ path: file.path, content: await readVaultFile(app, file) });
  }
  return pages;
}

export function listMarkdownFilePaths(app: App, folder: string): string[] {
  const normalizedFolder = normalizePath(folder);
  return app.vault.getMarkdownFiles()
    .filter((file) => file.path.startsWith(`${normalizedFolder}/`))
    .map((file) => file.path);
}

export async function readWikiPages(app: App, paths: string[]): Promise<Array<{ path: string; content: string }>> {
  // Read pages concurrently; keep input order and skip paths that are not existing files.
  const pages = await Promise.all(paths.map(async (path) => {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return undefined;
    return { path, content: await readVaultFile(app, file) };
  }));
  return pages.filter((page): page is { path: string; content: string } => page !== undefined);
}

export async function applyChangePlan(app: App, plan: ChangePlan): Promise<void> {
  preValidatePlan(app, plan);
  const snapshots = await snapshotAffectedFiles(app, plan);
  try {
    for (const operation of plan.operations) {
      await applyOperation(app, operation);
    }
  } catch (error) {
    await rollback(app, snapshots);
    throw error;
  }
}

// Reject the whole plan before any write when an operation is bound to fail, so a plan
// is never applied halfway.
function preValidatePlan(app: App, plan: ChangePlan): void {
  // Normalize each path once, then classify into delete vs write targets.
  const entries = plan.operations.map((operation) => ({ operation, path: ensureMarkdownPath(operation.path) }));
  const deletePaths = new Set<string>();
  const writePaths = new Set<string>();
  for (const { operation, path } of entries) {
    (operation.kind === "delete" ? deletePaths : writePaths).add(path);
  }
  for (const { operation, path } of entries) {
    // A path can't be both deleted and written in one plan: the intended order is ambiguous
    // and only half of the self-cancelling plan would apply.
    if (deletePaths.has(path) && writePaths.has(path)) {
      throw new Error(t("error.conflictingOperations", { path }));
    }
    const existing = app.vault.getAbstractFileByPath(path);
    if (operation.kind === "create") {
      if (existing) throw new Error(t("error.fileAlreadyExists", { path }));
    } else if (operation.kind === "delete") {
      // Reject deleting a path that isn't a current file (missing or a folder) so a
      // hallucinated or stale path surfaces instead of silently no-opping.
      if (!existing) throw new Error(t("error.cannotDeleteMissingFile", { path }));
      if (!(existing instanceof TFile)) throw new Error(t("error.pathIsFolder", { path }));
    } else if (existing && !(existing instanceof TFile)) {
      throw new Error(t("error.pathIsFolder", { path }));
    }
  }
}

interface FileSnapshot {
  path: string;
  existed: boolean;
  content: string | null;
}

async function snapshotAffectedFiles(app: App, plan: ChangePlan): Promise<FileSnapshot[]> {
  const snapshots: FileSnapshot[] = [];
  const seen = new Set<string>();
  for (const operation of plan.operations) {
    const path = ensureMarkdownPath(operation.path);
    if (seen.has(path)) continue;
    seen.add(path);
    const existing = app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      snapshots.push({ path, existed: true, content: await app.vault.read(existing) });
    } else {
      snapshots.push({ path, existed: false, content: null });
    }
  }
  return snapshots;
}

// Best-effort restore to the pre-apply state: delete files that were newly created, recreate
// files that were deleted, and restore the original content of files that were modified. Keep
// going if one restore fails.
async function rollback(app: App, snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    try {
      const existing = app.vault.getAbstractFileByPath(snapshot.path);
      if (snapshot.existed) {
        if (existing instanceof TFile && snapshot.content !== null) {
          await app.vault.modify(existing, snapshot.content);
        } else if (!existing && snapshot.content !== null) {
          await ensureParentFolders(app, snapshot.path);
          await app.vault.create(snapshot.path, snapshot.content);
        }
      } else if (existing instanceof TFile) {
        await app.vault.delete(existing);
      }
    } catch {
      // Ignore individual rollback failures; restore as much as possible.
    }
  }
}

async function applyOperation(app: App, operation: FileOperation): Promise<void> {
  const path = ensureMarkdownPath(operation.path);
  if (operation.kind === "delete") {
    const target = app.vault.getAbstractFileByPath(path);
    if (target instanceof TFile) await app.vault.delete(target);
    return;
  }
  await ensureParentFolders(app, path);
  const existing = app.vault.getAbstractFileByPath(path);
  if (operation.kind === "create") {
    if (existing) throw new Error(t("error.fileAlreadyExists", { path }));
    await app.vault.create(path, operation.content);
    return;
  }
  if (existing instanceof TFile) {
    if (operation.kind === "append") {
      const current = await app.vault.read(existing);
      await app.vault.modify(existing, `${current}\n${operation.content}`);
      return;
    }
    if (operation.kind === "prepend") {
      const current = await app.vault.read(existing);
      const separator = current.trim().length > 0 ? "\n\n" : "";
      await app.vault.modify(existing, `${operation.content}${separator}${current}`);
      return;
    }
    await app.vault.modify(existing, operation.content);
    return;
  }
  await app.vault.create(path, operation.content);
}

async function ensureParentFolders(app: App, path: string): Promise<void> {
  const parts = path.split("/").slice(0, -1);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}
