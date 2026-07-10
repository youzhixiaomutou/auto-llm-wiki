import { LLMWikiSettings, WikiContext } from "./types";
import { t, getOutputLanguageName } from "./i18n";

const BUILTIN_INGEST_SYSTEM = `You maintain a persistent LLM Wiki inside an Obsidian vault. The wiki is a structured, interlinked collection of markdown files that accumulates knowledge over time. Obsidian is the IDE; you are the programmer; the wiki is the codebase. Raw sources are immutable — you read from them but never modify them.

When a new source arrives, integrate it into the wiki by:
1. Reading the source and extracting key information.
2. Creating or updating a summary page for the source.
3. Updating relevant entity, concept, and topic pages across the wiki — cross-reference with Obsidian [[wikilinks]], note contradictions, strengthen the synthesis. A single source may touch many pages.
4. Adding or updating YAML frontmatter on wiki pages (tags, dates, source counts) for Dataview compatibility where appropriate.
5. Refreshing the configured index ({{indexPath}}) — a content-oriented catalog of every wiki page with [[wikilinks]] and one-line summaries.
6. Prepending a newest-first entry to the configured log ({{logPath}}) — a chronological record of what happened and when.

The wiki is a compounding artifact. Cross-references and contradictions should already be flagged. [[Wikilinks]] create the connections that power Obsidian's graph view. The synthesis should reflect everything ingested so far. Treat {{rawFolder}}/ and {{assetsFolder}}/ as read-only. Write only inside {{wikiFolder}}/.`;

const BUILTIN_CHAT_SYSTEM = `You answer questions from a persistent LLM Wiki stored in an Obsidian vault. The wiki is a structured, interlinked knowledge base of markdown pages connected by [[wikilinks]]. Answer only from the wiki context provided in the conversation (the index and the relevant pages). Cite the wiki pages you use by their path.

If the wiki does not cover the question, say so plainly instead of guessing. Be concise and conversational.

Good answers — comparisons, analyses, connections you discover — should be offered for filing back into the wiki as new markdown pages with appropriate [[wikilinks]] and YAML frontmatter. This way explorations compound in the knowledge base rather than disappearing into chat history. Reply in plain text or Markdown — never JSON.`;

const BUILTIN_LINT_SYSTEM = `You health-check a persistent LLM Wiki inside an Obsidian vault. Raw sources ({{rawFolder}}/) are the ground truth. The wiki ({{wikiFolder}}/) is a synthesis distilled from them, organized as interlinked markdown pages with [[wikilinks]] and YAML frontmatter.

Audit the wiki for:
- Contradictions between pages.
- Stale claims that newer sources have superseded.
- Orphan pages — pages with no inbound [[wikilinks]] from other wiki pages.
- Broken [[wikilinks]] that point to pages that don't exist yet.
- Important concepts mentioned across pages but lacking their own dedicated page.
- Missing cross-references where [[wikilinks]] should connect related pages.
- Inconsistent or missing YAML frontmatter (tags, dates) that would break Dataview queries.
- Data gaps that could be filled with new sources.

Suggest specific additions, removals, or revisions. The goal is to keep the wiki healthy, consistent, and growing — not to rewrite it from scratch.`;

const BUILTIN_OCR_PDF = `Transcribe all visible text from page {{pageNumber}} of the PDF {{path}}. This transcription will be used as raw source material fed into an Obsidian wiki ingestion pipeline.

Preserve the original structure:
- Headings and subheadings hierarchy.
- Paragraphs, line breaks, and indentation.
- Lists (numbered and bulleted).
- Tables — render as markdown tables.

Return only the transcription with no preamble or commentary.`;

const BUILTIN_OCR_IMAGE = `Transcribe all visible text from the image {{path}}. This transcription will be used as raw source material fed into an Obsidian wiki ingestion pipeline.

If the image is a chart or diagram, describe its structure and any visible labels, values, or annotations. If it is a screenshot, photograph, or scanned document, transcribe all readable text exactly as it appears.

Return only the transcription with no preamble or commentary.`;

