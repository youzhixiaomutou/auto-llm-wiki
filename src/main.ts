import { Notice, Plugin, TFile } from "obsidian";
import { parseChangePlan, validateChangePlan } from "./changePlan";
import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt } from "./prompts";
import { OpenAIProvider } from "./providers/OpenAIProvider";
import { ChangePlanPreviewModal } from "./previewModal";
import { findChangedRawFiles, RawFileState, updateRawFileState } from "./rawTracker";
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
    this.setStatus("LLM Wiki: idle");
    this.addSettingTab(new LLMWikiSettingTab(this.app, this));

    this.addCommand({
      id: "ingest-active-source",
      name: "Ingest active source into LLM Wiki",
      callback: () => this.ingestActiveSource()
    });

    this.addCommand({
      id: "query-wiki",
      name: "Query LLM Wiki",
      callback: () => this.queryWiki()
    });

    this.addCommand({
      id: "lint-wiki",
      name: "Lint LLM Wiki",
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
    this.setStatus("LLM Wiki: scanning raw folder for changes...");
    new Notice("LLM Wiki: scanning raw folder for changes...");
    const changedRawFiles = await findChangedRawFiles(this.app, this.settings, this.rawFileState);
    if (changedRawFiles.length === 0) {
      this.setStatus("LLM Wiki: no raw changes");
      new Notice("LLM Wiki: no new or changed raw files.");
      return;
    }

    this.setStatus("LLM Wiki: reading vault context...");
    new Notice("LLM Wiki: reading vault context...");
    const prompt = buildIngestPrompt({
      index: await readTextFile(this.app, this.settings.indexPath),
      log: await readTextFile(this.app, this.settings.logPath),
      sources: changedRawFiles.map((file) => ({ path: file.path, content: file.content }))
    }, this.settings);
    await this.runPrompt(prompt, async () => {
      this.rawFileState = updateRawFileState(this.rawFileState, changedRawFiles);
      await this.saveSettings();
    });
  }

  private async queryWiki(): Promise<void> {
    const question = window.prompt("Ask the LLM Wiki a question");
    if (!question) return;
    this.setStatus("LLM Wiki: reading vault context...");
    new Notice("LLM Wiki: reading vault context...");
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
    this.setStatus("LLM Wiki: reading vault context...");
    new Notice("LLM Wiki: reading vault context...");
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
      new Notice("Set your OpenAI API key in Obsidian LLM Wiki settings.");
      return;
    }
    try {
      this.setStatus("LLM Wiki: waiting for model response...");
      new Notice("LLM Wiki: waiting for model response...");
      const provider = new OpenAIProvider();
      const response = await provider.complete({
        apiKey: this.settings.openAIApiKey,
        apiUrl: this.settings.openAIApiUrl,
        model: this.settings.openAIModel,
        prompt
      });
      this.setStatus("LLM Wiki: validating proposed changes...");
      new Notice("LLM Wiki: validating proposed changes...");
      const plan = validateChangePlan(parseChangePlan(response), this.settings);
      this.setStatus("LLM Wiki: review proposed changes");
      new Notice("LLM Wiki: review proposed changes.");
      new ChangePlanPreviewModal(this.app, plan, (message) => this.setStatus(message), onApplySuccess).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM Wiki request failed.";
      this.setStatus(`LLM Wiki: error - ${message}`);
      new Notice(message);
    }
  }
}
