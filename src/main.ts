import { EventRef, Notice, Plugin, TAbstractFile, TFile, requestUrl } from "obsidian";
import { normalizePath, parseChangePlan, planHasDestructiveOperation, validateChangePlan } from "./changePlan";
import { t } from "./i18n";
import { templateEngine } from "./templateEngine";
import { OpenAIProviderError } from "./providers/OpenAIProvider";
import { ProviderError } from "./providers/BaseOpenAICompatibleProvider";
import { providerRegistry } from "./providers/ProviderRegistry";
import { registerBuiltinProviders } from "./providers/registerProviders";
import { ChangePlanPreviewModal } from "./previewModal";
import { ChatController, ChatMessage, ChatState, Conversation, ChatView, CHAT_VIEW_TYPE } from "./chatView";
import { findChangedRawFiles, findRawFileCandidates, hashContent, ImageOcrRequest, migrateRawFileState, PdfOcrRequest, RawFileState, renderPdfPageToPngDataUrl, updateRawFileState } from "./rawTracker";
import { DEFAULT_SETTINGS, getProviderConfigForOperation, LLMWikiSettingTab } from "./settings";
import type { OperationType } from "./settings";
import { LLMWikiPluginData, LLMWikiSettings, ProviderConfig } from "./types";
import { applyChangePlan, listMarkdownFilePaths, listMarkdownFiles, readTextFile, readWikiPages } from "./vaultOps";
import { extractJsonArray } from "./jsonExtract";
import { EmbeddingsProvider } from "./embeddings/EmbeddingsProvider";
import { OllamaEmbeddingsProvider, cosineSearch } from "./embeddings/OllamaEmbeddingsProvider";
import { OpenAIEmbeddingsProvider } from "./embeddings/OpenAIEmbeddingsProvider";
import { QdrantEmbeddingsProvider } from "./embeddings/QdrantEmbeddingsProvider";
import { EmbeddingsStore } from "./embeddings/EmbeddingsStore";

const QUERY_MAX_PAGES = 12;
// Cap the conversation turns sent to the model so history + per-turn wiki context stays within
// the context window. The full thread is still kept in the view for display.
const CHAT_HISTORY_MAX_MESSAGES = 12;

export default class LLMWikiPlugin extends Plugin implements ChatController {
  settings: LLMWikiSettings = DEFAULT_SETTINGS;
  rawFileState: RawFileState = {};
  chatState: ChatState = { conversations: [], activeId: null };
  // Number of chat turns currently awaiting a reply. Concurrent conversations are allowed, so the
  // status bar is only reset to idle when the last one finishes (not the first).
  private answerChatInFlight = 0;
  private statusBarItem?: HTMLElement;
  private autoIngestTimer?: ReturnType<typeof setTimeout>;
  private autoIngestEventRefs: EventRef[] = [];
  private autoIngestRunning = false;
  private autoIngestPending = false;
  private autoIngestPollTimer?: number;
  githubUser: string | null = null;
  githubRepoExists = false;