export interface TemplateContext {
  language?: string;
  wikiFolder?: string;
  rawFolder?: string;
  assetsFolder?: string;
  indexPath?: string;
  logPath?: string;
  index?: string;
  log?: string;
  sources?: string;
  wikiPages?: string;
  rawPaths?: string;
  question?: string;
  answer?: string;
  summary?: string;
  operationCount?: number;
  timestamp?: string;
}

export class TemplateEngine {
  render(template: string, context: TemplateContext): string {
    if (!template || template.trim().length === 0) return "";
    let result = template;
    result = result.replace(/\{\{language\}\}/g, context.language ?? "");
    result = result.replace(/\{\{wikiFolder\}\}/g, context.wikiFolder ?? "");
    result = result.replace(/\{\{rawFolder\}\}/g, context.rawFolder ?? "");
    result = result.replace(/\{\{assetsFolder\}\}/g, context.assetsFolder ?? "");
    result = result.replace(/\{\{indexPath\}\}/g, context.indexPath ?? "");
    result = result.replace(/\{\{logPath\}\}/g, context.logPath ?? "");
    result = result.replace(/\{\{index\}\}/g, context.index ?? "");
    result = result.replace(/\{\{log\}\}/g, context.log ?? "");
    result = result.replace(/\{\{sources\}\}/g, context.sources ?? "");
    result = result.replace(/\{\{wikiPages\}\}/g, context.wikiPages ?? "");
    result = result.replace(/\{\{rawPaths\}\}/g, context.rawPaths ?? "");
    result = result.replace(/\{\{question\}\}/g, context.question ?? "");
    result = result.replace(/\{\{answer\}\}/g, context.answer ?? "");
    result = result.replace(/\{\{summary\}\}/g, context.summary ?? "");
    result = result.replace(/\{\{operationCount\}\}/g, String(context.operationCount ?? 0));
    result = result.replace(/\{\{timestamp\}\}/g, context.timestamp ?? new Date().toISOString());
    return result;
  }

  buildIngestPrompt(settings: LLMWikiSettings, context: { index: string; log: string; sources: string }): string {
    const languageInstruction = `Write user-visible natural-language output in ${getOutputLanguageName()}.`;
    const jsonContract = this.buildJsonContract(settings, false);
    const systemTemplate = settings.ingestSystemPrompt || BUILTIN_INGEST_SYSTEM;
    const system = this.render(systemTemplate, {
      language: getOutputLanguageName(),
      wikiFolder: settings.wikiFolder,
      rawFolder: settings.rawFolder,
      assetsFolder: settings.assetsFolder,
      indexPath: settings.indexPath,
      logPath: settings.logPath
    });

    return `${system}

${languageInstruction}

${jsonContract}

Current index:
${context.index}

Current log:
${context.log}

Changed raw sources:
${context.sources}`;
  }

  buildChatSystemPrompt(settings: LLMWikiSettings): string {
    const languageInstruction = `Write user-visible natural-language output in ${getOutputLanguageName()}.`;
    const template = settings.chatSystemPrompt || BUILTIN_CHAT_SYSTEM;
    return `${this.render(template, {
      language: getOutputLanguageName(),
      wikiFolder: settings.wikiFolder,
      rawFolder: settings.rawFolder
    })}

${languageInstruction}`;
  }

  buildChatContextMessage(settings: LLMWikiSettings, context: { index: string; wikiPages: string }): string {
    return `Wiki context for answering the question. Treat the ${settings.wikiFolder}/ pages below as your only knowledge source.

Current index:
${context.index}

Relevant wiki pages:
${context.wikiPages}`;
  }

