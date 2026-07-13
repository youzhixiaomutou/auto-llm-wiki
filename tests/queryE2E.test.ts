// NOTE: rename this file to chatE2E.test.ts (git mv) — it now covers the chat feature that
// replaced the one-shot query command.
import * as obsidian from "obsidian";
import { __setLanguage } from "./obsidianMock";
import LLMWikiPlugin from "../src/main";
import { CHAT_VIEW_TYPE } from "../src/chatView";

const modals = (obsidian.Modal as unknown as { instances: unknown[] }).instances;

beforeEach(() => {
  modals.length = 0;
  __setLanguage("en");
  jest.restoreAllMocks();
});

function newPlugin(data: Record<string, unknown>): LLMWikiPlugin {
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue(data);
  jest.spyOn(plugin, "saveData").mockResolvedValue();
  return plugin;
}

test("answerChat selects relevant pages, then answers from only those with a non-JSON chat call", async () => {
  const wikiFiles = Array.from({ length: 13 }, (_, i) => ({ path: `wiki/p${i}.md` }));
  const contentByPath = new Map<string, string>();
  wikiFiles.forEach((file, i) => contentByPath.set(file.path, `content of page ${i}`));
  contentByPath.set("wiki/index.md", "# Index");
  contentByPath.set("wiki/log.md", "# Log");

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const requestSpy = jest.spyOn(obsidian, "requestUrl")
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(["wiki/p3.md", "wiki/p7.md"]) } }] })
    } as never)
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: "Pages 3 and 7 relate; see wiki/p3.md." } }] })
    } as never);

  const plugin = newPlugin({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [...wikiFiles, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => contentByPath.get(file.path) ?? "",
      on: jest.fn(() => "ref")
    }
  } as never;

  await plugin.onload();
  const reply = await (plugin as unknown as { answerChat(m: unknown[]): Promise<string> })
    .answerChat([{ role: "user", content: "about pages 3 and 7" }]);

  expect(requestSpy).toHaveBeenCalledTimes(2);
  const chatBody = JSON.parse(String((requestSpy.mock.calls[1][0] as { body: string }).body));
  expect(chatBody.messages[0].role).toBe("system");
  expect(chatBody.messages[0].content).not.toContain("Return only JSON");
  // Wiki context rides in the system message; the conversation then follows as clean user turns.
  const systemMsg = chatBody.messages[0].content;
  expect(systemMsg).toContain("content of page 3");
  expect(systemMsg).toContain("content of page 7");
  expect(systemMsg).not.toContain("content of page 5");
  expect(chatBody.messages[1].role).toBe("user");
  expect(reply).toBe("Pages 3 and 7 relate; see wiki/p3.md.");
});

test("answerChat sends wiki content pages but not the log or a duplicate index", async () => {
  const contentByPath = new Map<string, string>([
    ["wiki/a.md", "alpha page body"],
    ["wiki/index.md", "INDEX BODY"],
    ["wiki/log.md", "LOG BODY must not be sent"]
  ]);
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const requestSpy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "ok" } }] })
  } as never);

  const plugin = newPlugin({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/a.md" }, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => contentByPath.get(file.path) ?? "",
      on: jest.fn(() => "ref")
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { answerChat(m: unknown[]): Promise<string> })
    .answerChat([{ role: "user", content: "hi" }]);

  const body = JSON.parse(String((requestSpy.mock.calls[requestSpy.mock.calls.length - 1][0] as { body: string }).body));
  const systemMsg = body.messages[0].content;
  expect(systemMsg).toContain("alpha page body"); // a real content page is included
  expect(systemMsg).toContain("INDEX BODY"); // index is sent once (as the index)
  expect(systemMsg).not.toContain("LOG BODY must not be sent"); // the log is never sent to chat
});

test("answerChat sends a single chat call when the wiki is small", async () => {
  const contentByPath = new Map<string, string>([
    ["wiki/a.md", "alpha"],
    ["wiki/index.md", "# Index"],
    ["wiki/log.md", "# Log"]
  ]);
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const requestSpy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "the answer" } }] })
  } as never);

  const plugin = newPlugin({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/a.md" }, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => contentByPath.get(file.path) ?? "",
      on: jest.fn(() => "ref")
    }
  } as never;

  await plugin.onload();
  const reply = await (plugin as unknown as { answerChat(m: unknown[]): Promise<string> })
    .answerChat([{ role: "user", content: "hi" }]);

  expect(requestSpy).toHaveBeenCalledTimes(1);
  expect(reply).toBe("the answer");
});

