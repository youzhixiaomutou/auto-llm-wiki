import { App, PluginSettingTab, Setting } from "obsidian";
import LLMWikiPlugin from "./main";
import { LLMWikiSettings } from "./types";

export const DEFAULT_SETTINGS: LLMWikiSettings = {
  rawFolder: "raw",
  wikiFolder: "wiki",
  assetsFolder: "raw/assets",
  indexPath: "wiki/index.md",
  logPath: "wiki/log.md",
  provider: "openai",
  openAIApiUrl: "https://api.openai.com/v1/chat/completions",
  openAIApiKey: "",
  openAIModel: "gpt-4.1-mini"
};

export class LLMWikiSettingTab extends PluginSettingTab {
  plugin: LLMWikiPlugin;

  constructor(app: App, plugin: LLMWikiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian LLM Wiki" });

    this.addTextSetting("Raw folder", "Immutable source documents.", "rawFolder");
    this.addTextSetting("Wiki folder", "LLM-maintained markdown pages.", "wikiFolder");
    this.addTextSetting("Assets folder", "Local attachments for raw sources.", "assetsFolder");
    this.addTextSetting("Index path", "Content-oriented wiki index.", "indexPath");
    this.addTextSetting("Log path", "Chronological wiki operation log.", "logPath");
    this.addTextSetting("OpenAI API URL", "Chat completions endpoint URL.", "openAIApiUrl");
    this.addTextSetting("OpenAI API key", "Stored in Obsidian plugin data.", "openAIApiKey", true);
    this.addTextSetting("OpenAI model", "Model used for wiki maintenance.", "openAIModel");
  }

  private addTextSetting(
    name: string,
    desc: string,
    key: keyof LLMWikiSettings,
    secret = false
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.setValue(String(this.plugin.settings[key]));
        if (secret) text.inputEl.type = "password";
        text.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, [key]: value };
          await this.plugin.saveSettings();
        });
      });
  }
}