  buildLintPrompt(settings: LLMWikiSettings, context: { index: string; log: string; wikiPages: string; rawPaths: string }): string {
    const languageInstruction = `Write user-visible natural-language output in ${getOutputLanguageName()}.`;
    const jsonContract = this.buildJsonContract(settings, true);
    const template = settings.lintSystemPrompt || BUILTIN_LINT_SYSTEM;
    const system = this.render(template, {
      language: getOutputLanguageName(),
      wikiFolder: settings.wikiFolder,
      rawFolder: settings.rawFolder
    });

    return `${system}

${languageInstruction}

${jsonContract}

Current index:
${context.index}

Current log:
${context.log}

Current raw sources (${settings.rawFolder}/):
${context.rawPaths}

Wiki pages:
${context.wikiPages}`;
  }

  buildQueryPrompt(settings: LLMWikiSettings, context: { index: string; log: string; question: string; answer?: string; wikiPages: string }): string {
    const intro = context.answer !== undefined
      ? "You are filing a completed question-and-answer back into the persistent LLM Wiki."
      : "You answer questions using the persistent LLM Wiki.";
    const languageInstruction = `Write user-visible natural-language output in ${getOutputLanguageName()}.`;
    const jsonContract = this.buildJsonContract(settings, false);
    const answerSection = context.answer !== undefined ? `\nAnswer to file:\n${context.answer}\n` : "";

    return `${intro}

${languageInstruction}

${jsonContract}

Question: ${context.question}
${answerSection}
Current index:
${context.index}

Current log:
${context.log}

Relevant wiki pages:
${context.wikiPages}`;
  }

  buildQuerySelectionPrompt(settings: LLMWikiSettings, context: { index: string; question: string; pagePaths: string }): string {
    return `You are selecting which wiki pages are most relevant to a question. Choose only from the provided page paths.

Question: ${context.question}

Current index:
${context.index}

Available page paths:
${context.pagePaths}

Return only a JSON array of the most relevant page paths (fewer is better), for example ["${settings.wikiFolder}/example.md"]. Do not include any other text.`;
  }

  getOcrPdfPrompt(settings: LLMWikiSettings, pageNumber: number, path: string): string {
    const template = settings.ocrPdfPrompt || BUILTIN_OCR_PDF;
    return this.render(template, {
      pageNumber: String(pageNumber),
      path
    } as unknown as TemplateContext);
  }

  getOcrImagePrompt(settings: LLMWikiSettings, path: string): string {
    const template = settings.ocrImagePrompt || BUILTIN_OCR_IMAGE;
    return this.render(template, {
      path
    } as unknown as TemplateContext);
  }

  buildGitCommitMessage(settings: LLMWikiSettings, context: { summary: string; operationCount: number }): string {
    return this.render(settings.gitCommitMessageTemplate, {
      summary: context.summary,
      operationCount: context.operationCount,
      timestamp: new Date().toISOString()
    });
  }

  private buildJsonContract(settings: LLMWikiSettings, allowDelete = false): string {
    const deleteExample = allowDelete
      ? `,\n    { "kind": "delete", "path": "${settings.wikiFolder}/obsolete.md", "rationale": "why this page is removed" }`
      : "";
    const kinds = allowDelete ? "create, update, append, prepend, or delete" : "create, update, append, or prepend";
    const deleteNote = allowDelete
      ? ` delete removes a page inside ${settings.wikiFolder}/ and takes no content — use it only for orphaned or fully superseded pages.`
      : "";
    return `Return only JSON with this shape:
{
  "summary": "short human-readable summary",
  "operations": [
    { "kind": "create", "path": "${settings.wikiFolder}/example.md", "content": "markdown", "rationale": "why this file changes" },
    { "kind": "update", "path": "${settings.indexPath}", "content": "full replacement markdown", "rationale": "why this file changes" },
    { "kind": "prepend", "path": "${settings.logPath}", "content": "newest-first markdown log entry", "rationale": "why this file changes" }${deleteExample}
  ]
}
Use only ${kinds}.${deleteNote} Write only inside ${settings.wikiFolder}/. Use ${settings.indexPath} for the content index and ${settings.logPath} for the newest-first chronological log. Use prepend for new entries in ${settings.logPath}. Treat ${settings.rawFolder}/ and ${settings.assetsFolder}/ as read-only.`;
  }
}

export const templateEngine = new TemplateEngine();
