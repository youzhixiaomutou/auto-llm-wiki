import * as obsidian from "obsidian";
import LLMWikiPlugin from "../src/main";
import { LLMWikiSettingTab } from "../src/settings";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;

type Button = { buttonText?: string; disabled?: boolean; onclick?: () => void | Promise<void> };

beforeEach(() => {
  notices.length = 0;
  jest.restoreAllMocks();
});

test("settings tab renders a button for testing the OpenAI connection", () => {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  const tab = new LLMWikiSettingTab({} as never, plugin);

  tab.display();

  const buttons = (tab.containerEl as unknown as { buttons: Button[] }).buttons;
  expect(buttons.some((button) => button.buttonText === "Test OpenAI connection")).toBe(true);
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

test("OpenAI connection test reports failure for non-2xx", async () => {
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

  expect(notices).toContain("OpenAI connection test failed: OpenAI connection test failed: 401 bad key");
  expect(button.disabled).toBe(false);
});
