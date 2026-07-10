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
  expect(buttons.some((button) => button.buttonText === "Test connection")).toBe(true);
});

test("auto ingest is disabled by default", () => {
  expect(DEFAULT_SETTINGS.autoIngestEnabled).toBe(false);
});

test("request timeout defaults to 900 seconds", () => {
  expect(DEFAULT_SETTINGS.requestTimeoutMs).toBe(900000);
});

test("auto ingest poll interval defaults to 15 seconds", () => {
  expect(DEFAULT_SETTINGS.autoIngestPollSeconds).toBe(15);
});

test("settings tab renders the auto ingest debounce control", () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const texts = (tab.containerEl as unknown as { texts: string[] }).texts;
  expect(texts).toContain("Auto ingest debounce (seconds)");
});

test("settings tab renders the auto ingest poll interval control", () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const texts = (tab.containerEl as unknown as { texts: string[] }).texts;
  expect(texts).toContain("Auto ingest poll interval (seconds)");
});

test("settings tab renders the request timeout control in seconds", () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const texts = (tab.containerEl as unknown as { texts: string[] }).texts;
  expect(texts).toContain("Request timeout (seconds)");
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
  expect(toggles.length).toBeGreaterThanOrEqual(1);
  await toggles[0].onchange!(true);

  expect(plugin.settings.autoIngestEnabled).toBe(true);
  expect(saveSettings).toHaveBeenCalledTimes(1);
});

type TextInput = { value?: string; onchange?: (value: string) => Promise<void> };

function renderTextInputs(): { plugin: LLMWikiPlugin; inputs: TextInput[] } {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "saveSettings").mockResolvedValue();
  const tab = new LLMWikiSettingTab({} as never, plugin);
  tab.display();
  const inputs = (tab.containerEl as unknown as { textInputs: TextInput[] }).textInputs;
  return { plugin, inputs };
}

test("auto ingest debounce control stores entered seconds as milliseconds", async () => {
  const { plugin, inputs } = renderTextInputs();
  const debounce = inputs.find((input) => input.value === "3")!; // 3000ms / 1000 shown as seconds
  await debounce.onchange!("10");
  expect(plugin.settings.autoIngestDebounceMs).toBe(10000);
});

test("auto ingest poll control stores whole seconds and allows zero", async () => {
  const { plugin, inputs } = renderTextInputs();
  const poll = inputs.find((input) => input.value === "15")!;
  await poll.onchange!("30");
  expect(plugin.settings.autoIngestPollSeconds).toBe(30);
  await poll.onchange!("0");
  expect(plugin.settings.autoIngestPollSeconds).toBe(0);
});

test("request timeout control rejects non-positive input and stores seconds as milliseconds", async () => {
  const { plugin, inputs } = renderTextInputs();
  const timeout = inputs.find((input) => input.value === "900")!; // 900000ms / 1000
  await timeout.onchange!("0");
  expect(plugin.settings.requestTimeoutMs).toBe(900000); // 0 rejected (allowZero=false)
  await timeout.onchange!("-5");
  expect(plugin.settings.requestTimeoutMs).toBe(900000); // negative rejected
  await timeout.onchange!("30");
  expect(plugin.settings.requestTimeoutMs).toBe(30000);
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
  const button = (tab.containerEl as unknown as { buttons: Button[] }).buttons.find((candidate) => candidate.buttonText === "Test connection")!;
  await button.onclick!();

  expect(notices).toContain("OpenAI connection test succeeded.");
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
