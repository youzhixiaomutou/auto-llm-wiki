import * as obsidian from "obsidian";
import LLMWikiPlugin from "../src/main";
import { DEFAULT_SETTINGS, LLMWikiSettingTab } from "../src/settings";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;

type Button = { buttonText?: string; disabled?: boolean; onclick?: () => void | Promise<void> };
type Toggle = { value?: boolean; onchange?: (value: boolean) => Promise<void> };

beforeEach(() => {
  notices.length = 0;
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("en");
  jest.restoreAllMocks();
});

test("settings tab renders Chinese strings when Obsidian language is zh", () => {
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("zh");
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const texts = (tab.containerEl as unknown as { texts: string[] }).texts;
  expect(texts).toContain("原始文件夹");
  expect(texts).toContain("不可变的源文档。");
});

test("settings tab renders a button for testing the OpenAI connection", () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const buttons = (tab.containerEl as unknown as { buttons: Button[] }).buttons;
  expect(buttons.some((button) => button.buttonText === "Test OpenAI connection")).toBe(true);
});

test("auto ingest is disabled by default", () => {
  expect(DEFAULT_SETTINGS.autoIngestEnabled).toBe(false);
});

test("settings tab saves the auto ingest toggle", async () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  plugin.app = { vault: { on: jest.fn(() => "event") } } as never;
  const saveSettings = jest.spyOn(plugin, "saveSettings").mockResolvedValue();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();
  const texts = (tab.containerEl as unknown as { texts: string[] }).texts;
  const toggles = (tab.containerEl as unknown as { toggles: Toggle[] }).toggles;
  expect(texts).toContain("Auto ingest raw file changes");
  expect(toggles).toHaveLength(1);
  await toggles[0].onchange!(true);

  expect(plugin.settings.autoIngestEnabled).toBe(true);
  expect(saveSettings).toHaveBeenCalledTimes(1);
});

test("OpenAI connection test reports success for HTTP 2xx", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 204, text: "" } as never);
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  plugin.settings = {
    ...plugin.settings,
    openAIApiUrl: "https://example.test/v1/chat/completions",
    openAIApiKey: "key",
    openAIModel: "model"
  };
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();
  const button = (tab.containerEl as unknown as { buttons: Button[] }).buttons.find((candidate) => candidate.buttonText === "Test OpenAI connection")!;
  await button.onclick!();

  const request = (obsidian.requestUrl as jest.Mock).mock.calls[0][0];
  expect(request.url).toBe("https://example.test/v1/chat/completions");
  expect(request.method).toBe("POST");
  expect(request.headers.Authorization).toBe("Bearer key");
  expect(notices).toContain("OpenAI connection test succeeded.");
  expect(button.disabled).toBe(false);
});

test("OpenAI connection test reports failure for non-2xx without duplicating the English prefix", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 401, text: "bad key" } as never);
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  plugin.settings = {
    ...plugin.settings,
    openAIApiUrl: "https://example.test/v1/chat/completions",
    openAIApiKey: "bad",
    openAIModel: "model"
  };
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();
  const button = (tab.containerEl as unknown as { buttons: Button[] }).buttons.find((candidate) => candidate.buttonText === "Test OpenAI connection")!;
  await button.onclick!();

  expect(notices).toContain("OpenAI connection test failed: 401 bad key");
  expect(button.disabled).toBe(false);
});

test("OpenAI connection test reports localized zh failure with raw provider details", async () => {
  (obsidian as unknown as { __setLanguage(language: string): void }).__setLanguage("zh");
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({ status: 401, text: "bad key" } as never);
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  plugin.settings = {
    ...plugin.settings,
    openAIApiUrl: "https://example.test/v1/chat/completions",
    openAIApiKey: "bad",
    openAIModel: "model"
  };
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();
  const button = (tab.containerEl as unknown as { buttons: Button[] }).buttons.find((candidate) => candidate.buttonText === "测试 OpenAI 连接")!;
  await button.onclick!();

  expect(notices).toContain("OpenAI 连接测试失败：401 bad key");
  expect(button.disabled).toBe(false);
});
