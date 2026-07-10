import { App, ItemView, MarkdownRenderer, Modal, Notice, Setting, WorkspaceLeaf, setIcon } from "obsidian";
import { t } from "./i18n";

export const CHAT_VIEW_TYPE = "contextos-chat";

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// The full multi-conversation store. Owned by the plugin (so it survives the leaf closing and is
// persisted to disk); the view reads it on open and writes it back through the controller.
export interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
}

// Narrow seam between the view (UI only) and the plugin (settings/provider/vault/persistence). The
// plugin implements this structurally so the view can be unit-tested with a fake controller.
export interface ChatController {
  answerChat(messages: ChatMessage[], onToken?: (token: string) => void): Promise<string>;
  saveChatAnswer(question: string, answer: string): Promise<void>;
  hasApiKey(): boolean;
  setStatus(message: string): void;
  loadChatState(): ChatState;
  saveChatState(state: ChatState): void;
}

// Starter prompts shown on the empty state. Kept generic because the wiki's contents are unknown.
const SUGGESTION_KEYS = [
  "chat.suggestion.summary",
  "chat.suggestion.topics",
  "chat.suggestion.connections"
] as const;

const INPUT_MAX_HEIGHT_PX = 200;
const TITLE_MAX_LEN = 48;

function createConversationId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?(): string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function deriveTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= TITLE_MAX_LEN ? oneLine : `${oneLine.slice(0, TITLE_MAX_LEN - 1)}…`;
}

export class ChatView extends ItemView {
  private conversations: Conversation[] = [];
  private activeId: string | null = null;
  private historyOpen = false;
  // Conversation ids with an in-flight reply. Per-conversation (not a single view-wide flag) so
  // starting or using another chat is never blocked by a request still running elsewhere.
  private pending = new Set<string>();

  private listEl!: HTMLElement;
  private historyEl!: HTMLElement;
  private composerEl!: HTMLElement;
  private titleEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private thinkingEl?: HTMLElement;
  private emptyEl?: HTMLElement;
  // Elements added directly to the message list / history panel. Cleared by detaching each one
  // (rather than emptying the container) so the header and composer survive a re-render.
  private rowEls: HTMLElement[] = [];
  private historyRowEls: HTMLElement[] = [];
  // Set once onClose runs so async continuations (a reply that lands after the leaf is closed, a
  // Markdown render, a copy-reset timer) don't touch the torn-down view.
  private closed = false;

