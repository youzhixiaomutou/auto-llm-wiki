import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import LLMWikiPlugin from "./main";
import { t } from "./i18n";
import { OpenAIProvider, OpenAIProviderError } from "./providers/OpenAIProvider";
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
  openAIModel: "gpt-4.1-mini",
  autoIngestEnabled: false,
  autoIngestDebounceMs: 3000
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
    containerEl.createEl("h2", { text: t("settings.title") });

    this.addTextSetting(t("settings.rawFolder.name"), t("settings.rawFolder.desc"), "rawFolder");
    this.addTextSetting(t("settings.wikiFolder.name"), t("settings.wikiFolder.desc"), "wikiFolder");
    this.addTextSetting(t("settings.assetsFolder.name"), t("settings.assetsFolder.desc"), "assetsFolder");
    this.addTextSetting(t("settings.indexPath.name"), t("settings.indexPath.desc"), "indexPath");
    this.addTextSetting(t("settings.logPath.name"), t("settings.logPath.desc"), "logPath");
    this.addTextSetting(t("settings.openAIApiUrl.name"), t("settings.openAIApiUrl.desc"), "openAIApiUrl");
    this.addTextSetting(t("settings.openAIApiKey.name"), t("settings.openAIApiKey.desc"), "openAIApiKey", true);
    this.addTextSetting(t("settings.openAIModel.name"), t("settings.openAIModel.desc"), "openAIModel");
    this.addToggleSetting(t("settings.autoIngestEnabled.name"), t("settings.autoIngestEnabled.desc"), "autoIngestEnabled");
    this.addOpenAIConnectionTest();
  }

  private addOpenAIConnectionTest(): void {
    new Setting(this.containerEl)
      .setName(t("settings.testConnection.name"))
      .setDesc(t("settings.testConnection.desc"))
      .addButton((button) => {
        button.setButtonText(t("settings.testConnection.name"));
        button.onClick(async () => {
          button.setDisabled(true);
          try {
            await new OpenAIProvider().testConnection({
              apiKey: this.plugin.settings.openAIApiKey,
              apiUrl: this.plugin.settings.openAIApiUrl,
              model: this.plugin.settings.openAIModel
            });
            new Notice(t("notice.openAIConnectionSucceeded"));
          } catch (error) {
            const message = error instanceof OpenAIProviderError && error.kind === "connection"
              ? error.message
              : error instanceof Error
                ? error.message
                : t("error.unknown");
            new Notice(t("notice.openAIConnectionFailed", { message }));
          } finally {
            button.setDisabled(false);
          }
        });
      });
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

  private addToggleSetting(name: string, desc: string, key: keyof Pick<LLMWikiSettings, "autoIngestEnabled">): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) => {
        toggle.setValue(Boolean(this.plugin.settings[key]));
        toggle.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, [key]: value };
          if (value) this.plugin.enableAutoIngestListeners();
          await this.plugin.saveSettings();
        });
      });
  }
}
