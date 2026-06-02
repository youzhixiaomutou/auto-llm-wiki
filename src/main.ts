import { Notice, Plugin, TFile } from "obsidian";
import { parseChangePlan, validateChangePlan } from "./changePlan";
import { t } from "./i18n";
import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt } from "./prompts";
import { OpenAIProvider, OpenAIProviderError } from "./providers/OpenAIProvider";
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
    this.setStatus(t("status.idle"));
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));

    this.addCommand({
      id: "ingest-active-source",
      name: t("command.ingestActiveSource"),
      callback: () => this.ingestActiveSource()
    });

    this.addCommand({
      id: "query-wiki",
      name: t("command.queryWiki"),
      callback: () => this.queryWiki()
    });

    this.addCommand({
      id: "lint-wiki",
      name: t("command.lintWiki"),
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
      const scanningMessage = t("status.scanningRaw");
      this.setStatus(scanningMessage);
      new Notice(scanningMessage);
      const candidates = findRawFileCandidates(this.app.vault.getFiles(), this.settings);
      const candidateMessage = this.formatRawCandidateMessage(candidates.sourceFiles.length, candidates.pdfPaths);
      this.setStatus(candidateMessage);
      new Notice(candidateMessage);
      const changedRawFiles = await findChangedRawFiles(this.app, this.settings, this.rawFileState, (path) => {
        const message = t("status.extractingPdf", { path });
        this.setStatus(message);
        new Notice(message);
      }, (request) => this.ocrPdfPage(request));
      if (changedRawFiles.length === 0) {
        this.setStatus(t("status.noRawChanges"));
        new Notice(t("notice.noRawChanges"));
        return;
      }

      const readingMessage = t("status.readingVaultContext");
      this.setStatus(readingMessage);
      new Notice(readingMessage);
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
      const message = formatOpenAIErrorMessage(error, t("error.ingestFailed"));
      this.setStatus(t("status.error", { message }));
      new Notice(message);
    }
  }

  private formatRawCandidateMessage(sourceCount: number, pdfPaths: string[]): string {
    const sourceLabel = t(sourceCount === 1 ? "label.sourceCandidate.one" : "label.sourceCandidate.other");
    if (pdfPaths.length === 0) {
      return t("status.rawCandidatesNonePdf", { sourceCount, sourceLabel });
    }
    return t("status.rawCandidatesIncludingPdf", { sourceCount, sourceLabel, pdfPaths: pdfPaths.join(", ") });
  }

  private async ocrPdfPage(request: PdfOcrRequest): Promise<string> {
    const message = t("status.ocrPdfPage", { pageNumber: request.pageNumber, path: request.path });
    this.setStatus(message);
    new Notice(message);
    const imageDataUrl = await renderPdfPageToPngDataUrl(request.page);
    const provider = new OpenAIProvider();
    return provider.completeVision({
      apiKey: this.settings.openAIApiKey,
      apiUrl: this.settings.openAIApiUrl,
      model: this.settings.openAIModel,
      prompt: t("prompt.ocrPdfPage", { pageNumber: request.pageNumber, path: request.path }),
      imageDataUrl
    });
  }

  private async queryWiki(): Promise<void> {
    const question = window.prompt(t("prompt.queryQuestion"));
    if (!question) return;
    const readingMessage = t("status.readingVaultContext");
    this.setStatus(readingMessage);
    new Notice(readingMessage);
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
    const readingMessage = t("status.readingVaultContext");
    this.setStatus(readingMessage);
    new Notice(readingMessage);
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
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }
    try {
      const waitingMessage = t("status.waitingModel");
      this.setStatus(waitingMessage);
      new Notice(waitingMessage);
      const provider = new OpenAIProvider();
      const response = await provider.complete({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        prompt
      });
      const validatingMessage = t("status.validatingChanges");
      this.setStatus(validatingMessage);
      new Notice(validatingMessage);
      const plan = validateChangePlan(parseChangePlan(response), this.settings);
      this.setStatus(t("status.reviewChanges"));
      new Notice(t("notice.reviewChanges"));
      new ChangePlanPreviewModal(this.app, plan, (message) => this.setStatus(message), onApplySuccess).open();
    } catch (error) {
      const message = formatOpenAIErrorMessage(error, t("error.requestFailed"));
      this.setStatus(t("status.error", { message }));
      new Notice(message);
    }
  }
}

function formatOpenAIErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof OpenAIProviderError) {
    if (error.kind === "request") {
      return t("error.openAIRequestFailed", { message: error.message });
    }
    if (error.kind === "missing-content") {
      return t("error.openAIResponseMissingContent");
    }
    if (error.kind === "invalid-json") {
      return t("error.openAIResponseInvalidJson");
    }
  }

  return error instanceof Error ? error.message : fallbackMessage;
}
