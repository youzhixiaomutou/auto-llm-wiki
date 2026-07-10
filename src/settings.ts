import { App, Notice, PluginSettingTab, Setting, setIcon } from "obsidian";
import LLMWikiPlugin from "./main";
import { t } from "./i18n";
import { OpenAIProvider, OpenAIProviderError } from "./providers/OpenAIProvider";
import { providerRegistry } from "./providers/ProviderRegistry";
import { LLMWikiSettings, ProviderConfig, LLMProviderType, LLM_PROVIDER_TYPES } from "./types";

const DEFAULT_PROVIDER_ID = "default-openai";

const DEFAULT_API_URLS: Record<LLMProviderType, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
  ollama: "http://localhost:11434/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  "openai-compatible": "https://api.openai.com/v1/chat/completions"
};

export const DEFAULT_SETTINGS: LLMWikiSettings = {
  rawFolder: "raw",
  wikiFolder: "wiki",
  assetsFolder: "raw/assets",
  indexPath: "wiki/index.md",
  logPath: "wiki/log.md",
  openAIApiUrl: "https://api.openai.com/v1/chat/completions",
  openAIApiKey: "",
  openAIModel: "gpt-4.1-mini",
  providers: [{
    id: DEFAULT_PROVIDER_ID,
    type: "openai",
    name: "OpenAI",
    apiKey: "",
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4.1-mini",
    enabled: true
  }],
  activeProviderId: DEFAULT_PROVIDER_ID,
  textProviderId: "",
  chatProviderId: "",
  visionProviderId: "",
  autoIngestEnabled: false,
  autoIngestDebounceMs: 3000,
  autoIngestPollSeconds: 15,
  requestTimeoutMs: 900000,
  ingestSystemPrompt: "",
  chatSystemPrompt: "",
  lintSystemPrompt: "",
  ocrPdfPrompt: "",
  ocrImagePrompt: "",
  ocrPageConcurrency: 3,
  embeddingsBackend: "none",
  embeddingsModel: "mxbai-embed-large",
  embeddingsApiKey: "",
  embeddingsApiUrl: "http://localhost:11434/api/embed",
  qdrantUrl: "",
  qdrantApiKey: "",
  qdrantCollection: "contextos",
  gitMode: "none" as const,
  gitRemoteMethod: "ssh-manual" as const,
  gitRemoteUrl: "",
  gitAutoPush: false,
  gitCommitMessageTemplate: "ContextOS: {{summary}}",
  gitHubToken: "",
  gitHubRepoName: "",
  gitSshKeyPath: ""
};

export type OperationType = "text" | "chat" | "vision";

export function getProviderConfigForOperation(
  settings: LLMWikiSettings,
  operation: OperationType
): ProviderConfig | undefined {
  let targetId: string | undefined;
  if (operation === "text") {
    targetId = settings.textProviderId || settings.activeProviderId;
  } else if (operation === "chat") {
    targetId = settings.chatProviderId || settings.textProviderId || settings.activeProviderId;
  } else if (operation === "vision") {
    targetId = settings.visionProviderId || undefined;
  }

  if (targetId) {
    const provider = settings.providers.find((p) => p.id === targetId && p.enabled);
    if (provider && provider.apiKey) return provider;
  }

  if (operation === "vision") return undefined;

  const fallback = settings.providers.find((p) => p.enabled && p.apiKey);
  if (fallback) return fallback;

  if (settings.openAIApiKey) {
    return {
      id: "legacy",
      type: "openai",
      name: "OpenAI (legacy)",
      apiKey: settings.openAIApiKey,
      apiUrl: settings.openAIApiUrl,
      model: settings.openAIModel,
      enabled: true
    };
  }
  return undefined;
}

export function getActiveProviderConfig(settings: LLMWikiSettings): ProviderConfig | undefined {
  return getProviderConfigForOperation(settings, "text");
}

