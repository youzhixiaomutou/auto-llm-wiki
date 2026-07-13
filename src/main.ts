import { EventRef, Notice, Plugin, TAbstractFile, TFile } from "obsidian";
import { normalizePath, parseChangePlan, planHasDestructiveOperation, validateChangePlan } from "./changePlan";
import { t } from "./i18n";
import { buildChatContextMessage, buildChatSystemPrompt, buildIngestPrompt, buildLintPrompt, buildQueryPrompt, buildQuerySelectionPrompt, parseSelectedQueryPages } from "./prompts";
import { OpenAIProvider, OpenAIProviderError } from "./providers/OpenAIProvider";
import { ChangePlanPreviewModal } from "./previewModal";
import { ChatController, ChatMessage, ChatState, Conversation, ChatView, CHAT_VIEW_TYPE } from "./chatView";
import { findChangedRawFiles, findRawFileCandidates, ImageOcrRequest, migrateRawFileState, PdfOcrRequest, RawFileState, renderPdfPageToPngDataUrl, updateRawFileState } from "./rawTracker";
import { DEFAULT_SETTINGS, LLMWikiSettingTab } from "./settings";
import { LLMWikiPluginData, LLMWikiSettings } from "./types";
import { applyChangePlan, listMarkdownFilePaths, listMarkdownFiles, readTextFile, readWikiPages } from "./vaultOps";

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

  async onload(): Promise<void> {
    await this.loadSettings();
    this.statusBarItem = this.addStatusBarItem();
    this.setStatus(t("status.idle"));
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));
    this.registerAutoIngestListeners();

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.addRibbonIcon("message-circle", t("command.openChat"), () => void this.toggleChatView());

    this.addCommand({
      id: "ingest-active-source",
      name: t("command.ingestActiveSource"),
      callback: () => this.ingestActiveSource()
    });

    this.addCommand({
      id: "query-wiki",
      name: t("command.queryWiki"),
      callback: () => void this.toggleChatView()
    });

    this.addCommand({
      id: "lint-wiki",
      name: t("command.lintWiki"),
      callback: () => this.lintWiki()
    });
  }

  async loadSettings(): Promise<void> {
    const data = await this.loadData() as (LLMWikiPluginData & Partial<LLMWikiSettings> & { chatState?: ChatState }) | undefined;
    // Keep persisted-but-non-setting data (rawFileState, chatState) and the removed `provider` key
    // out of the settings object so they aren't re-saved as if they were live settings.
    const { rawFileState, chatState, ...rest } = data ?? {};
    const settingsData: Record<string, unknown> = { ...rest };
    delete settingsData.provider;
    this.settings = { ...DEFAULT_SETTINGS, ...settingsData };
    this.rawFileState = migrateRawFileState(rawFileState);
    this.chatState = normalizeChatState(chatState);
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ ...this.settings, rawFileState: this.rawFileState, chatState: this.chatState });
  }

  setStatus(message: string): void {
    this.statusBarItem?.setText(message);
  }

  private createProvider(): OpenAIProvider {
    return new OpenAIProvider(undefined, { timeoutMs: this.settings.requestTimeoutMs });
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
    if (!this.settings.openAIApiKey) {
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
        // Each message already names its file exactly once (see findChangedRawFiles).
        const details = scan.failed.map((failure) => failure.message).join("; ");
        const failedMessage = t("notice.rawScanFailed", { details });
        this.setStatus(failedMessage);
        if (!quiet) new Notice(failedMessage);
      }
      // Persist refreshed mtime/size for confirmed-unchanged files immediately (cache
      // maintenance, independent of ingest) so the fast-path engages on later scans.
      if (Object.keys(scan.stamps).length > 0) {
        this.rawFileState = { ...this.rawFileState, ...scan.stamps };
        await this.saveSettings();
      }
      const changedRawFiles = scan.changed;
      if (changedRawFiles.length === 0) {
        // Keep the failure surfaced as the final status when nothing else changed; only
        // announce "no changes" when the scan was actually clean.
        if (scan.failed.length === 0) {
          this.setStatus(t("status.noRawChanges"));
          if (!quiet) new Notice(t("notice.noRawChanges"));
        }
        return;
      }

      const readingMessage = t("status.readingVaultContext");
      this.setStatus(readingMessage);
      if (!quiet) new Notice(readingMessage);
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
    const provider = this.createProvider();
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
    const provider = this.createProvider();
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

  // Toggle the chat panel: open + reveal it in the right sidebar if it is closed, or close it
  // (detach the leaf) if it is already open. Conversations persist in plugin data, so reopening
  // restores the active conversation. Bound to both the ribbon icon and the query command.
  async toggleChatView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
    if (existing.length > 0) {
      existing.forEach((leaf) => leaf.detach());
      return;
    }
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) return;
    await rightLeaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    workspace.revealLeaf(rightLeaf);
  }

  hasApiKey(): boolean {
    return Boolean(this.settings.openAIApiKey);
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
  async answerChat(messages: ChatMessage[]): Promise<string> {
    this.answerChatInFlight++;
    try {
      // Retrieve against the recent conversation, not just the last message, so a follow-up like
      // "expand on that" still pulls the pages the thread is actually about.
      const query = buildRetrievalQuery(messages);
      this.setStatus(t("status.readingVaultContext"));
      const index = await readTextFile(this.app, this.settings.indexPath);
      const pagePaths = this.listWikiContentPages();
      const selectedPaths = await this.selectRelevantPages(index, query, pagePaths);
      const wikiPages = await readWikiPages(this.app, selectedPaths);
      this.setStatus(t("status.waitingModel"));
      const provider = this.createProvider();
      // Wiki context rides in the system message so the conversation array stays a clean sequence
      // of alternating user/assistant turns (no synthetic user turn before the real question).
      const systemContent = `${buildChatSystemPrompt(this.settings)}\n\n${buildChatContextMessage({ index, wikiPages }, this.settings)}`;
      return await provider.chat({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        messages: [
          { role: "system", content: systemContent },
          ...messages.slice(-CHAT_HISTORY_MAX_MESSAGES)
        ]
      });
    } catch (error) {
      throw new Error(formatOpenAIErrorMessage(error, t("error.requestFailed")));
    } finally {
      this.answerChatInFlight--;
      // Only clear the status bar when no other chat turn is still running.
      if (this.answerChatInFlight === 0) this.setStatus(t("status.idle"));
    }
  }

  // ChatController: file a finished Q&A back through the reviewed change-plan pipeline.
  async saveChatAnswer(question: string, answer: string): Promise<void> {
    if (!this.settings.openAIApiKey) {
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }
    try {
      this.setStatus(t("status.readingVaultContext"));
      const index = await readTextFile(this.app, this.settings.indexPath);
      const pagePaths = this.listWikiContentPages();
      const selectedPaths = await this.selectRelevantPages(index, question, pagePaths);
      const wikiPages = await readWikiPages(this.app, selectedPaths);
      const prompt = buildQueryPrompt({
        index,
        log: await readTextFile(this.app, this.settings.logPath),
        question,
        answer,
        wikiPages
      }, this.settings);
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
  private async selectRelevantPages(index: string, question: string, pagePaths: string[]): Promise<string[]> {
    if (pagePaths.length <= QUERY_MAX_PAGES) return pagePaths;
    const selectingMessage = t("status.selectingPages");
    this.setStatus(selectingMessage);
    new Notice(selectingMessage);
    const provider = this.createProvider();
    const response = await provider.complete({
      apiKey: this.settings.openAIApiKey,
      apiUrl: this.settings.openAIApiUrl,
      model: this.settings.openAIModel,
      prompt: buildQuerySelectionPrompt({ index, question, pagePaths }, this.settings)
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
    const prompt = buildLintPrompt({
      index: await readTextFile(this.app, this.settings.indexPath),
      log: await readTextFile(this.app, this.settings.logPath),
      wikiPages,
      rawPaths
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
      const provider = this.createProvider();
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
      // Destructive plans always go through review even when auto-ingest would otherwise apply
      // automatically (single source of truth: planHasDestructiveOperation).
      if (autoApply && !planHasDestructiveOperation(plan)) {
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