test("answerChat reads wiki context via vault.cachedRead when available", async () => {
  const contentByPath = new Map<string, string>([
    ["wiki/a.md", "alpha"],
    ["wiki/index.md", "# Index"],
    ["wiki/log.md", "# Log"]
  ]);
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const read = jest.fn(async (file: { path: string }) => contentByPath.get(file.path) ?? "");
  const cachedRead = jest.fn(async (file: { path: string }) => contentByPath.get(file.path) ?? "");
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "ok" } }] })
  } as never);

  const plugin = newPlugin({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/a.md" }, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read,
      cachedRead,
      on: jest.fn(() => "ref")
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { answerChat(m: unknown[]): Promise<string> })
    .answerChat([{ role: "user", content: "hi" }]);

  // Read-only wiki context goes through Obsidian's cached reader (caches + invalidates), not read().
  expect(cachedRead).toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
});

test("saveChatAnswer opens the reviewed change-plan preview, and applying it writes the page", async () => {
  const contentByPath = new Map<string, string>([["wiki/index.md", "# Index"], ["wiki/log.md", "# Log"]]);
  const created = new Map<string, string>();
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: "filed the answer",
      operations: [{ kind: "create", path: "wiki/answer.md", content: "# A", rationale: "r" }]
    }) } }] })
  } as never);

  const plugin = newPlugin({ openAIApiKey: "key" });
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) || created.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => contentByPath.get(file.path) ?? created.get(file.path) ?? "",
      create: async (path: string, content: string) => { created.set(path, content); },
      modify: async () => undefined,
      createFolder: async () => undefined,
      delete: async () => undefined,
      on: jest.fn(() => "ref")
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { saveChatAnswer(q: string, a: string): Promise<void> })
    .saveChatAnswer("What is A?", "A is the answer.");

  expect(modals.length).toBe(1); // the reviewed preview opened; chat did not auto-write
  const preview = modals[0] as { contentEl: { buttons: Array<{ onclick?: () => Promise<void> }> } };
  await preview.contentEl.buttons[0].onclick!(); // Apply
  expect(created.get("wiki/answer.md")).toBe("# A");
});

test("onload registers the chat view and a ribbon icon", async () => {
  const plugin = newPlugin({});
  plugin.app = { vault: { on: jest.fn(() => "ref") } } as never;
  await plugin.onload();

  const registered = (plugin as unknown as { registeredViews: Array<{ type: string; factory: (leaf: unknown) => unknown }> }).registeredViews;
  const ribbons = (plugin as unknown as { ribbonIcons: Array<{ icon: string; title: string }> }).ribbonIcons;
  expect(registered.some((view) => view.type === CHAT_VIEW_TYPE)).toBe(true);
  expect(ribbons.some((icon) => icon.icon === "message-circle")).toBe(true);
  const view = registered.find((entry) => entry.type === CHAT_VIEW_TYPE)!.factory({}) as { getViewType(): string };
  expect(view.getViewType()).toBe(CHAT_VIEW_TYPE);
});

test("toggleChatView opens the chat in the right sidebar when none is open", async () => {
  const setViewState = jest.fn(async () => undefined);
  const revealLeaf = jest.fn();
  const rightLeaf = { setViewState };
  const plugin = newPlugin({});
  plugin.app = {
    vault: { on: jest.fn(() => "ref") },
    workspace: { getLeavesOfType: () => [], getRightLeaf: () => rightLeaf, revealLeaf }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { toggleChatView(): Promise<void> }).toggleChatView();

  expect(setViewState).toHaveBeenCalledWith({ type: CHAT_VIEW_TYPE, active: true });
  expect(revealLeaf).toHaveBeenCalledWith(rightLeaf);
});

test("toggleChatView closes the chat (detaches the leaf) when it is already open", async () => {
  const detach = jest.fn();
  const existing = { detach };
  const revealLeaf = jest.fn();
  const getRightLeaf = jest.fn();
  const plugin = newPlugin({});
  plugin.app = {
    vault: { on: jest.fn(() => "ref") },
    workspace: { getLeavesOfType: () => [existing], getRightLeaf, revealLeaf }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { toggleChatView(): Promise<void> }).toggleChatView();

  expect(detach).toHaveBeenCalledTimes(1); // closes the open panel
  expect(getRightLeaf).not.toHaveBeenCalled();
  expect(revealLeaf).not.toHaveBeenCalled();
});
