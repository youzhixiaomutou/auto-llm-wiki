import { EventRef, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { parseChangePlan, validateChangePlan } from "./changePlan";
import { t } from "./i18n";
import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt } from "./prompts";
import { OpenAIProvider, OpenAIProviderError } from "./providers/OpenAIProvider";
import { ChangePlanPreviewModal } from "./previewModal";
import { findChangedRawFiles, findRawFileCandidates, ImageOcrRequest, migrateRawFileState, PdfOcrRequest, RawFileState, renderPdfPageToPngDataUrl, updateRawFileState } from "./rawTracker";
import { DEFAULT_SETTINGS, LLMWikiSettingTab } from "./settings";
import { LLMWikiPluginData, LLMWikiSettings } from "./types";
import { applyChangePlan, listMarkdownFiles, readTextFile } from "./vaultOps";

export default class LLMWikiPlugin extends Plugin {
  settings: LLMWikiSettings = DEFAULT_SETTINGS;
  rawFileState: RawFileState = {};
  private statusBarItem?: HTMLElement;
  private autoIngestTimer?: ReturnType<typeof setTimeout>;
  private autoIngestEventRefs: EventRef[] = [];
  private autoIngestRunning = false;
  private autoIngestPending = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus(t("status.idle"));
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));
    this.registerAutoIngestListeners();

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
    this.rawFileState = migrateRawFileState(data?.rawFileState);
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, rawFileState: this.rawFileState });
  }

  setStatus(message: string): void {
    this.statusBarItem?.setText(message);
  }

  enableAutoIngestListeners(): void {
    if (this.autoIngestEventRefs.length > 0) return;
    const createRef = this.app.vault.on("create", (file) => this.scheduleAutoIngest(file));
    const modifyRef = this.app.vault.on("modify", (file) => this.scheduleAutoIngest(file));
    this.autoIngestEventRefs = [createRef, modifyRef];
    this.registerEvent(createRef);
    this.registerEvent(modifyRef);
  }

  private registerAutoIngestListeners(): void {
    if (!this.settings.autoIngestEnabled) return;
    this.enableAutoIngestListeners();
  }

  private scheduleAutoIngest(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (!findRawFileCandidates([file], this.settings).sourceFiles.includes(file)) return;
    if (this.autoIngestTimer) clearTimeout(this.autoIngestTimer);
    this.autoIngestTimer = setTimeout(() => {
      void this.runAutoIngest();
    }, this.settings.autoIngestDebounceMs);
  }

  private async runAutoIngest(): Promise<void> {
    if (this.autoIngestRunning) {
      this.autoIngestPending = true;
      return;
    }
    this.autoIngestRunning = true;
    try {
      await this.ingestActiveSource(true);
    } finally {
      this.autoIngestRunning = false;
      if (this.autoIngestPending) {
        this.autoIngestPending = false;
        await this.runAutoIngest();
      }
    }
  }

  private async ingestActiveSource(autoApply = false): Promise<void> {
    if (!this.settings.openAIApiKey) {
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }

    try {
      const scanningMessage = t("status.scanningRaw");
      this.setStatus(scanningMessage);
      new Notice(scanningMessage);
      const candidates = findRawFileCandidates(this.app.vault.getFiles(), this.settings);
      const candidateMessage = this.formatRawCandidateMessage(candidates.sourceFiles.length, candidates.pdfPaths);
      this.setStatus(candidateMessage);
      new Notice(candidateMessage);
      const scan = await findChangedRawFiles(this.app, this.settings, this.rawFileState, (path) => {
        const message = t("status.extractingPdf", { path });
        this.setStatus(message);
        new Notice(message);
      }, (request) => this.ocrPdfPage(request), (request) => this.ocrImage(request));
      // Persist refreshed mtime/size for confirmed-unchanged files immediately (cache
      // maintenance, independent of ingest) so the fast-path engages on later scans.
      if (Object.keys(scan.stamps).length > 0) {
        this.rawFileState = { ...this.rawFileState, ...scan.stamps };
        await this.saveSettings();
      }
      const changedRawFiles = scan.changed;
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
      }, autoApply);
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
    try {
      return await provider.completeVision({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        prompt: t("prompt.ocrPdfPage", { pageNumber: request.pageNumber, path: request.path }),
        imageDataUrl
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    }
  }

  private async ocrImage(request: ImageOcrRequest): Promise<string> {
    const message = t("status.ocrImage", { path: request.path });
    this.setStatus(message);
    new Notice(message);
    const provider = new OpenAIProvider();
    try {
      return await provider.completeVision({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        prompt: t("prompt.ocrImage", { path: request.path }),
        imageDataUrl: request.imageDataUrl
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    }
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

  private async runPrompt(prompt: string, onApplySuccess?: () => Promise<void>, autoApply = false): Promise<void> {
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
      if (autoApply) {
        const applyingMessage = t("status.applyingChanges");
        this.setStatus(applyingMessage);
        new Notice(applyingMessage);
        await applyChangePlan(this.app, plan);
        await onApplySuccess?.();
        this.setStatus(t("status.applied"));
        new Notice(t("notice.changesApplied"));
        return;
      }
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

export function formatOpenAIErrorMessage(error: unknown, fallbackMessage: string): string {
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
    if (error.kind === "truncated") {
      return t("error.openAIResponseTruncated");
    }
    if (error.kind === "timeout") {
      return t("error.openAIRequestTimedOut");
    }
  }

  return error instanceof Error ? error.message : fallbackMessage;
}
