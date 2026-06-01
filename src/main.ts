import { Notice, Plugin, TFile } from "obsidian";
import { parseChangePlan, validateChangePlan } from "./changePlan";
import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt } from "./prompts";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { ChangePlanPreviewModal } from "./previewModal";
import { findChangedRawFiles, findRawFileCandidates, PdfOcrRequest, RawFileState, renderPdfPageToPngDataUrl, updateRawFileState } from "./rawTracker";
import { DEFAULT_SETTINGS, LLMWikiSettingTab } from "./settings";
import { LLMWikiPluginData, LLMWikiSettings } from "./types";
import { listMarkdownFiles, readTextFile } from "./vaultOps";

export default class LLMWikiPlugin extends Plugin {
  settings: LLMWikiSettings = DEFAULT_SETTINGS;
  rawFileState: RawFileState = {};
  private statusBarItem?: HTMLElement;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus("Auto LLM Wiki: idle");
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));

    this.addCommand({
      id: "ingest-active-source",
      name: "Ingest active source into Auto LLM Wiki",
      callback: () => this.ingestActiveSource()
    });

    this.addCommand({
      id: "query-wiki",
      name: "Query Auto LLM Wiki",
      callback: () => this.queryWiki()
    });

    this.addCommand({
      id: "lint-wiki",
      name: "Lint Auto LLM Wiki",
      callback: () => this.lintWiki()
    });
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as (LLMWikiPluginData & Partial<LLMWikiSettings>) | undefined;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
    this.rawFileState = data?.rawFileState ?? {};
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, rawFileState: this.rawFileState });
  }

  setStatus(message: string): void {
    this.statusBarItem?.setText(message);
  }

  private async ingestActiveSource(): Promise<void> {
    try {
      this.setStatus("Auto LLM Wiki: scanning raw folder for changes...");
      new Notice("Auto LLM Wiki: scanning raw folder for changes...");
      const candidates = findRawFileCandidates(this.app.vault.getFiles(), this.settings);
      const candidateMessage = this.formatRawCandidateMessage(candidates.sourceFiles.length, candidates.pdfPaths);
      this.setStatus(candidateMessage);
      new Notice(candidateMessage);
      const changedRawFiles = await findChangedRawFiles(this.app, this.settings, this.rawFileState, (path) => {
        const message = `Auto LLM Wiki: extracting text from PDF ${path}...`;
        this.setStatus(message);
        new Notice(message);
      }, (request) => this.ocrPdfPage(request));
      if (changedRawFiles.length === 0) {
        this.setStatus("Auto LLM Wiki: no raw changes");
        new Notice("Auto LLM Wiki: no new or changed raw files.");
        return;
      }

      this.setStatus("Auto LLM Wiki: reading vault context...");
      new Notice("Auto LLM Wiki: reading vault context...");
      const prompt = buildIngestPrompt({
        index: await readTextFile(this.app, this.settings.indexPath),
        log: await readTextFile(this.app, this.settings.logPath),
        sources: changedRawFiles.map((file) => ({ path: file.path, content: file.content }))
      }, this.settings);
      await this.runPrompt(prompt, async () => {
        this.rawFileState = updateRawFileState(this.rawFileState, changedRawFiles);
        await this.saveSettings();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auto LLM Wiki ingest failed.";
      this.setStatus(`Auto LLM Wiki: error - ${message}`);
      new Notice(message);
    }
  }

  private formatRawCandidateMessage(sourceCount: number, pdfPaths: string[]): string {
    const sourceLabel = sourceCount === 1 ? "source candidate" : "source candidates";
    if (pdfPaths.length === 0) return `Auto LLM Wiki: found ${sourceCount} raw ${sourceLabel}, no PDF candidates`;
    return `Auto LLM Wiki: found ${sourceCount} raw ${sourceLabel}, including PDFs: ${pdfPaths.join(", ")}`;
  }

  private async ocrPdfPage(request: PdfOcrRequest): Promise<string> {
    const message = `Auto LLM Wiki: OCR PDF page ${request.pageNumber} from ${request.path}...`;
    this.setStatus(message);
    new Notice(message);
    const imageDataUrl = await renderPdfPageToPngDataUrl(request.page);
    const provider = new OpenAIProvider();
    return provider.completeVision({
      apiKey: this.settings.openAIApiKey,
      apiUrl: this.settings.openAIApiUrl,
      model: this.settings.openAIModel,
      prompt: `Transcribe all visible text from PDF page ${request.pageNumber} of ${request.path}. Return only the transcription, preserving Chinese text and line breaks as much as possible.`,
      imageDataUrl
    });
  }

  private async queryWiki(): Promise<void> {
    const question = window.prompt("Ask the Auto LLM Wiki a question");
    if (!question) return;
    this.setStatus("Auto LLM Wiki: reading vault context...");
    new Notice("Auto LLM Wiki: reading vault context...");
    const wikiPages = await listMarkdownFiles(this.app, this.settings.wikiFolder);
    const prompt = buildQueryPrompt({
      index: await readTextFile(this.app, this.settings.indexPath),
      log: await readTextFile(this.app, this.settings.logPath),
      question,
      wikiPages: wikiPages.slice(0, 20)
    }, this.settings);
    await this.runPrompt(prompt);
  }

  private async lintWiki(): Promise<void> {
    this.setStatus("Auto LLM Wiki: reading vault context...");
    new Notice("Auto LLM Wiki: reading vault context...");
    const wikiPages = await listMarkdownFiles(this.app, this.settings.wikiFolder);
    const prompt = buildLintPrompt({
      index: await readTextFile(this.app, this.settings.indexPath),
      log: await readTextFile(this.app, this.settings.logPath),
      wikiPages
    }, this.settings);
    await this.runPrompt(prompt);
  }

  private async runPrompt(prompt: string, onApplySuccess?: () => Promise<void>): Promise<void> {
    if (!this.settings.openAIApiKey) {
      new Notice("Set your OpenAI API key in Auto LLM Wiki settings.");
      return;
    }
    try {
      this.setStatus("Auto LLM Wiki: waiting for model response...");
      new Notice("Auto LLM Wiki: waiting for model response...");
      const provider = new OpenAIProvider();
      const response = await provider.complete({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        prompt
      });
      this.setStatus("Auto LLM Wiki: validating proposed changes...");
      new Notice("Auto LLM Wiki: validating proposed changes...");
      const plan = validateChangePlan(parseChangePlan(response), this.settings);
      this.setStatus("Auto LLM Wiki: review proposed changes");
      new Notice("Auto LLM Wiki: review proposed changes.");
      new ChangePlanPreviewModal(this.app, plan, (message) => this.setStatus(message), onApplySuccess).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auto LLM Wiki request failed.";
      this.setStatus(`Auto LLM Wiki: error - ${message}`);
      new Notice(message);
    }
  }
}
