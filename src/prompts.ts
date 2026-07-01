import { t, getOutputLanguageName } from "./i18n";
import { DEFAULT_SETTINGS } from "./settings";
import { LLMWikiSettings, WikiContext } from "./types";

function outputLanguageInstruction(): string {
  return t("prompt.outputLanguageInstruction", { language: getOutputLanguageName() });
}

function buildJsonContract(settings: LLMWikiSettings): string {
  return `Return only JSON with this shape:
{
  "summary": "short human-readable summary",
  "operations": [
    { "kind": "create", "path": "${settings.wikiFolder}/example.md", "content": "markdown", "rationale": "why this file changes" },
    { "kind": "update", "path": "${settings.indexPath}", "content": "full replacement markdown", "rationale": "why this file changes" },
    { "kind": "prepend", "path": "${settings.logPath}", "content": "newest-first markdown log entry", "rationale": "why this file changes" }
  ]
}
Use only create, update, append, or prepend. Write only inside ${settings.wikiFolder}/. Use ${settings.indexPath} for the content index and ${settings.logPath} for the newest-first chronological log. Use prepend for new entries in ${settings.logPath}. Treat ${settings.rawFolder}/ and ${settings.assetsFolder}/ as read-only.`;
}

export function buildIngestPrompt(context: WikiContext, settings: LLMWikiSettings = DEFAULT_SETTINGS): string {
  return `You maintain a persistent LLM Wiki in Obsidian. Raw sources are immutable. Integrate the source into the wiki by creating or updating markdown pages, refreshing the configured index, and prepending a newest-first entry to the configured log.

${outputLanguageInstruction()}

${buildJsonContract(settings)}

Current index:
${context.index}

Current log:
${context.log}

Changed raw sources:
${formatSources(context)}`;
}

export function buildQueryPrompt(context: WikiContext, settings: LLMWikiSettings = DEFAULT_SETTINGS): string {
  return `You answer questions using the persistent LLM Wiki. Provide an answer as an optional wiki page if the answer should compound into the knowledge base.

${outputLanguageInstruction()}

${buildJsonContract(settings)}

Question: ${context.question}

Current index:
${context.index}

Relevant wiki pages:
${formatWikiPages(context.wikiPages ?? [])}`;
}

export function buildQuerySelectionPrompt(
  context: { index: string; question: string; pagePaths: string[] },
  settings: LLMWikiSettings = DEFAULT_SETTINGS
): string {
  return `You are selecting which wiki pages are most relevant to a question. Choose only from the provided page paths.

Question: ${context.question}

Current index:
${context.index}

Available page paths:
${context.pagePaths.join("\n")}

Return only a JSON array of the most relevant page paths (fewer is better), for example ["${settings.wikiFolder}/example.md"]. Do not include any other text.`;
}

export function parseSelectedQueryPages(response: string, availablePaths: string[], limit: number): string[] {
  const available = new Set(availablePaths);
  const parsed = extractJsonArray(response);
  const selected = Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string" && available.has(value))
    : [];
  const deduped = Array.from(new Set(selected));
  return deduped.length > 0 ? deduped.slice(0, limit) : availablePaths.slice(0, limit);
}

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return undefined;
    try {
      return JSON.parse(match[0]);
    } catch {
      return undefined;
    }
  }
}

export function buildLintPrompt(context: WikiContext, settings: LLMWikiSettings = DEFAULT_SETTINGS): string {
  return `You lint a persistent LLM Wiki. Look for contradictions, stale claims, orphan pages, missing cross-references, important concepts without pages, and data gaps. Save the report as a wiki markdown page if useful.

${outputLanguageInstruction()}

${buildJsonContract(settings)}

Current index:
${context.index}

Current log:
${context.log}

Wiki pages:
${formatWikiPages(context.wikiPages ?? [])}`;
}

function formatWikiPages(pages: Array<{ path: string; content: string }>): string {
  return pages.map((page) => `---
Path: ${page.path}
${page.content}`).join("\n");
}

function formatSources(context: WikiContext): string {
  const sources = context.sources ?? (
    context.sourcePath && context.sourceContent !== undefined
      ? [{ path: context.sourcePath, content: context.sourceContent }]
      : []
  );
  return sources.map((source) => `---
Source path: ${source.path}
${source.content}`).join("\n");
}
