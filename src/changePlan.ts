import { t } from "./i18n";
import { ChangePlan, FileOperation, LLMWikiSettings } from "./types";

const ALLOWED_KINDS = new Set(["create", "update", "append"]);

export function parseChangePlan(text: string): ChangePlan {
  const json = stripFences(text.trim());
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed) || typeof parsed.summary !== "string" || !Array.isArray(parsed.operations)) {
    throw new Error(t("error.invalidChangePlanShape"));
  }
  const operations = parsed.operations.map(assertOperationShape);
  return { summary: parsed.summary, operations };
}

export function validateChangePlan(plan: ChangePlan, settings: LLMWikiSettings): ChangePlan {
  validateSettingsPaths(settings);
  for (const operation of plan.operations) {
    const normalized = normalizePath(operation.path);
    if (normalized !== operation.path) {
      throw new Error(t("error.unsafePath", { path: operation.path }));
    }
    if (!isAllowedWritePath(normalized, settings)) {
      throw new Error(t("error.pathOutsideWiki", { path: operation.path }));
    }
    if (isReadOnlyPath(normalized, settings)) {
      throw new Error(t("error.pathInsideReadOnly", { path: operation.path }));
    }
  }
  return plan;
}

export function normalizePath(path: string): string {
  if (path.startsWith("/") || path.includes("\\")) {
    throw new Error(t("error.unsafePath", { path }));
  }
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error(t("error.unsafePath", { path }));
    parts.push(part);
  }
  return parts.join("/");
}

function stripFences(text: string): string {
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1] : text;
}

function assertOperationShape(operation: unknown): FileOperation {
  if (!isRecord(operation) || typeof operation.kind !== "string" || !ALLOWED_KINDS.has(operation.kind)) {
    throw new Error(t("error.invalidOperationKind"));
  }
  if (typeof operation.path !== "string") throw new Error(t("error.invalidOperationPath"));
  if (typeof operation.content !== "string") throw new Error(t("error.invalidOperationContent"));
  if (typeof operation.rationale !== "string") throw new Error(t("error.invalidOperationRationale"));
  return {
    kind: operation.kind as FileOperation["kind"],
    path: operation.path,
    content: operation.content,
    rationale: operation.rationale
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateSettingsPaths(settings: LLMWikiSettings): void {
  const wikiFolder = normalizePath(settings.wikiFolder);
  const indexPath = normalizePath(settings.indexPath);
  const logPath = normalizePath(settings.logPath);

  if (!isInsideFolder(indexPath, wikiFolder)) {
    throw new Error(t("error.indexOutsideWiki"));
  }
  if (!isInsideFolder(logPath, wikiFolder)) {
    throw new Error(t("error.logOutsideWiki"));
  }
}

function isAllowedWritePath(path: string, settings: LLMWikiSettings): boolean {
  const wikiFolder = normalizePath(settings.wikiFolder);
  return isInsideFolder(path, wikiFolder);
}

function isReadOnlyPath(path: string, settings: LLMWikiSettings): boolean {
  return isInsideFolder(path, normalizePath(settings.rawFolder)) ||
    isInsideFolder(path, normalizePath(settings.assetsFolder));
}

function isInsideFolder(path: string, folder: string): boolean {
  return path.startsWith(`${folder}/`);
}
