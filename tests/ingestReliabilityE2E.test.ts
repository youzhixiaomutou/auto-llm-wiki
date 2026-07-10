import * as obsidian from "obsidian";
import { __setLanguage } from "./obsidianMock";
import LLMWikiPlugin from "../src/main";
import { hashContent } from "../src/rawTracker";

const notices = (obsidian.Notice as unknown as { messages: string[] }).messages;
const modals = (obsidian.Modal as unknown as { instances: Array<{ contentEl: { buttons: Array<{ onclick: () => Promise<void> }> } }> }).instances;

type StoredFile = { path: string; content?: string };
interface RawSource { path: string; content: string; stat?: { mtime: number; size: number }; }

beforeEach(() => {
  notices.length = 0;
  modals.length = 0;
  __setLanguage("en");
  jest.restoreAllMocks();
});

function setup(rawSources: RawSource[], loadData: object) {
  const files = new Map<string, StoredFile>([
    ["wiki/index.md", { path: "wiki/index.md", content: "# Index" }],
    ["wiki/log.md", { path: "wiki/log.md", content: "# Log" }]
  ]);
  for (const source of rawSources) files.set(source.path, { path: source.path, content: source.content });
  const rawFileObjects = rawSources.map((source) => ({ path: source.path, stat: source.stat }));
  const reads: string[] = [];
  const savedData: unknown[] = [];
  const plugin = new (LLMWikiPlugin as unknown as { new(): LLMWikiPlugin })();
  jest.spyOn(plugin, "loadData").mockResolvedValue(loadData);
  jest.spyOn(plugin, "saveData").mockImplementation(async (data) => {
    savedData.push(data);
  });
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  plugin.app = {
    vault: {
      getFiles: () => rawFileObjects,
      getAbstractFileByPath: (path: string) => (files.has(path) ? new TFileMock(path) : null),
      createFolder: async (path: string) => {
        files.set(path, { path });
      },
      create: async (path: string, content: string) => {
        files.set(path, { path, content });
      },
      read: async (file: { path: string }) => {
        reads.push(file.path);
        return files.get(file.path)?.content ?? "";
      },
      readBinary: async () => new ArrayBuffer(0)
    }
  } as never;
  return { plugin, files, reads, savedData };
}

function runIngest(plugin: LLMWikiPlugin): Promise<void> {
  return (plugin as unknown as { ingestActiveSource(): Promise<void> }).ingestActiveSource();
}

test("skips ingest when the raw file mtime and size are unchanged", async () => {
  const requestSpy = jest.spyOn(obsidian, "requestUrl");
  const { plugin, reads } = setup(
    [{ path: "raw/note.md", content: "hello", stat: { mtime: 500, size: 5 } }],
    { openAIApiKey: "key", rawFileState: { "raw/note.md": { hash: hashContent("hello"), mtime: 500, size: 5 } } }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(requestSpy).not.toHaveBeenCalled();
  expect(reads).not.toContain("raw/note.md");
  expect(notices).toContain("ContextOS: no new or changed raw files.");
  expect(modals).toHaveLength(0);
});

test("re-ingests when a legacy string-hash state file changes on disk", async () => {
  const requestSpy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: "Update note page",
      operations: [{ kind: "create", path: "wiki/notes/note.md", content: "# Note", rationale: "capture" }]
    }) } }] })
  } as never);
  const { plugin } = setup(
    [{ path: "raw/note.md", content: "changed", stat: { mtime: 900, size: 7 } }],
    { openAIApiKey: "key", rawFileState: { "raw/note.md": hashContent("original") } }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(requestSpy).toHaveBeenCalledTimes(1);
  expect(notices).toContain("ContextOS: review proposed changes.");
});

test("retries a transient 5xx during ingest, then applies the reviewed changes", async () => {
  const requestSpy = jest.spyOn(obsidian, "requestUrl")
    .mockResolvedValueOnce({ status: 503, text: "unavailable" } as never)
    .mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        summary: "Create note page",
        operations: [{ kind: "create", path: "wiki/notes/note.md", content: "# Note", rationale: "capture" }]
      }) } }] })
    } as never);
  const { plugin, files, savedData } = setup(
    [{ path: "raw/note.md", content: "hello" }],
    { openAIApiKey: "key", rawFileState: {} }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(requestSpy).toHaveBeenCalledTimes(2);
  expect(notices).toContain("ContextOS: review proposed changes.");
  expect(savedData).toHaveLength(0);

  const latestModal = modals[modals.length - 1]!;
  await latestModal.contentEl.buttons[0].onclick();

  expect(files.get("wiki/notes/note.md")?.content).toBe("# Note");
  expect(notices).toContain("ContextOS changes applied.");
});

test("surfaces a truncated-response error during ingest without applying changes", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{\"summary\":\"partial" } }] })
  } as never);
  const { plugin, savedData } = setup(
    [{ path: "raw/note.md", content: "hello" }],
    { openAIApiKey: "key", rawFileState: {} }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(notices).toContain("OpenAI response was truncated. Try fewer sources at once or a model with a larger output limit.");
  expect(modals).toHaveLength(0);
  expect(savedData).toHaveLength(0);
});

test("uses the configured request timeout for completions", async () => {
  jest.spyOn(obsidian, "requestUrl").mockImplementation(() => new Promise(() => undefined) as never);
  const { plugin } = setup(
    [{ path: "raw/note.md", content: "hello" }],
    { openAIApiKey: "key", rawFileState: {}, requestTimeoutMs: 20 }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(notices).toContain("OpenAI request timed out. Check your connection or try again.");
}, 2000);

test("auto-ingest routes a delete-containing plan to review instead of auto-applying", async () => {
  jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      summary: "prune",
      operations: [{ kind: "delete", path: "wiki/orphan.md", rationale: "orphan" }]
    }) } }] })
  } as never);
  const { plugin, files } = setup(
    [{ path: "raw/note.md", content: "hello" }],
    { openAIApiKey: "key", rawFileState: {} }
  );
  files.set("wiki/orphan.md", { path: "wiki/orphan.md", content: "old" });

  await plugin.onload();
  await (plugin as unknown as { runAutoIngest(quiet: boolean): Promise<void> }).runAutoIngest(true);

  expect(modals.length).toBeGreaterThan(0);
  expect(files.has("wiki/orphan.md")).toBe(true);
});

test("re-stamps an unchanged legacy-state file so later scans can fast-path", async () => {
  const requestSpy = jest.spyOn(obsidian, "requestUrl");
  const { plugin, reads, savedData } = setup(
    [{ path: "raw/note.md", content: "hello", stat: { mtime: 900, size: 5 } }],
    { openAIApiKey: "key", rawFileState: { "raw/note.md": hashContent("hello") } }
  );

  await plugin.onload();
  await runIngest(plugin);

  expect(requestSpy).not.toHaveBeenCalled();
  expect(reads).toContain("raw/note.md");
  expect(savedData[savedData.length - 1]).toEqual(expect.objectContaining({
    rawFileState: { "raw/note.md": { hash: hashContent("hello"), mtime: 900, size: 5 } }
  }));
});