export class LLMWikiSettingTab extends PluginSettingTab {
  plugin: LLMWikiPlugin;
  private autoTestTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(app: App, plugin: LLMWikiPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName(t("settings.title")).setHeading();

    this.addTextSetting(t("settings.rawFolder.name"), t("settings.rawFolder.desc"), "rawFolder");
    this.addTextSetting(t("settings.wikiFolder.name"), t("settings.wikiFolder.desc"), "wikiFolder");
    this.addTextSetting(t("settings.assetsFolder.name"), t("settings.assetsFolder.desc"), "assetsFolder");
    this.addTextSetting(t("settings.indexPath.name"), t("settings.indexPath.desc"), "indexPath");
    this.addTextSetting(t("settings.logPath.name"), t("settings.logPath.desc"), "logPath");

    new Setting(containerEl).setName(t("settings.providers.name")).setHeading();
    this.addRoutingBar();
    this.addProviderSettings();

    new Setting(containerEl).setName(t("settings.embeddings.name")).setHeading();
    this.addEmbeddingsSettings();

    new Setting(containerEl).setName(t("settings.prompts.name")).setHeading();
    this.addPromptTemplateSettings();

    new Setting(containerEl).setName(t("settings.advanced.name")).setHeading();
    this.addToggleSetting(t("settings.autoIngestEnabled.name"), t("settings.autoIngestEnabled.desc"), "autoIngestEnabled", true);
    this.addSecondsSetting("settings.autoIngestDebounce", "autoIngestDebounceMs", 1000, true);
    this.addSecondsSetting("settings.autoIngestPoll", "autoIngestPollSeconds", 1, true);
    this.addSecondsSetting("settings.requestTimeout", "requestTimeoutMs", 1000, false);
    new Setting(this.containerEl)
      .setName(t("settings.ocrPageConcurrency.name"))
      .setDesc(t("settings.ocrPageConcurrency.desc"))
      .addText((text) => {
        text.setValue(String(this.plugin.settings.ocrPageConcurrency));
        text.onChange(async (value) => {
          const n = Number(value.trim());
          if (!Number.isFinite(n) || n < 1 || n > 100) return;
          this.plugin.settings = { ...this.plugin.settings, ocrPageConcurrency: Math.round(n) };
          await this.plugin.saveSettings();
        });
      });
    this.addConnectionTest();

    new Setting(containerEl).setName(t("settings.gitSection.name")).setHeading();
    this.addGitSettings();
  }

  private providerCollapsed = new Map<string, boolean>();

  private addRoutingBar(): void {
    const routingContainer = this.containerEl.createDiv();
    routingContainer.addClass("contextos-routing-bar");

    routingContainer.createEl("h4", { text: t("settings.operationRouting.name") });

    this.addRoutingDropdown(routingContainer, t("settings.defaultProvider.name"),
      this.plugin.settings.activeProviderId,
      async (id) => {
        this.plugin.settings = { ...this.plugin.settings, activeProviderId: id };
        await this.plugin.saveSettings();
      });

    this.addRoutingDropdown(routingContainer, t("settings.textProvider.name"),
      this.plugin.settings.textProviderId,
      async (id) => {
        this.plugin.settings = { ...this.plugin.settings, textProviderId: id };
        await this.plugin.saveSettings();
      });

    this.addRoutingDropdown(routingContainer, t("settings.chatProvider.name"),
      this.plugin.settings.chatProviderId,
      async (id) => {
        this.plugin.settings = { ...this.plugin.settings, chatProviderId: id };
        await this.plugin.saveSettings();
      });

    this.addRoutingDropdown(routingContainer, t("settings.visionProvider.name"),
      this.plugin.settings.visionProviderId,
      async (id) => {
        this.plugin.settings = { ...this.plugin.settings, visionProviderId: id };
        await this.plugin.saveSettings();
      });
  }

  private addRoutingDropdown(
    container: HTMLElement,
    label: string,
    currentValue: string,
    onChange: (id: string) => Promise<void>
  ): void {
    const setting = new Setting(container).setName(label);
    setting.addDropdown((dropdown) => {
      dropdown.addOption("", t("settings.useDefault"));
      for (const provider of this.plugin.settings.providers) {
        if (provider.enabled) {
          dropdown.addOption(provider.id, provider.name);
        }
      }
      dropdown.setValue(currentValue);
      dropdown.onChange(async (value) => {
        await onChange(value);
      });
    });
  }

