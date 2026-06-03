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

export async function applyChangePlan(app: App, plan: ChangePlan): Promise<void> {
  for (const operation of plan.operations) {
    await applyOperation(app, operation);
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