  constructor(leaf: WorkspaceLeaf, private readonly controller: ChatController) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return t("chat.viewTitle");
  }

  getIcon(): string {
    return "message-circle";
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    this.loadState();

    const root = this.contentEl;
    root.empty();
    root.addClass("contextos-chat");
    // A few layout-critical styles inline so the panel is usable before styles.css loads.
    this.applyStyles(root, { display: "flex", "flex-direction": "column", height: "100%", padding: "0" });

    this.renderHeader(root);

    this.listEl = root.createDiv();
    this.listEl.addClass("contextos-chat-messages");
    this.applyStyles(this.listEl, { flex: "1", overflow: "auto" });

    this.historyEl = root.createDiv();
    this.historyEl.addClass("contextos-chat-history");
    this.applyStyles(this.historyEl, { flex: "1", overflow: "auto" });

    this.renderComposer(root);

    this.applyHistoryVisibility();
    this.renderActive();
    this.inputEl.focus();
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.contentEl.empty();
  }

  // ---- conversation store ---------------------------------------------------

  private loadState(): void {
    const state = this.controller.loadChatState();
    this.conversations = Array.isArray(state?.conversations) ? state.conversations : [];
    this.activeId = state?.activeId ?? null;
    if (!this.activeConversation()) this.activeId = this.conversations[0]?.id ?? null;
  }

  private persist(): void {
    this.controller.saveChatState({ conversations: this.conversations, activeId: this.activeId });
  }

  private activeConversation(): Conversation | undefined {
    return this.conversations.find((conversation) => conversation.id === this.activeId);
  }

  private activeMessages(): ChatMessage[] {
    return this.activeConversation()?.messages ?? [];
  }

  private createConversation(): Conversation {
    const now = Date.now();
    const conversation: Conversation = { id: createConversationId(), title: "", messages: [], createdAt: now, updatedAt: now };
    this.conversations.unshift(conversation);
    this.activeId = conversation.id;
    return conversation;
  }

  private ensureActiveConversation(): Conversation {
    return this.activeConversation() ?? this.createConversation();
  }

  // ---- header --------------------------------------------------------------

  private renderHeader(root: HTMLElement): void {
    const header = root.createDiv();
    header.addClass("contextos-chat-header");

    const historyButton = header.createEl("button");
    historyButton.addClass("contextos-chat-iconbtn");
    historyButton.addClass("contextos-chat-history-toggle");
    setIcon(historyButton, "history");
    historyButton.setAttr("aria-label", t("chat.conversations"));
    historyButton.setAttr("title", t("chat.conversations"));
    historyButton.onclick = () => this.toggleHistory();

    const heading = header.createDiv();
    heading.addClass("contextos-chat-heading");
    this.titleEl = heading.createEl("div");
    this.titleEl.addClass("contextos-chat-title");
    const subtitle = heading.createEl("div", { text: t("chat.subtitle") });
    subtitle.addClass("contextos-chat-subtitle");

    const newChat = header.createEl("button");
    newChat.addClass("contextos-chat-iconbtn");
    newChat.addClass("contextos-chat-newchat");
    setIcon(newChat, "plus");
    newChat.setAttr("aria-label", t("chat.newChat"));
    newChat.setAttr("title", t("chat.newChat"));
    newChat.onclick = () => this.startNewChat();

    this.updateHeaderTitle();
  }

  private updateHeaderTitle(): void {
    const conversation = this.activeConversation();
    this.titleEl.setText(conversation && conversation.title ? conversation.title : t("chat.viewTitle"));
  }

  // ---- history panel -------------------------------------------------------

  private toggleHistory(): void {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) this.renderHistory();
    this.applyHistoryVisibility();
  }

  private applyHistoryVisibility(): void {
    this.historyEl.style.setProperty("display", this.historyOpen ? "flex" : "none");
    this.listEl.style.setProperty("display", this.historyOpen ? "none" : "flex");
    this.composerEl.style.setProperty("display", this.historyOpen ? "none" : "block");
  }

  private renderHistory(): void {
    for (const el of this.historyRowEls) el.remove();
    this.historyRowEls = [];

    if (this.conversations.length === 0) {
      const empty = this.historyEl.createEl("div", { text: t("chat.historyEmpty") });
      empty.addClass("contextos-chat-history-empty");
      this.historyRowEls.push(empty);
      return;
    }

    // `|| 0` keeps a missing/NaN timestamp from producing NaN comparisons and unstable ordering.
    const ordered = [...this.conversations].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const conversation of ordered) {
      const row = this.historyEl.createDiv();
      row.addClass("contextos-chat-history-item-row");
      if (conversation.id === this.activeId) row.addClass("is-active");
      this.historyRowEls.push(row);

      const item = row.createEl("button", { text: conversation.title || t("chat.conversationUntitled") });
      item.addClass("contextos-chat-history-item");
      item.onclick = () => this.switchConversation(conversation.id);

      const rename = row.createEl("button");
      rename.addClass("contextos-chat-history-action");
      rename.addClass("contextos-chat-history-rename");
      setIcon(rename, "pencil");
      rename.setAttr("aria-label", t("chat.renameConversation"));
      rename.setAttr("title", t("chat.renameConversation"));
      rename.onclick = () => this.renameConversation(conversation.id);

      const del = row.createEl("button");
      del.addClass("contextos-chat-history-action");
      del.addClass("contextos-chat-history-delete");
      setIcon(del, "trash-2");
      del.setAttr("aria-label", t("chat.deleteConversation"));
      del.setAttr("title", t("chat.deleteConversation"));
      del.onclick = () => this.confirmDeleteConversation(conversation.id);
    }
  }

  private renameConversation(id: string): void {
    const conversation = this.conversations.find((candidate) => candidate.id === id);
    if (!conversation) return;
    new RenameConversationModal(this.app, conversation.title, (title) => {
      if (title === null) return; // cancelled or empty
      conversation.title = title;
      this.persist();
      this.renderHistory();
      this.updateHeaderTitle();
    }).open();
  }

  private confirmDeleteConversation(id: string): void {
    const conversation = this.conversations.find((candidate) => candidate.id === id);
    if (!conversation) return;
    const label = conversation.title || t("chat.conversationUntitled");
    new ConfirmModal(this.app, t("chat.deleteConfirm", { title: label }), (confirmed) => {
      if (confirmed) this.deleteConversation(id);
    }).open();
  }

  private switchConversation(id: string): void {
    if (id === this.activeId && !this.historyOpen) return;
    this.activeId = id;
    this.historyOpen = false;
    this.applyHistoryVisibility();
    // Drop any unsent draft so it does not leak into the conversation being opened.
    this.inputEl.value = "";
    this.autoGrow();
    this.renderActive();
    this.persist();
    this.inputEl.focus();
  }

  private deleteConversation(id: string): void {
    this.conversations = this.conversations.filter((conversation) => conversation.id !== id);
    if (this.activeId === id) this.activeId = this.conversations[0]?.id ?? null;
    this.persist();
    this.renderHistory();
    this.renderActive();
  }

  // ---- conversation rendering ----------------------------------------------

  private renderActive(): void {
    this.updateHeaderTitle();
    this.renderConversation();
    this.updateComposerState();
  }

  private renderConversation(): void {
    this.clearRows();
    const messages = this.activeMessages();
    if (messages.length === 0) {
      this.renderEmptyState();
    } else {
      messages.forEach((message, index) => this.renderMessage(message, index));
    }
    // Re-show the thinking indicator when opening a conversation that is still awaiting a reply.
    if (this.isActivePending()) this.showThinking();
  }

  private clearRows(): void {
    for (const el of this.rowEls) el.remove();
    this.rowEls = [];
    this.thinkingEl = undefined;
    this.emptyEl = undefined;
  }

  private detachRow(el: HTMLElement | undefined): void {
    if (!el) return;
    el.remove();
    this.rowEls = this.rowEls.filter((tracked) => tracked !== el);
  }

  private renderEmptyState(): void {
    const empty = this.listEl.createDiv();
    empty.addClass("contextos-chat-empty");
    this.rowEls.push(empty);
    this.emptyEl = empty;

    const badge = empty.createDiv();
    badge.addClass("contextos-chat-empty-icon");
    setIcon(badge, "message-circle");

    const title = empty.createEl("div", { text: t("chat.emptyTitle") });
    title.addClass("contextos-chat-empty-title");
    const subtitle = empty.createEl("div", { text: t("chat.emptyState") });
    subtitle.addClass("contextos-chat-empty-subtitle");

    const label = empty.createEl("div", { text: t("chat.suggestionsLabel") });
    label.addClass("contextos-chat-suggestions-label");

    const suggestions = empty.createDiv();
    suggestions.addClass("contextos-chat-suggestions");
    for (const key of SUGGESTION_KEYS) {
      const text = t(key);
      const chip = suggestions.createEl("button", { text });
      chip.addClass("contextos-chat-suggestion");
      chip.onclick = () => this.useSuggestion(text);
    }
  }

  private useSuggestion(text: string): void {
    if (this.isActivePending()) return;
    this.inputEl.value = text;
    this.autoGrow();
    this.updateComposerState();
    void this.handleSend();
  }

  private renderMessage(message: ChatMessage, index: number): void {
    const row = this.listEl.createDiv();
    this.rowEls.push(row);
    row.addClass("contextos-chat-message");
    row.addClass(`contextos-chat-message-${message.role}`);

    if (message.role === "assistant") {
      const avatar = row.createDiv();
      avatar.addClass("contextos-chat-avatar");
      setIcon(avatar, "sparkles");
    }

    const main = row.createDiv();
    main.addClass("contextos-chat-main");

    if (message.role === "assistant") {
      const name = main.createEl("div", { text: t("chat.assistant") });
      name.addClass("contextos-chat-name");
    }

    const body = main.createDiv();
    body.addClass("contextos-chat-body");
    if (message.role === "assistant") {
      // Render assistant replies as Markdown so citations, code, lists, and [[wiki links]] render.
      // Fall back to plain text if rendering rejects, and guard the scroll against a closed view.
      void MarkdownRenderer.render(this.app, message.content, body, "", this)
        .then(() => { if (!this.closed) this.scrollToBottom(); })
        .catch(() => { if (!this.closed) body.setText(message.content); });
    } else {
      // User text stays literal (no accidental Markdown execution); CSS preserves its whitespace.
      body.setText(message.content);
    }

    if (message.role === "assistant") {
      const actions = main.createDiv();
      actions.addClass("contextos-chat-actions");

      const copyButton = actions.createEl("button");
      copyButton.addClass("contextos-chat-actionbtn");
      copyButton.addClass("contextos-chat-copy");
      setIcon(copyButton, "copy");
      copyButton.setAttr("aria-label", t("chat.copy"));
      copyButton.setAttr("title", t("chat.copy"));
      copyButton.onclick = () => this.handleCopy(message.content, copyButton);

      const saveButton = actions.createEl("button");
      saveButton.addClass("contextos-chat-actionbtn");
      saveButton.addClass("contextos-chat-save");
      setIcon(saveButton, "save");
      saveButton.setAttr("aria-label", t("chat.saveToWiki"));
      saveButton.setAttr("title", t("chat.saveToWiki"));
      const question = this.previousUserMessage(index);
      saveButton.onclick = () => this.handleSave(question, message.content, saveButton);
    }

    this.scrollToBottom();
  }

  private previousUserMessage(assistantIndex: number): string {
    const messages = this.activeMessages();
    for (let index = assistantIndex - 1; index >= 0; index--) {
      if (messages[index].role === "user") return messages[index].content;
    }
    return "";
  }

  // ---- sending -------------------------------------------------------------

  private async handleSend(): Promise<void> {
    const text = (this.inputEl.value ?? "").trim();
    if (!text) return;
    if (!this.controller.hasApiKey()) {
      new Notice(t("notice.missingOpenAIKey"));
      return;
    }

    const conversation = this.ensureActiveConversation();
    const sendConvId = conversation.id;
    if (this.pending.has(sendConvId)) return; // already awaiting a reply in this conversation

    this.clearEmptyState();
    const userMessage: ChatMessage = { role: "user", content: text };
    conversation.messages.push(userMessage);
    if (!conversation.title) conversation.title = deriveTitle(text);
    conversation.updatedAt = Date.now();
    this.updateHeaderTitle();
    this.renderMessage(userMessage, conversation.messages.length - 1);
    this.inputEl.value = "";
    this.autoGrow();
    this.persist();

    this.pending.add(sendConvId);
    this.updateComposerState();
    const streamBubble = this.createStreamingBubble();
    let streamedText = "";
    try {
      const reply = await this.controller.answerChat([...conversation.messages], (token) => {
        streamedText += token;
        if (!this.closed && this.activeId === sendConvId) {
          this.updateStreamingBubbleText(streamBubble, streamedText);
        }
      });
      this.pending.delete(sendConvId);
      const target = this.conversations.find((c) => c.id === sendConvId);
      const assistantMessage: ChatMessage = { role: "assistant", content: reply };
      // Store the reply on its own conversation even if the leaf closed or the user switched away,
      // so it is persisted and shown whenever that conversation is next viewed.
      if (target) {
        target.messages.push(assistantMessage);
        target.updatedAt = Date.now();
        this.persist();
      }
      if (!this.closed && this.activeId === sendConvId && target) {
        this.finalizeStreamingBubble(streamBubble, reply, sendConvId);
      }
    } catch (error) {
      this.pending.delete(sendConvId);
      const target = this.conversations.find((c) => c.id === sendConvId);
      // Roll the failed turn out of that conversation so a retry does not send two user turns.
      if (target && target.messages[target.messages.length - 1]?.role === "user") {
        target.messages.pop();
        if (target.messages.length === 0) target.title = "";
        this.persist();
      }
      const message = error instanceof Error ? error.message : t("error.requestFailed");
      // Surface the failure even when the user has switched to another conversation, so a
      // background turn never fails silently.
      new Notice(message);
      this.detachRow(streamBubble.row);
      if (!this.closed && this.activeId === sendConvId) {
        // Re-render so the rolled-back user bubble and cleared title match the persisted state,
        // then show the error inline (pending was already cleared, so no thinking indicator).
        this.renderActive();
        this.renderError(message);
      }
    } finally {
      this.pending.delete(sendConvId);
      if (!this.closed) {
        this.updateComposerState();
        if (this.historyOpen) this.renderHistory(); // reflect updated titles/order for background turns
        if (this.activeId === sendConvId) this.inputEl.focus();
      }
    }
  }

  private async handleSave(question: string, answer: string, button: HTMLButtonElement): Promise<void> {
    button.disabled = true;
    try {
      // Opens the reviewed ChangePlanPreviewModal; chat itself performs no vault writes.
      await this.controller.saveChatAnswer(question, answer);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("error.requestFailed"));
    } finally {
      button.disabled = false;
    }
  }

  private async handleCopy(text: string, button: HTMLButtonElement): Promise<void> {
    const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?(value: string): Promise<void> } } })
      .navigator?.clipboard;
    if (!clipboard?.writeText) return;
    try {
      await clipboard.writeText(text);
      setIcon(button, "check");
      button.addClass("is-copied");
      button.setAttr("aria-label", t("chat.copied"));
      button.setAttr("title", t("chat.copied"));
      setTimeout(() => {
        if (this.closed) return; // view torn down before the icon reset fired
        setIcon(button, "copy");
        button.removeClass("is-copied");
        button.setAttr("aria-label", t("chat.copy"));
        button.setAttr("title", t("chat.copy"));
      }, 1200);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : t("error.requestFailed"));
    }
  }

  private startNewChat(): void {
    // Not blocked while another conversation is awaiting a reply — that request keeps running in
    // the background and its answer lands in its own conversation.
    // Reuse the current conversation if it is already empty, so New chat is idempotent.
    const active = this.activeConversation();
    if (!active || active.messages.length > 0) this.createConversation();
    this.historyOpen = false;
    this.applyHistoryVisibility();
    this.inputEl.value = "";
    this.autoGrow();
    this.renderActive();
    this.persist();
    this.inputEl.focus();
  }

  private isActivePending(): boolean {
    return this.activeId !== null && this.pending.has(this.activeId);
  }

  // The composer reflects only the ACTIVE conversation: it is disabled while that conversation is
  // awaiting a reply, and enabled for any other (including a freshly started) conversation.
  private updateComposerState(): void {
    const pending = this.isActivePending();
    this.inputEl.disabled = pending;
    const hasText = (this.inputEl.value ?? "").trim().length > 0;
    const disabled = pending || !hasText;
    this.sendButton.disabled = disabled;
    if (disabled) this.sendButton.addClass("is-disabled");
    else this.sendButton.removeClass("is-disabled");
  }

  private autoGrow(): void {
    const el = this.inputEl;
    // Clear the inline height first so scrollHeight reflects the content (enables shrinking), then
    // set it to the clamped content height. removeProperty avoids a static string literal (which
    // Obsidian's no-static-styles-assignment lint forbids); the px value is a dynamic expression.
    el.style.removeProperty("height");
    // scrollHeight is unavailable in the test DOM; skip the resize there.
    const scrollHeight = (el as unknown as { scrollHeight?: number }).scrollHeight;
    if (typeof scrollHeight === "number") {
      el.style.setProperty("height", `${Math.min(scrollHeight, INPUT_MAX_HEIGHT_PX)}px`);
    }
  }

  private renderComposer(root: HTMLElement): void {
    const composer = root.createDiv();
    composer.addClass("contextos-chat-composer");
    this.composerEl = composer;

    const inputWrap = composer.createDiv();
    inputWrap.addClass("contextos-chat-inputwrap");

    this.inputEl = inputWrap.createEl("textarea");
    this.inputEl.addClass("contextos-chat-input");
    this.inputEl.placeholder = t("chat.inputPlaceholder");
    this.inputEl.rows = 1;
    this.applyStyles(this.inputEl, { resize: "none" });
    this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
      // Enter sends; Shift+Enter inserts a newline.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.handleSend();
      }
    });
    this.inputEl.addEventListener("input", () => {
      this.autoGrow();
      this.updateComposerState();
    });

    this.sendButton = inputWrap.createEl("button");
    this.sendButton.addClass("contextos-chat-iconbtn");
    this.sendButton.addClass("contextos-chat-send");
    setIcon(this.sendButton, "arrow-up");
    this.sendButton.setAttr("aria-label", t("chat.send"));
    this.sendButton.setAttr("title", t("chat.send"));
    // handleSend never rejects (try/catch/finally), so returning the promise is safe and lets the
    // send path be awaited directly in tests.
    this.sendButton.onclick = () => this.handleSend();

    const hint = composer.createEl("div", { text: t("chat.inputHint") });
    hint.addClass("contextos-chat-hint");
  }

  private showThinking(): void {
    const row = this.listEl.createDiv();
    this.rowEls.push(row);
    row.addClass("contextos-chat-message");
    row.addClass("contextos-chat-message-assistant");

    const avatar = row.createDiv();
    avatar.addClass("contextos-chat-avatar");
    setIcon(avatar, "sparkles");

    const main = row.createDiv();
    main.addClass("contextos-chat-main");
    const dots = main.createDiv();
    dots.addClass("contextos-chat-thinking");
    dots.setAttr("aria-label", t("chat.thinking"));
    for (let index = 0; index < 3; index++) {
      dots.createSpan().addClass("contextos-chat-dot");
    }

    this.thinkingEl = row;
    this.scrollToBottom();
  }

  private hideThinking(): void {
    this.detachRow(this.thinkingEl);
    this.thinkingEl = undefined;
  }

  private createStreamingBubble(): { row: HTMLElement; body: HTMLElement; streamEl: HTMLElement } {
    const row = this.listEl.createDiv();
    this.rowEls.push(row);
    row.addClass("contextos-chat-message");
    row.addClass("contextos-chat-message-assistant");

    const avatar = row.createDiv();
    avatar.addClass("contextos-chat-avatar");
    setIcon(avatar, "sparkles");

    const main = row.createDiv();
    main.addClass("contextos-chat-main");

    const name = main.createEl("div", { text: t("chat.assistant") });
    name.addClass("contextos-chat-name");

    const body = main.createDiv();
    body.addClass("contextos-chat-body");

    const streamEl = body.createDiv();
    const thinking = streamEl.createDiv();
    thinking.addClass("contextos-chat-thinking");
    thinking.setAttr("aria-label", t("chat.thinking"));
    for (let i = 0; i < 3; i++) {
      thinking.createSpan().addClass("contextos-chat-dot");
    }

    this.scrollToBottom();
    return { row, body, streamEl };
  }

  private updateStreamingBubbleText(bubble: { streamEl: HTMLElement }, text: string): void {
    bubble.streamEl.setText(text);
    this.scrollToBottomIfAtBottom();
  }

  private finalizeStreamingBubble(bubble: { row: HTMLElement; body: HTMLElement; streamEl: HTMLElement }, fullText: string, convId: string): void {
    bubble.streamEl.remove();
    const body = bubble.body;
    void MarkdownRenderer.render(this.app, fullText, body, "", this)
      .then(() => { if (!this.closed) this.scrollToBottom(); })
      .catch(() => { if (!this.closed) body.setText(fullText); });

    const main = body.parentElement!;
    const actions = main.createDiv();
    actions.addClass("contextos-chat-actions");

    const copyButton = actions.createEl("button");
    copyButton.addClass("contextos-chat-actionbtn");
    copyButton.addClass("contextos-chat-copy");
    setIcon(copyButton, "copy");
    copyButton.setAttr("aria-label", t("chat.copy"));
    copyButton.setAttr("title", t("chat.copy"));
    copyButton.onclick = () => this.handleCopy(fullText, copyButton);

    const saveButton = actions.createEl("button");
    saveButton.addClass("contextos-chat-actionbtn");
    saveButton.addClass("contextos-chat-save");
    setIcon(saveButton, "save");
    saveButton.setAttr("aria-label", t("chat.saveToWiki"));
    saveButton.setAttr("title", t("chat.saveToWiki"));
    const question = this.activeUserMessageForConv(convId);
    saveButton.onclick = () => this.handleSave(question, fullText, saveButton);
  }

  private activeUserMessageForConv(convId: string): string {
    const conversation = this.conversations.find((c) => c.id === convId);
    if (!conversation) return "";
    const messages = conversation.messages;
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index].role === "user") return messages[index].content;
    }
    return "";
  }

  private scrollToBottomIfAtBottom(): void {
    const el = this.listEl;
    if (el.scrollTop + el.clientHeight + 50 >= el.scrollHeight) {
      el.scrollTop = el.scrollHeight;
    }
  }

  private renderError(message: string): void {
    const error = this.listEl.createDiv();
    this.rowEls.push(error);
    error.addClass("contextos-chat-error");
    error.setText(message);
    this.scrollToBottom();
  }

  private clearEmptyState(): void {
    this.detachRow(this.emptyEl);
    this.emptyEl = undefined;
  }

  private scrollToBottom(): void {
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  private applyStyles(element: HTMLElement, styles: Record<string, string>): void {
    for (const [name, value] of Object.entries(styles)) {
      element.style.setProperty(name, value);
    }
  }
}

