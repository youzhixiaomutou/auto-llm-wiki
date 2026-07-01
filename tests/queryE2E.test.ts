import * as obsidian from "obsidian";
import { __setLanguage } from "./obsidianMock";
import LLMWikiPlugin from "../src/main";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;
const modals = (obsidian.Modal as unknown as { instances: unknown[] }).instances;

beforeEach(() => {
  notices.length = 0;
  modals.length = 0;
  __setLanguage("en");
  jest.restoreAllMocks();
});

test("query selects relevant pages via a first model call, then answers from only those", async () => {
  const wikiFiles = Array.from({ length: 13 }, (_, i) => ({ path: `wiki/p${i}.md` }));
  const contentByPath = new Map<string, string>();
  wikiFiles.forEach((file, i) => contentByPath.set(file.path, `content of page ${i}`));
  contentByPath.set("wiki/index.md", "# Index");
  contentByPath.set("wiki/log.md", "# Log");

  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const readPaths: string[] = [];
  const requestSpy = jest.spyOn(obsidian, "requestUrl")
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(["wiki/p3.md", "wiki/p7.md"]) } }] })
    } as never)
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "answer", operations: [] }) } }] })
    } as never);

  (globalThis as unknown as { window: { prompt(): string } }).window.prompt = () => "What about page 3 and 7?";

  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key" });
  jest.spyOn(plugin, "saveData").mockResolvedValue();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [...wikiFiles, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => {
        readPaths.push(file.path);
        return contentByPath.get(file.path) ?? "";
      },
      create: async () => undefined,
      modify: async () => undefined,
      createFolder: async () => undefined,
      delete: async () => undefined
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { queryWiki(): Promise<void> }).queryWiki();

  expect(requestSpy).toHaveBeenCalledTimes(2);

  const selectionPrompt = JSON.parse(String((requestSpy.mock.calls[0][0] as { body: string }).body)).messages[1].content;
  expect(selectionPrompt).toContain("What about page 3 and 7?");
  expect(selectionPrompt).toContain("wiki/p7.md");

  const answerPrompt = JSON.parse(String((requestSpy.mock.calls[1][0] as { body: string }).body)).messages[1].content;
  expect(answerPrompt).toContain("content of page 3");
  expect(answerPrompt).toContain("content of page 7");
  expect(answerPrompt).not.toContain("content of page 5");

  expect(readPaths).toContain("wiki/p3.md");
  expect(readPaths).toContain("wiki/p7.md");
  expect(readPaths).not.toContain("wiki/p5.md");
});

test("query sends all pages in a single call when the wiki is small", async () => {
  const contentByPath = new Map<string, string>([
    ["wiki/a.md", "alpha"],
    ["wiki/index.md", "# Index"],
    ["wiki/log.md", "# Log"]
  ]);
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const requestSpy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "answer", operations: [] }) } }] })
  } as never);

  (globalThis as unknown as { window: { prompt(): string } }).window.prompt = () => "question";

  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue({ openAIApiKey: "key" });
  jest.spyOn(plugin, "saveData").mockResolvedValue();
  plugin.app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/a.md" }, { path: "wiki/index.md" }, { path: "wiki/log.md" }],
      getFiles: () => [],
      getAbstractFileByPath: (path: string) => (contentByPath.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => contentByPath.get(file.path) ?? "",
      create: async () => undefined,
      modify: async () => undefined,
      createFolder: async () => undefined,
      delete: async () => undefined
    }
  } as never;

  await plugin.onload();
  await (plugin as unknown as { queryWiki(): Promise<void> }).queryWiki();

  expect(requestSpy).toHaveBeenCalledTimes(1);
});
