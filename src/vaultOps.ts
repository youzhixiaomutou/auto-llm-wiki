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

export async function readTextFile(app: App, path: string): Promise<string> {
  const normalized = ensureMarkdownPath(path);
  const file = app.vault.getAbstractFileByPath(normalized);
  if (file instanceof TFile) return app.vault.read(file);
  return "";
}

export async function listMarkdownFiles(app: App, folder: string): Promise<Array<{ path: string; content: string }>> {
  const normalizedFolder = normalizePath(folder);
  const files = app.vault.getMarkdownFiles().filter((file) => file.path.startsWith(`${normalizedFolder}/`));
  const pages = [];
  for (const file of files) {
    pages.push({ path: file.path, content: await app.vault.read(file) });
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
  const pages: Array<{ path: string; content: string }> = [];
  for (const path of paths) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      pages.push({ path, content: await app.vault.read(file) });
    }
  }
  return pages;
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
  for (const operation of plan.operations) {
    const path = ensureMarkdownPath(operation.path);
    const existing = app.vault.getAbstractFileByPath(path);
    if (operation.kind === "create") {
      if (existing) throw new Error(t("error.fileAlreadyExists", { path }));
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

// Best-effort restore to the pre-apply state: delete files that were newly created and
// restore the original content of files that were modified. Keep going if one restore fails.
async function rollback(app: App, snapshots: FileSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    try {
      const existing = app.vault.getAbstractFileByPath(snapshot.path);
      if (snapshot.existed) {
        if (existing instanceof TFile && snapshot.content !== null) {
          await app.vault.modify(existing, snapshot.content);
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