// Electron has no window.prompt/confirm, so renaming and delete-confirmation go through Modals.
// Both settle exactly once (guarded) and treat a bare dismiss as cancel.
class RenameConversationModal extends Modal {
  private value: string;
  private settled = false;

  constructor(app: App, private readonly initial: string, private readonly onResult: (title: string | null) => void) {
    super(app);
    this.value = initial;
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: t("chat.renameConversation") });
    new Setting(this.contentEl).addText((text) => {
      text.setValue(this.initial);
      text.onChange((value) => { this.value = value; });
      const inputEl = text.inputEl as HTMLInputElement;
      inputEl.addEventListener?.("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.settle(this.value);
        }
      });
      setTimeout(() => inputEl.focus?.(), 0);
    });
    new Setting(this.contentEl).addButton((button) => {
      button.setButtonText(t("chat.rename"));
      button.setCta?.();
      button.onClick(() => this.settle(this.value));
    });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(null, true);
  }

  private settle(title: string | null, fromClose = false): void {
    if (this.settled) return;
    this.settled = true;
    if (!fromClose) this.close();
    const trimmed = title === null ? "" : title.trim();
    this.onResult(trimmed.length > 0 ? trimmed : null);
  }
}

class ConfirmModal extends Modal {
  private settled = false;

  constructor(app: App, private readonly message: string, private readonly onResult: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(t("chat.delete"));
        button.setWarning?.();
        button.onClick(() => this.settle(true));
      })
      .addButton((button) => {
        button.setButtonText(t("chat.cancel"));
        button.onClick(() => this.settle(false));
      });
  }

  onClose(): void {
    this.contentEl.empty();
    this.settle(false, true);
  }

  private settle(confirmed: boolean, fromClose = false): void {
    if (this.settled) return;
    this.settled = true;
    if (!fromClose) this.close();
    this.onResult(confirmed);
  }
}