  private addProviderSettings(): void {
    const providersContainer = this.containerEl.createDiv();
    providersContainer.addClass("contextos-providers");

    for (const provider of this.plugin.settings.providers) {
      this.renderProviderEntry(providersContainer, provider);
    }

    const addBar = providersContainer.createEl("button");
    addBar.addClass("contextos-provider-add-bar");
    setIcon(addBar, "plus");
    addBar.createSpan({ text: t("settings.addProvider") });
    addBar.addEventListener("click", async () => {
      const id = `provider-${Date.now()}`;
      const newProvider: ProviderConfig = {
        id,
        type: "openai",
        name: "New Provider",
        apiKey: "",
        apiUrl: DEFAULT_API_URLS["openai"],
        model: "",
        enabled: true
      };
      this.plugin.settings = {
        ...this.plugin.settings,
        providers: [...this.plugin.settings.providers, newProvider]
      };
      this.providerCollapsed.set(id, false);
      await this.plugin.saveSettings();
      this.display();
    });
  }

  private renderProviderEntry(container: HTMLElement, provider: ProviderConfig): void {
    const collapsed = this.providerCollapsed.has(provider.id)
      ? this.providerCollapsed.get(provider.id)!
      : true;

    const entry = container.createDiv();
    entry.addClass("contextos-provider-entry");

    const header = entry.createDiv();
    header.addClass("contextos-provider-header");

    const leftSection = header.createDiv();
    leftSection.addClass("contextos-provider-header-left");

    const chevron = leftSection.createSpan();
    chevron.addClass("contextos-provider-chevron");
    setIcon(chevron, collapsed ? "chevron-right" : "chevron-down");

    const nameInput = leftSection.createEl("input");
    nameInput.addClass("contextos-provider-name-input");
    nameInput.type = "text";
    nameInput.value = provider.name;
    nameInput.placeholder = t("settings.providerName");
    nameInput.addEventListener("change", () => {
      void this.updateProvider(provider.id, { name: nameInput.value });
    });

    const rightSection = header.createDiv();
    rightSection.addClass("contextos-provider-header-right");

    const toggleContainer = rightSection.createSpan();
    toggleContainer.addClass("contextos-provider-toggle");
    const toggleInput = toggleContainer.createEl("input");
    toggleInput.type = "checkbox";
    toggleInput.checked = provider.enabled;
    toggleInput.addEventListener("change", () => {
      void this.updateProvider(provider.id, { enabled: toggleInput.checked });
    });

    const removeButton = rightSection.createEl("button");
    removeButton.addClass("contextos-provider-remove");
    removeButton.addClass("clickable-icon");
    setIcon(removeButton, "trash-2");
    removeButton.setAttr("aria-label", t("settings.removeProvider"));
    removeButton.addEventListener("click", () => this.removeProvider(provider.id));

    const toggleHeader = () => {
      const newCollapsed = !this.providerCollapsed.get(provider.id);
      this.providerCollapsed.set(provider.id, newCollapsed);
      body.style.display = newCollapsed ? "none" : "block";
      setIcon(chevron, newCollapsed ? "chevron-right" : "chevron-down");
    };

    chevron.addEventListener("click", toggleHeader);
    nameInput.addEventListener("click", (e) => e.stopPropagation());

    const body = entry.createDiv();
    body.addClass("contextos-provider-body");
    if (collapsed) body.style.display = "none";

    this.renderProviderField(body, t("settings.providerType"), { type: "dropdown", dropdownValue: provider.type, dropdownOnChange: async (value: string) => {
      const newType = value as LLMProviderType;
      const oldDefaultUrl = DEFAULT_API_URLS[provider.type];
      const shouldUpdateUrl = !provider.apiUrl || provider.apiUrl === oldDefaultUrl;
      await this.updateProvider(provider.id, {
        type: newType,
        ...(shouldUpdateUrl ? { apiUrl: DEFAULT_API_URLS[newType] } : {})
      });
    }});

    this.renderProviderField(body, t("settings.providerApiKey"), { type: "text", value: provider.apiKey, secret: true, onChange: async (value: string) => {
      await this.updateProvider(provider.id, { apiKey: value });
      if (this.autoTestTimer) clearTimeout(this.autoTestTimer);
      if (value) {
        this.autoTestTimer = setTimeout(() => {
          void this.runLLMConnectionTest();
        }, 800);
      }
    }});

    this.renderProviderField(body, t("settings.providerApiUrl"), { type: "text", value: provider.apiUrl, onChange: async (value: string) => {
      await this.updateProvider(provider.id, { apiUrl: value });
    }});

    this.renderProviderField(body, t("settings.providerModel"), { type: "text", value: provider.model, onChange: async (value: string) => {
      await this.updateProvider(provider.id, { model: value });
    }});
  }