  async onload(): Promise<void> {
    registerBuiltinProviders();
    await this.loadSettings();
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus(t("status.idle"));
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));
    this.registerAutoIngestListeners();

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-circle", t("command.openChat"), () => void this.openChatView());

    this.addCommand({
      id: "ingest-active-source",
      name: t("command.ingestActiveSource"),
      callback: () => this.ingestActiveSource()
    });

    this.addCommand({
      id: "query-wiki",
      name: t("command.queryWiki"),
      callback: () => void this.openChatView()
    });

    this.addCommand({
      id: "lint-wiki",
      name: t("command.lintWiki"),
      callback: () => this.lintWiki()
    });

    this.addCommand({
      id: "push-wiki-changes",
      name: t("command.pushWiki"),
      callback: () => this.pushWikiCommand()
    });
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as (LLMWikiPluginData & Partial<LLMWikiSettings> & { chatState?: ChatState }) | undefined;
    const { rawFileState, chatState, ...rest } = data ?? {};
    const settingsData: Record<string, unknown> = { ...rest };
    delete settingsData.provider;
    this.settings = { ...DEFAULT_SETTINGS, ...settingsData };
    // Migrate old single-provider fields to providers[] array.
    this.settings = migrateProviderSettings(this.settings);
    // Migrate old gitAutoCommit boolean to gitMode enum.
    this.settings = migrateGitSettings(this.settings, settingsData);
    this.rawFileState = migrateRawFileState(rawFileState);
    this.chatState = normalizeChatState(chatState);
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, rawFileState: this.rawFileState, chatState: this.chatState });
  }

  setStatus(message: string): void {
    this.statusBarItem?.setText(message);
  }

  private getProviderConfig(operation: OperationType = "text"): ProviderConfig | undefined {
    return getProviderConfigForOperation(this.settings, operation);
  }

  private createProvider(operation: OperationType = "text"): import("./providers/LLMProvider").LLMProvider {
    const config = this.getProviderConfig(operation);
    if (!config) throw new Error(t("notice.missingOpenAIKey"));
    return providerRegistry.getProvider(config, this.settings.requestTimeoutMs);
  }

  private getEmbeddingsProvider(): EmbeddingsProvider | undefined {
    const backend = this.settings.embeddingsBackend;
    if (backend === "none") return undefined;
    if (backend === "ollama") {
      return new OllamaEmbeddingsProvider(this.settings.embeddingsApiUrl, this.settings.embeddingsModel);
    }
    if (backend === "openai") {
      return new OpenAIEmbeddingsProvider(
        this.settings.embeddingsApiKey,
        this.settings.embeddingsApiUrl,
        this.settings.embeddingsModel
      );
    }
    if (backend === "qdrant") {
      return new QdrantEmbeddingsProvider(
        this.settings.qdrantUrl,
        this.settings.qdrantApiKey,
        this.settings.qdrantCollection,
        this.settings.embeddingsModel
      );
    }
    return undefined;
  }

  private async updateEmbeddings(plan: import("./types").ChangePlan): Promise<void> {
    if (this.settings.embeddingsBackend === "none") return;
    const provider = this.getEmbeddingsProvider();
    if (!provider) return;
    const store = new EmbeddingsStore(this.app, this.settings);
    this.setStatus(t("status.computingEmbeddings"));

    for (const op of plan.operations) {
      if (op.kind === "delete") {
        await store.deleteByPath(op.path);
      } else if (op.kind === "create" || op.kind === "update") {
        try {
          const content = await readTextFile(this.app, op.path);
          const h = hashContent(content);
          const existing = await store.loadAll();
          const existingEntry = existing.find((e) => e.path === op.path);
          if (existingEntry?.hash === h) continue;
          const embedding = await provider.embed(content);
          await store.save(op.path, h, embedding);
        } catch {
          // Silently skip embedding failures so they don't block the ingest flow
        }
      }
    }
  }

  enableAutoIngestListeners(): void {
    if (this.autoIngestEventRefs.length > 0) return;
    const createRef = this.app.vault.on("create", (file) => this.scheduleAutoIngest(file));
    const modifyRef = this.app.vault.on("modify", (file) => this.scheduleAutoIngest(file));
    this.autoIngestEventRefs = [createRef, modifyRef];
    this.registerEvent(createRef);
    this.registerEvent(modifyRef);
    this.startAutoIngestPolling();
  }

  // Vault file events do not fire for raw files changed outside Obsidian (e.g. dragged in,
  // synced, or on filesystems whose change notifications Obsidian misses). Poll on an interval
  // so those changes are picked up without a restart. Scans are cheap when nothing changed.
  private startAutoIngestPolling(): void {
    if (this.autoIngestPollTimer !== undefined) return;
    const seconds = this.settings.autoIngestPollSeconds;
    if (!seconds || seconds <= 0) return;
    this.autoIngestPollTimer = window.setInterval(() => {
      void this.runAutoIngest(true);
    }, seconds * 1000);
    this.registerInterval(this.autoIngestPollTimer);
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

  private async runAutoIngest(quiet = false): Promise<void> {
    if (this.autoIngestRunning) {
      this.autoIngestPending = true;
      return;
    }
    this.autoIngestRunning = true;
    try {
      await this.ingestActiveSource(true, quiet);
    } finally {
      this.autoIngestRunning = false;
      if (this.autoIngestPending) {
        this.autoIngestPending = false;
        await this.runAutoIngest(quiet);
      }
    }
  }

  private async ingestActiveSource(autoApply = false, quiet = false): Promise<void> {
    const providerConfig = this.getProviderConfig("text");
    if (!providerConfig?.apiKey) {
      if (!quiet) new Notice(t("notice.missingOpenAIKey"));
      return;
    }

    try {
      const scanningMessage = t("status.scanningRaw");
      this.setStatus(scanningMessage);
      if (!quiet) new Notice(scanningMessage);
      const candidates = findRawFileCandidates(this.app.vault.getFiles(), this.settings);
      const candidateMessage = this.formatRawCandidateMessage(candidates.sourceFiles.length, candidates.pdfPaths);
      this.setStatus(candidateMessage);
      if (!quiet) new Notice(candidateMessage);
      const scan = await findChangedRawFiles(this.app, this.settings, this.rawFileState, (path) => {
        const message = t("status.extractingPdf", { path });
        this.setStatus(message);
        if (!quiet) new Notice(message);
      }, (request) => this.ocrPdfPage(request), (request) => this.ocrImage(request));
      if (scan.failed.length > 0) {
        const details = scan.failed.map((failure) => failure.message).join("; ");
        const failedMessage = t("notice.rawScanFailed", { details });
        this.setStatus(failedMessage);
        if (!quiet) new Notice(failedMessage);
      }
      if (Object.keys(scan.stamps).length > 0) {
        this.rawFileState = { ...this.rawFileState, ...scan.stamps };
        await this.saveSettings();
      }
      const changedRawFiles = scan.changed;
      if (changedRawFiles.length === 0) {
        if (scan.failed.length === 0) {
          this.setStatus(t("status.noRawChanges"));
          if (!quiet) new Notice(t("notice.noRawChanges"));
        }
        return;
      }

      const readingMessage = t("status.readingVaultContext");
      this.setStatus(readingMessage);
      if (!quiet) new Notice(readingMessage);
      const sourceTexts = changedRawFiles.map((file) =>
        `---
Source path: ${file.path}
${file.content}`).join("\n");
      const prompt = templateEngine.buildIngestPrompt(this.settings, {
        index: await readTextFile(this.app, this.settings.indexPath),
        log: await readTextFile(this.app, this.settings.logPath),
        sources: sourceTexts
      });
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
    const providerConfig = this.getProviderConfig("vision");
    if (!providerConfig || !providerConfig.apiKey) {
      throw new Error(t("error.noVisionProvider"));
    }
    const message = t("status.ocrPdfPage", { pageNumber: request.pageNumber, path: request.path });
    this.setStatus(message);
    new Notice(message);
    const imageDataUrl = await renderPdfPageToPngDataUrl(request.page);
    const provider = this.createProvider("vision");
    try {
      return await provider.completeVision({
        apiKey: providerConfig.apiKey,
        apiUrl: providerConfig.apiUrl,
        model: providerConfig.model,
        prompt: templateEngine.getOcrPdfPrompt(this.settings, request.pageNumber, request.path),
        imageDataUrl
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    }
  }

  private async ocrImage(request: ImageOcrRequest): Promise<string> {
    const providerConfig = this.getProviderConfig("vision");
    if (!providerConfig || !providerConfig.apiKey) {
      throw new Error(t("error.noVisionProvider"));
    }
    const message = t("status.ocrImage", { path: request.path });
    this.setStatus(message);
    new Notice(message);
    const provider = this.createProvider("vision");
    try {
      return await provider.completeVision({
        apiKey: providerConfig.apiKey,
        apiUrl: providerConfig.apiUrl,
        model: providerConfig.model,
        prompt: templateEngine.getOcrImagePrompt(this.settings, request.path),
        imageDataUrl: request.imageDataUrl
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    }
  }

  async openChatView(): Promise<void> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      await rightLeaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
      leaf = rightLeaf;
    }
    workspace.revealLeaf(leaf);
  }

  hasApiKey(): boolean {
    const config = this.getProviderConfig("text");
    return Boolean(config?.apiKey);
  }

  // ChatController: the conversation store lives in plugin data so it survives the leaf closing and
  // an Obsidian restart. The view mutates its own copy and writes back through saveChatState.
  loadChatState(): ChatState {
    return this.chatState;
  }

  saveChatState(state: ChatState): void {
    // Enforce the cap on save too (not only on load) so persisted data cannot grow unbounded
    // within a long session. Newest conversations are stored at the front.
    const conversations = state.conversations.slice(0, MAX_STORED_CONVERSATIONS);
    const activeId = conversations.some((conversation) => conversation.id === state.activeId)
      ? state.activeId
      : conversations[0]?.id ?? null;
    this.chatState = { conversations, activeId };
    void this.saveSettings();
  }

  // ChatController: answer one turn conversationally, grounded in the wiki. Read-only w.r.t. the
  // vault (no writes); errors are localized so the view can display error.message directly. The
  // whole body (retrieval + selection + the chat call) is inside the try so any failure is
  // localized and the status bar is always reset.
  async answerChat(messages: ChatMessage[], onToken?: (token: string) => void): Promise<string> {
    const providerConfig = this.getProviderConfig("chat");
    this.answerChatInFlight++;
    try {
      const query = buildRetrievalQuery(messages);
      this.setStatus(t("status.readingVaultContext"));
      const index = await readTextFile(this.app, this.settings.indexPath);
      const pagePaths = this.listWikiContentPages();
      const selectedPaths = await this.selectRelevantPages(index, query, pagePaths);
      const wikiPages = await readWikiPages(this.app, selectedPaths);
      this.setStatus(t("status.waitingModel"));
      const provider = this.createProvider("chat");
      const wikiPagesText = wikiPages.map((p) => `---
Path: ${p.path}
${p.content}`).join("\n\n");
      const systemContent = `${templateEngine.buildChatSystemPrompt(this.settings)}\n\n${templateEngine.buildChatContextMessage(this.settings, { index, wikiPages: wikiPagesText })}`;
      return await provider.chat({
        apiKey: providerConfig?.apiKey ?? "",
        apiUrl: providerConfig?.apiUrl ?? "",
        model: providerConfig?.model ?? "",
        messages: [
          { role: "system", content: systemContent },
          ...messages.slice(-CHAT_HISTORY_MAX_MESSAGES)
        ],
        onToken
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    } finally {
      this.answerChatInFlight--;
      if (this.answerChatInFlight === 0) this.setStatus(t("status.idle"));
    }
  }

  // ChatController: file a finished Q&A back through the reviewed change-plan pipeline.
  async saveChatAnswer(question: string, answer: string): Promise<void> {
    const providerConfig = this.getProviderConfig("text");
    if (!providerConfig?.apiKey) {
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }
    try {
      this.setStatus(t("status.readingVaultContext"));
      const index = await readTextFile(this.app, this.settings.indexPath);
      const pagePaths = this.listWikiContentPages();
      const selectedPaths = await this.selectRelevantPages(index, question, pagePaths);
      const wikiPages = await readWikiPages(this.app, selectedPaths);
      const wikiPagesText = wikiPages.map((p) => `---
Path: ${p.path}
${p.content}`).join("\n\n");
      const prompt = templateEngine.buildQueryPrompt(this.settings, {
        index,
        log: await readTextFile(this.app, this.settings.logPath),
        question,
        answer,
        wikiPages: wikiPagesText
      });
      await this.runPrompt(prompt);
    } catch (error) {
      const message = formatOpenAIErrorMessage(error, t("error.requestFailed"));
      this.setStatus(t("status.error", { message }));
      new Notice(message);
    }
  }

  // Wiki content pages sent as chat/query context: every markdown page in the wiki folder EXCEPT
  // the index and log. The index is already sent separately, and the log is operational history,
  // not knowledge — including either would duplicate the index and leak log content to the model.
  private listWikiContentPages(): string[] {
    const excluded = new Set([normalizePath(this.settings.indexPath), normalizePath(this.settings.logPath)]);
    return listMarkdownFilePaths(this.app, this.settings.wikiFolder)
      .filter((path) => !excluded.has(normalizePath(path)));
  }

  // Karpathy-style query: read the index first and let the model pick the relevant pages,
  // then drill into only those. Skip the extra call when the wiki is small enough to send whole.
  // When embeddings are configured, use vector similarity instead of an LLM call.
  private async selectRelevantPages(index: string, question: string, pagePaths: string[]): Promise<string[]> {
    if (pagePaths.length <= QUERY_MAX_PAGES) return pagePaths;

    if (this.settings.embeddingsBackend !== "none") {
      try {
        const provider = this.getEmbeddingsProvider();
        if (!provider) return this.selectRelevantPagesViaLLM(index, question, pagePaths);
        const store = new EmbeddingsStore(this.app, this.settings);
        const storedEmbeddings = await store.loadAll();

        if (storedEmbeddings.length === 0) return this.selectRelevantPagesViaLLM(index, question, pagePaths);

        const queryEmbedding = await provider.embed(question);

        if (provider instanceof QdrantEmbeddingsProvider) {
          const results = await provider.searchRemote(queryEmbedding, QUERY_MAX_PAGES);
          const paths = results.filter((r) => pagePaths.includes(r.path)).map((r) => r.path);
          return paths.length > 0 ? paths : this.selectRelevantPagesViaLLM(index, question, pagePaths);
        }

        const available = storedEmbeddings.filter((e) => pagePaths.includes(e.path));
        if (available.length === 0) return this.selectRelevantPagesViaLLM(index, question, pagePaths);

        const results = cosineSearch(queryEmbedding, available, QUERY_MAX_PAGES);
        return results.map((r) => r.path);
      } catch {
        return this.selectRelevantPagesViaLLM(index, question, pagePaths);
      }
    }

    return this.selectRelevantPagesViaLLM(index, question, pagePaths);
  }

  private async selectRelevantPagesViaLLM(index: string, question: string, pagePaths: string[]): Promise<string[]> {
    const providerConfig = this.getProviderConfig("chat");
    const selectingMessage = t("status.selectingPages");
    this.setStatus(selectingMessage);
    new Notice(selectingMessage);
    const provider = this.createProvider("chat");
    const response = await provider.complete({
      apiKey: providerConfig?.apiKey ?? "",
      apiUrl: providerConfig?.apiUrl ?? "",
      model: providerConfig?.model ?? "",
      prompt: templateEngine.buildQuerySelectionPrompt(this.settings, { index, question, pagePaths: pagePaths.join("\n") })
    });
    return parseSelectedQueryPages(response, pagePaths, QUERY_MAX_PAGES);
  }

  private async lintWiki(): Promise<void> {
    const readingMessage = t("status.readingVaultContext");
    this.setStatus(readingMessage);
    new Notice(readingMessage);
    const wikiPages = await listMarkdownFiles(this.app, this.settings.wikiFolder);
    const rawPaths = findRawFileCandidates(this.app.vault.getFiles(), this.settings)
      .sourceFiles.map((file) => file.path).sort();
    const wikiPagesText = wikiPages.map((p) => `---
Path: ${p.path}
${p.content}`).join("\n\n");
    const prompt = templateEngine.buildLintPrompt(this.settings, {
      index: await readTextFile(this.app, this.settings.indexPath),
      log: await readTextFile(this.app, this.settings.logPath),
      wikiPages: wikiPagesText,
      rawPaths: rawPaths.join("\n")
    });
    await this.runPrompt(prompt);
  }

  private async runPrompt(prompt: string, onApplySuccess?: () => Promise<void>, autoApply = false): Promise<void> {
    const providerConfig = this.getProviderConfig("text");
    if (!providerConfig?.apiKey) {
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }
    try {
      const waitingMessage = t("status.waitingModel");
      this.setStatus(waitingMessage);
      new Notice(waitingMessage);
      const provider = this.createProvider("text");
      const response = await provider.complete({
        apiKey: providerConfig.apiKey,
        apiUrl: providerConfig.apiUrl,
        model: providerConfig.model,
        prompt
      });
      const validatingMessage = t("status.validatingChanges");
      this.setStatus(validatingMessage);
      new Notice(validatingMessage);
      const plan = validateChangePlan(parseChangePlan(response), this.settings);
      if (autoApply && !planHasDestructiveOperation(plan)) {
        const applyingMessage = t("status.applyingChanges");
        this.setStatus(applyingMessage);
        new Notice(applyingMessage);
        await applyChangePlan(this.app, plan);
        await onApplySuccess?.();
        await this.updateEmbeddings(plan);
        await this.tryGitCommit(plan);
        this.setStatus(t("status.applied"));
        new Notice(t("notice.changesApplied"));
        return;
      }
      this.setStatus(t("status.reviewChanges"));
      new Notice(t("notice.reviewChanges"));
      new ChangePlanPreviewModal(this.app, plan, (message) => this.setStatus(message), async () => {
        await onApplySuccess?.();
        await this.updateEmbeddings(plan);
        await this.tryGitCommit(plan);
      }).open();
    } catch (error) {
      const message = formatOpenAIErrorMessage(error, t("error.requestFailed"));
      this.setStatus(t("status.error", { message }));
      new Notice(message);
    }
  }

  private async execGit(args: string, env?: Record<string, string>): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    if (typeof (window as unknown as { require?: (module: string) => unknown }).require === "undefined") {
      return { ok: false, stdout: "", stderr: "Electron require not available" };
    }
    const childProcess = (window as unknown as { require: (module: string) => { exec: (cmd: string, options: unknown, callback: (err: unknown, stdout: string, stderr: string) => void) => unknown } }).require("child_process");
    const vaultPath = (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
    if (!vaultPath) return { ok: false, stdout: "", stderr: "Vault path not available" };
    return new Promise((resolve) => {
      childProcess.exec(args, { cwd: vaultPath, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: (stdout || "").trim(), stderr: (stderr || "").trim() });
      });
    });
  }

  private async ensureGitRepo(): Promise<boolean> {
    const check = await this.execGit("git --version");
    if (!check.ok) {
      new Notice(t("notice.gitNotInstalled"));
      return false;
    }
    const repoCheck = await this.execGit("git rev-parse --git-dir");
    if (repoCheck.ok) return true;
    const init = await this.execGit("git init");
    if (!init.ok) {
      new Notice(t("notice.gitInitFailed"));
      return false;
    }
    return true;
  }

  private async ensureRemote(): Promise<boolean> {
    if (!this.settings.gitRemoteUrl) return true;
    const env = this.gitEnv();
    const check = await this.execGit("git remote get-url origin", env);
    if (check.ok) {
      if (check.stdout === this.settings.gitRemoteUrl) return true;
      const setUrl = await this.execGit(`git remote set-url origin ${this.settings.gitRemoteUrl}`, env);
      if (!setUrl.ok) {
        new Notice(`Failed to update remote: ${setUrl.stderr}`);
        return false;
      }
      return true;
    }
    const add = await this.execGit(`git remote add origin ${this.settings.gitRemoteUrl}`, env);
    if (!add.ok) {
      new Notice(`Failed to add remote: ${add.stderr}`);
      return false;
    }
    return true;
  }

  private async gitPush(): Promise<boolean> {
    const env = this.gitEnv();
    const result = await this.execGit("git push origin HEAD", env);
    if (result.ok) {
      new Notice(t("notice.gitPushSuccess"));
      return true;
    }
    new Notice(t("notice.gitPushFailed", { message: result.stderr }));
    return false;
  }

  private async tryGitCommit(plan: import("./types").ChangePlan): Promise<void> {
    if (this.settings.gitMode === "none") return;
    try {
      if (!(await this.ensureGitRepo())) return;
      if (this.settings.gitMode === "remote") {
        if (!(await this.ensureRemote())) return;
      }
      const message = templateEngine.buildGitCommitMessage(this.settings, {
        summary: plan.summary,
        operationCount: plan.operations.length
      });
      const wikiFolder = this.settings.wikiFolder;
      const env = this.gitEnv();
      const result = await this.execGit(`git add "${wikiFolder}" && git commit -m "${message.replace(/"/g, '\\"')}"`, env);
      if (result.ok) {
        new Notice(t("notice.gitCommitted"));
      } else if (result.stderr.includes("nothing to commit")) {
        return;
      } else {
        new Notice(`Git commit failed: ${result.stderr}`);
        return;
      }
      if (this.settings.gitMode === "remote" && this.settings.gitAutoPush) {
        await this.gitPush();
      }
    } catch (e) {
      new Notice(`Git error: ${e}`);
    }
  }

  private async pushWikiCommand(): Promise<void> {
    if (this.settings.gitMode === "none") {
      new Notice(t("notice.gitNotEnabled"));
      return;
    }
    new Notice(t("notice.gitPushing"));
    await this.gitPush();
  }

  private gitEnv(): Record<string, string> | undefined {
    if (this.settings.gitMode !== "remote") return undefined;
    if (this.settings.gitRemoteMethod !== "ssh-keygen") return undefined;
    if (!this.settings.gitSshKeyPath) return undefined;
    return { GIT_SSH_COMMAND: `ssh -i "${this.settings.gitSshKeyPath}" -o StrictHostKeyChecking=accept-new` };
  }

  async generateSshKey(): Promise<void> {
    if (typeof (window as unknown as { require?: (module: string) => unknown }).require === "undefined") {
      new Notice("Electron require not available");
      return;
    }
    try {
      const os = (window as unknown as { require: (module: string) => { homedir: () => string } }).require("os");
      const path = (window as unknown as { require: (module: string) => { join: (...segments: string[]) => string } }).require("path");
      const fs = (window as unknown as { require: (module: string) => { existsSync: (p: string) => boolean; readFileSync: (p: string, enc: string) => string } }).require("fs");
      const childProcess = (window as unknown as { require: (module: string) => { exec: (cmd: string, cb: (err: unknown, stdout: string, stderr: string) => void) => unknown } }).require("child_process");
      const keyPath = path.join(os.homedir(), ".ssh", "contextos_ed25519");
      if (fs.existsSync(keyPath)) {
        new Notice(t("notice.gitSshKeyExists", { path: keyPath }));
        this.settings = { ...this.settings, gitSshKeyPath: keyPath };
        await this.saveSettings();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        childProcess.exec(`ssh-keygen -t ed25519 -C "contextos" -f "${keyPath}" -N ""`, (err: unknown, _stdout: string, stderr: string) => {
          if (err) { reject(new Error((stderr || "").trim() || "ssh-keygen failed")); return; }
          resolve();
        });
      });
      this.settings = { ...this.settings, gitSshKeyPath: keyPath };
      await this.saveSettings();
      new Notice(t("notice.gitSshKeyGenerated"));
    } catch (e) {
      new Notice(`SSH key generation failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async testGitConnection(): Promise<void> {
    const check = await this.execGit("git --version");
    if (!check.ok) {
      new Notice(t("notice.gitNotInstalled"));
      return;
    }
    if (this.settings.gitMode === "remote" && this.settings.gitRemoteUrl) {
      const env = this.gitEnv();
      const result = await this.execGit(`git ls-remote ${this.settings.gitRemoteUrl}`, env);
      if (result.ok) {
        new Notice(t("notice.gitConnectionSucceeded"));
      } else {
        new Notice(t("notice.gitConnectionFailed", { message: result.stderr }));
      }
    } else if (this.settings.gitMode === "remote") {
      new Notice("No remote URL configured.");
    } else {
      new Notice(t("notice.gitConnectionSucceeded"));
    }
  }

  private async githubApi(path: string, opts?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; json: unknown }> {
    const token = this.settings.gitHubToken;
    try {
      const response = await requestUrl({
        url: `https://api.github.com${path}`,
        method: opts?.method ?? "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json"
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined
      });
      return { ok: response.status >= 200 && response.status < 300, status: response.status, json: response.json };
    } catch (e) {
      return { ok: false, status: (e as { status?: number }).status ?? 0, json: { message: (e as Error).message } };
    }
  }

  async fetchGitHubUser(): Promise<string | null> {
    try {
      const result = await this.githubApi("/user");
      if (result.ok) {
        const data = result.json as { login: string };
        return data.login ?? null;
      }
      return null;
    } catch {
      return null;
    }
  }

  async checkGitHubRepo(owner: string, repo: string): Promise<boolean> {
    try {
      const result = await this.githubApi(`/repos/${owner}/${repo}`);
      return result.ok;
    } catch {
      return false;
    }
  }

  async createGitHubRepo(): Promise<string | null> {
    try {
      const user = await this.fetchGitHubUser();
      if (!user) {
        new Notice(t("notice.gitHubAccountFailed"));
        return null;
      }
      const exists = await this.checkGitHubRepo(user, this.settings.gitHubRepoName);
      if (exists) {
        const url = `https://github.com/${user}/${this.settings.gitHubRepoName}`;
        new Notice(t("notice.gitRepoExists"));
        const remoteUrl = `https://${this.settings.gitHubToken}@github.com/${user}/${this.settings.gitHubRepoName}.git`;
        this.settings = { ...this.settings, gitRemoteUrl: remoteUrl };
        await this.saveSettings();
        return url;
      }
      const result = await this.githubApi("/user/repos", {
        method: "POST",
        body: { name: this.settings.gitHubRepoName, private: true, auto_init: false }
      });
      if (result.ok) {
        const data = result.json as { html_url: string };
        const url = data.html_url ?? `https://github.com/${user}/${this.settings.gitHubRepoName}`;
        const remoteUrl = `https://${this.settings.gitHubToken}@github.com/${user}/${this.settings.gitHubRepoName}.git`;
        this.settings = { ...this.settings, gitRemoteUrl: remoteUrl };
        await this.saveSettings();
        new Notice(t("notice.gitRepoCreated", { url }));
        return url;
      }
      const errData = result.json as { message?: string };
      let errorMsg = errData.message ?? `HTTP ${result.status}`;
      if (result.status === 403 || result.status === 401) {
        errorMsg = `${errorMsg}. Ensure your GitHub token has the "repo" scope enabled.`;
      }
      new Notice(t("notice.gitRepoCreateFailed", { message: errorMsg }));
      return null;
    } catch (e) {
      new Notice(t("notice.gitRepoCreateFailed", { message: e instanceof Error ? e.message : String(e) }));
      return null;
    }
  }
}

const MAX_STORED_CONVERSATIONS = 50;

// Build the retrieval query from the recent user turns so page selection reflects the whole thread
// rather than a terse latest message. Assistant turns are excluded to keep the query on-topic.
function buildRetrievalQuery(messages: ChatMessage[]): string {
  const RECENT_USER_TURNS = 4;
  const recent = messages
    .filter((message) => message.role === "user")
    .slice(-RECENT_USER_TURNS)
    .map((message) => message.content);
  return recent.length > 0 ? recent.join("\n") : (messages[messages.length - 1]?.content ?? "");
}

// Defend against corrupted/old plugin data: keep only well-shaped conversations, sanitize each
// one's messages, cap the count (newest are stored first), and pin activeId to a conversation
// that still exists.
export function normalizeChatState(raw: unknown): ChatState {
  const state = raw as Partial<ChatState> | undefined;
  const conversations = (Array.isArray(state?.conversations) ? state.conversations : [])
    .filter(isValidConversation)
    .map(sanitizeConversation)
    .slice(0, MAX_STORED_CONVERSATIONS);
  const activeId = typeof state?.activeId === "string" ? state.activeId : null;
  return {
    conversations,
    activeId: conversations.some((conversation) => conversation.id === activeId)
      ? activeId
      : conversations[0]?.id ?? null
  };
}

function isValidConversation(value: unknown): value is Conversation {
  const conversation = value as Partial<Conversation> | undefined;
  return Boolean(
    conversation &&
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    Array.isArray(conversation.messages)
  );
}

function isValidMessage(value: unknown): value is ChatMessage {
  const message = value as Partial<ChatMessage> | undefined;
  return Boolean(message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string");
}

// Drop malformed messages, coerce timestamps to numbers, and remove any trailing user turn — a
// question whose reply never arrived (the app closed mid-request). Leaving it would make the next
// send stack two consecutive user turns, and the in-memory "pending" indicator is already gone.
function sanitizeConversation(conversation: Conversation): Conversation {
  const messages = conversation.messages.filter(isValidMessage);
  while (messages.length > 0 && messages[messages.length - 1].role === "user") messages.pop();
  return {
    id: conversation.id,
    title: typeof conversation.title === "string" ? conversation.title : "",
    messages,
    createdAt: typeof conversation.createdAt === "number" ? conversation.createdAt : 0,
    updatedAt: typeof conversation.updatedAt === "number" ? conversation.updatedAt : 0
  };
}

export function formatOpenAIErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof OpenAIProviderError || error instanceof ProviderError) {
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

function parseSelectedQueryPages(response: string, availablePaths: string[], limit: number): string[] {
  const available = new Set(availablePaths);
  const parsed = extractJsonArray(response);
  const selected = Array.isArray(parsed)
    ? parsed.filter((value): value is string => typeof value === "string" && available.has(value))
    : [];
  const deduped = Array.from(new Set(selected));
  return deduped.length > 0 ? deduped.slice(0, limit) : availablePaths.slice(0, limit);
}

function migrateProviderSettings(settings: LLMWikiSettings): LLMWikiSettings {
  if (settings.providers && settings.providers.length > 0) return settings;
  // Migrate old single-provider fields to providers[] array.
  const providers: ProviderConfig[] = [{
    id: "default-openai",
    type: "openai",
    name: "OpenAI",
    apiKey: settings.openAIApiKey,
    apiUrl: settings.openAIApiUrl,
    model: settings.openAIModel,
    enabled: true
  }];
  return { ...settings, providers, activeProviderId: "default-openai" };
}

function migrateGitSettings(settings: LLMWikiSettings, data: Record<string, unknown>): LLMWikiSettings {
  if (!("gitAutoCommit" in data)) return settings;
  const gitAutoCommit = data["gitAutoCommit"];
  delete data["gitAutoCommit"];
  return {
    ...settings,
    gitMode: gitAutoCommit ? "local" : "none"
  };
}