  private renderProviderField(
    container: HTMLElement,
    label: string,
    opts: {
      type: "text";
      value: string;
      secret?: boolean;
      onChange?: (value: string) => Promise<void>;
    } | {
      type: "dropdown";
      dropdownValue: string;
      dropdownOnChange?: (value: string) => Promise<void>;
    }
  ): void {
    const setting = new Setting(container).setName(label);
    if (opts.type === "dropdown") {
      setting.addDropdown((dropdown) => {
        for (const t of LLM_PROVIDER_TYPES) {
          dropdown.addOption(t, t);
        }
        dropdown.setValue(opts.dropdownValue);
        if (opts.dropdownOnChange) {
          dropdown.onChange(async (val) => { await opts.dropdownOnChange!(val); });
        }
      });
    } else {
      setting.addText((text) => {
        text.setValue(opts.value);
        if (opts.secret) text.inputEl.type = "password";
        if (opts.onChange) {
          text.inputEl.addEventListener("change", () => {
            void opts.onChange!(text.getValue());
          });
        }
      });
    }
  }

  private async removeProvider(id: string): Promise<void> {
    if (this.plugin.settings.providers.length <= 1) return;
    const providers = this.plugin.settings.providers.filter((p) => p.id !== id);
    const activeProviderId = this.plugin.settings.activeProviderId === id
      ? providers[0]?.id ?? ""
      : this.plugin.settings.activeProviderId;
    this.plugin.settings = { ...this.plugin.settings, providers, activeProviderId };
    providerRegistry.invalidateCache(id);
    this.providerCollapsed.delete(id);
    await this.plugin.saveSettings();
    this.display();
  }

  private async updateProvider(id: string, update: Partial<ProviderConfig>): Promise<void> {
    const providers = this.plugin.settings.providers.map((p) =>
      p.id === id ? { ...p, ...update } : p
    );
    this.plugin.settings = { ...this.plugin.settings, providers };
    providerRegistry.invalidateCache(id);
    await this.plugin.saveSettings();
    this.display();
  }

  private addEmbeddingsSettings(): void {
    const s = this.plugin.settings;
    new Setting(this.containerEl)
      .setName(t("settings.embeddingsBackend.name"))
      .setDesc(t("settings.embeddingsBackend.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "None");
        dropdown.addOption("ollama", "Ollama");
        dropdown.addOption("openai", "OpenAI");
        dropdown.addOption("qdrant", "Qdrant");
        dropdown.setValue(s.embeddingsBackend);
        dropdown.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, embeddingsBackend: value as import("./types").EmbeddingsBackend };
          await this.plugin.saveSettings();
          this.display();
        });
      });

    const backend = s.embeddingsBackend;
    if (backend === "ollama" || backend === "openai") {
      new Setting(this.containerEl)
        .setName(t("settings.embeddingsModel.name"))
        .setDesc(t("settings.embeddingsModel.desc"))
        .addText((text) => {
          text.setValue(s.embeddingsModel);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, embeddingsModel: value };
            await this.plugin.saveSettings();
          });
        });
    }

    if (backend === "openai") {
      new Setting(this.containerEl)
        .setName(t("settings.embeddingsApiKey.name"))
        .setDesc(t("settings.embeddingsApiKey.desc"))
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(s.embeddingsApiKey);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, embeddingsApiKey: value };
            await this.plugin.saveSettings();
          });
        });
    }

    if (backend === "ollama" || backend === "openai") {
      new Setting(this.containerEl)
        .setName(t("settings.embeddingsApiUrl.name"))
        .setDesc(t("settings.embeddingsApiUrl.desc"))
        .addText((text) => {
          text.setValue(s.embeddingsApiUrl);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, embeddingsApiUrl: value };
            await this.plugin.saveSettings();
          });
        });
    }

    if (backend === "qdrant") {
      new Setting(this.containerEl)
        .setName(t("settings.qdrantUrl.name"))
        .setDesc(t("settings.qdrantUrl.desc"))
        .addText((text) => {
          text.setValue(s.qdrantUrl);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, qdrantUrl: value };
            await this.plugin.saveSettings();
          });
        });
      new Setting(this.containerEl)
        .setName(t("settings.qdrantApiKey.name"))
        .setDesc(t("settings.qdrantApiKey.desc"))
        .addText((text) => {
          text.inputEl.type = "password";
          text.setValue(s.qdrantApiKey);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, qdrantApiKey: value };
            await this.plugin.saveSettings();
          });
        });
      new Setting(this.containerEl)
        .setName(t("settings.qdrantCollection.name"))
        .setDesc(t("settings.qdrantCollection.desc"))
        .addText((text) => {
          text.setValue(s.qdrantCollection);
          text.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, qdrantCollection: value };
            await this.plugin.saveSettings();
          });
        });
    }
  }

  private addPromptTemplateSettings(): void {
    new Setting(this.containerEl)
      .setName(t("settings.ingestPrompt.name"))
      .setDesc(t("settings.ingestPrompt.desc"))
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.ingestSystemPrompt);
        text.setPlaceholder(t("settings.ingestPrompt.placeholder"));
        text.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, ingestSystemPrompt: value };
          await this.plugin.saveSettings();
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings.chatPrompt.name"))
      .setDesc(t("settings.chatPrompt.desc"))
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.chatSystemPrompt);
        text.setPlaceholder(t("settings.chatPrompt.placeholder"));
        text.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, chatSystemPrompt: value };
          await this.plugin.saveSettings();
        });
      });

    new Setting(this.containerEl)
      .setName(t("settings.lintPrompt.name"))
      .setDesc(t("settings.lintPrompt.desc"))
      .addTextArea((text) => {
        text.setValue(this.plugin.settings.lintSystemPrompt);
        text.setPlaceholder(t("settings.lintPrompt.placeholder"));
        text.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, lintSystemPrompt: value };
          await this.plugin.saveSettings();
        });
      });
  }

  private addSecondsSetting(
    labelKey: "settings.autoIngestDebounce" | "settings.autoIngestPoll" | "settings.requestTimeout",
    key: "autoIngestDebounceMs" | "autoIngestPollSeconds" | "requestTimeoutMs",
    factor: number,
    allowZero: boolean
  ): void {
    new Setting(this.containerEl)
      .setName(t(`${labelKey}.name`))
      .setDesc(t(`${labelKey}.desc`))
      .addText((text) => {
        text.setValue(String(Math.round(this.plugin.settings[key] / factor)));
        text.onChange(async (value) => {
          const seconds = Number(value.trim());
          if (!Number.isFinite(seconds) || seconds < 0 || (!allowZero && seconds === 0)) return;
          this.plugin.settings = { ...this.plugin.settings, [key]: Math.round(seconds * factor) };
          await this.plugin.saveSettings();
        });
      });
  }

  private addGitSettings(): void {
    const s = this.plugin.settings;
    new Setting(this.containerEl)
      .setName(t("settings.gitMode.name"))
      .setDesc(t("settings.gitMode.desc"))
      .addDropdown((dropdown) => {
        dropdown.addOption("none", "Off");
        dropdown.addOption("local", "Local only");
        dropdown.addOption("remote", "Remote repository (SSH)");
        dropdown.setValue(s.gitMode);
        dropdown.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, gitMode: value as "none" | "local" | "remote" };
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (s.gitMode === "local" || s.gitMode === "remote") {
      this.addTextSetting(t("settings.gitCommitMessageTemplate.name"), t("settings.gitCommitMessageTemplate.desc"), "gitCommitMessageTemplate");
    }

    if (s.gitMode === "remote") {
      new Setting(this.containerEl)
        .setName(t("settings.gitRemoteMethod.name"))
        .setDesc(t("settings.gitRemoteMethod.desc"))
        .addDropdown((dropdown) => {
          dropdown.addOption("ssh-manual", "SSH (manual setup)");
          dropdown.addOption("ssh-keygen", "SSH (auto-generate key)");
          dropdown.setValue(s.gitRemoteMethod);
          dropdown.onChange(async (value) => {
            this.plugin.settings = { ...this.plugin.settings, gitRemoteMethod: value as "ssh-manual" | "ssh-keygen" };
            await this.plugin.saveSettings();
            this.display();
          });
        });

      if (s.gitRemoteMethod === "ssh-manual") {
        new Setting(this.containerEl)
          .setName(t("settings.gitRemoteUrl.name"))
          .setDesc(t("settings.gitRemoteUrl.desc"))
          .addText((text) => {
            text.setValue(this.plugin.settings.gitRemoteUrl);
            text.onChange(async (value) => {
              this.plugin.settings = { ...this.plugin.settings, gitRemoteUrl: value };
              await this.plugin.saveSettings();
              if (this.autoTestTimer) clearTimeout(this.autoTestTimer);
              if (value) {
                this.autoTestTimer = setTimeout(() => {
                  void this.plugin.testGitConnection();
                }, 800);
              }
            });
          });
      }

      if (s.gitRemoteMethod === "ssh-keygen") {
        this.addSshKeygenSettings();
        new Setting(this.containerEl)
          .setName(t("settings.gitRemoteUrl.name"))
          .setDesc(t("settings.gitRemoteUrl.desc"))
          .addText((text) => {
            text.setValue(this.plugin.settings.gitRemoteUrl);
            text.onChange(async (value) => {
              this.plugin.settings = { ...this.plugin.settings, gitRemoteUrl: value };
              await this.plugin.saveSettings();
              if (this.autoTestTimer) clearTimeout(this.autoTestTimer);
              if (value) {
                this.autoTestTimer = setTimeout(() => {
                  void this.plugin.testGitConnection();
                }, 800);
              }
            });
          });
      }

      if (s.gitRemoteUrl) {
        new Setting(this.containerEl)
          .setName(t("settings.gitTestConnection.name"))
          .setDesc(t("settings.gitTestConnection.desc"))
          .addButton((button) => {
            button.setButtonText(t("settings.gitTestConnection.name"));
            button.onClick(async () => {
              button.setDisabled(true);
              try {
                await this.plugin.testGitConnection();
              } finally {
                button.setDisabled(false);
              }
            });
          });
      }
    }
  }

  private addSshKeygenSettings(): void {
    const s = this.plugin.settings;
    if (!s.gitSshKeyPath) {
      new Setting(this.containerEl)
        .setName(t("settings.gitSshKeygen.name"))
        .setDesc(t("settings.gitSshKeygen.desc"))
        .addButton((button) => {
          button.setButtonText(t("settings.gitSshKeygen.name"));
          button.onClick(async () => {
            await this.plugin.generateSshKey();
            this.display();
          });
        });
      return;
    }

    const keyContainer = this.containerEl.createDiv();
    keyContainer.createEl("p", { text: t("settings.gitSshPublicKey.name") });
    const textarea = keyContainer.createEl("textarea");
    textarea.readOnly = true;
    textarea.style.width = "100%";
    textarea.style.height = "100px";
    textarea.style.resize = "vertical";
    try {
      if (typeof (window as unknown as { require?: (module: string) => unknown }).require !== "undefined") {
        const fs = (window as unknown as { require: (module: string) => { readFileSync: (path: string, encoding: string) => string } }).require("fs");
        textarea.value = fs.readFileSync(s.gitSshKeyPath + ".pub", "utf-8").trim();
      }
    } catch {
      textarea.value = "Unable to read public key.";
    }
    textarea.addEventListener("click", () => {
      textarea.select();
      void navigator.clipboard.writeText(textarea.value);
      new Notice(t("notice.gitKeyCopied"));
    });
    keyContainer.createEl("p", { text: t("settings.gitSshPublicKey.desc"), cls: "setting-item-description" });
  }

  private addGitHubApiSettings(): void {
    const s = this.plugin.settings;
    this.addTextSetting(t("settings.gitHubToken.name"), t("settings.gitHubToken.desc"), "gitHubToken", true);
    this.addTextSetting(t("settings.gitHubRepoName.name"), t("settings.gitHubRepoName.desc"), "gitHubRepoName");

    if (!s.gitHubToken || !s.gitHubRepoName) return;

    const statusContainer = this.containerEl.createDiv();
    statusContainer.createEl("p", { text: t("settings.gitChecking") });

    void (async () => {
      try {
        const user = await this.plugin.fetchGitHubUser();
        if (!user) {
          statusContainer.empty();
          statusContainer.createEl("p", { text: t("notice.gitHubAccountFailed") });
          return;
        }
        const exists = await this.plugin.checkGitHubRepo(user, s.gitHubRepoName);
        statusContainer.empty();
        statusContainer.createEl("p", { text: t("notice.gitHubAccountDetected", { username: user }) });
        if (exists) {
          statusContainer.createEl("p", { text: t("notice.gitRepoExists") });
          statusContainer.createEl("p", { text: `https://github.com/${user}/${s.gitHubRepoName}` });
        } else {
          const createBtn = statusContainer.createEl("button");
          createBtn.setText(t("settings.gitCreateRepo.name"));
          createBtn.addEventListener("click", async () => {
            createBtn.setAttr("disabled", "true");
            try {
              await this.plugin.createGitHubRepo();
            } finally {
              createBtn.removeAttribute("disabled");
            }
            this.display();
          });
        }
      } catch {
        statusContainer.empty();
        statusContainer.createEl("p", { text: t("notice.gitHubAccountFailed") });
      }
    })();
  }

  private async runLLMConnectionTest(): Promise<void> {
    const activeProvider = getActiveProviderConfig(this.plugin.settings);
    if (!activeProvider) {
      new Notice(t("notice.noActiveProvider"));
      return;
    }
    let provider: import("./providers/LLMProvider").LLMProvider;
    if (providerRegistry.hasType(activeProvider.type)) {
      provider = providerRegistry.getProvider(activeProvider, this.plugin.settings.requestTimeoutMs);
    } else {
      provider = new OpenAIProvider(undefined, { timeoutMs: this.plugin.settings.requestTimeoutMs });
    }
    await provider.testConnection({
      apiKey: activeProvider.apiKey,
      apiUrl: activeProvider.apiUrl,
      model: activeProvider.model
    });
    new Notice(t("notice.openAIConnectionSucceeded"));
  }

  private addConnectionTest(): void {
    new Setting(this.containerEl)
      .setName(t("settings.testConnection.name"))
      .setDesc(t("settings.testConnection.desc"))
      .addButton((button) => {
        button.setButtonText(t("settings.testConnection.name"));
        button.onClick(async () => {
          button.setDisabled(true);
          try {
            await this.runLLMConnectionTest();
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

  private addToggleSetting(name: string, desc: string, key: "autoIngestEnabled", isAutoIngest = false): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addToggle((toggle) => {
        toggle.setValue(Boolean(this.plugin.settings[key]));
        toggle.onChange(async (value) => {
          this.plugin.settings = { ...this.plugin.settings, [key]: value };
          if (isAutoIngest && value) this.plugin.enableAutoIngestListeners();
          await this.plugin.saveSettings();
          this.display();
        });
      });
  }
}
