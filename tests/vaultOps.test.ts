import * as obsidian from "obsidian";
import { applyChangePlan, ensureMarkdownPath, isRawPath } from "../src/vaultOps";
import { DEFAULT_SETTINGS } from "../src/settings";

test("detects raw paths", () => {
  expect(isRawPath("raw/source.md", DEFAULT_SETTINGS)).toBe(true);
  expect(isRawPath("wiki/page.md", DEFAULT_SETTINGS)).toBe(false);
});

test("requires markdown file extension", () => {
  expect(ensureMarkdownPath("wiki/page.md")).toBe("wiki/page.md");
  expect(() => ensureMarkdownPath("wiki/page.txt")).toThrow("Markdown files");
});

test("creates missing parent folders before creating files", async () => {
  const createdFolders: string[] = [];
  const createdFiles: Array<{ path: string; content: string }> = [];
  const existing = new Set<string>();
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => existing.has(path) ? { path } : null,
      createFolder: async (path: string) => {
        createdFolders.push(path);
        existing.add(path);
      },
      create: async (path: string, content: string) => {
        createdFiles.push({ path, content });
      }
    }
  };

  await applyChangePlan(app as never, {
    summary: "Create nested page",
    operations: [{ kind: "create", path: "wiki/topics/page.md", content: "# Page", rationale: "test" }]
  });

  expect(createdFolders).toEqual(["wiki", "wiki/topics"]);
  expect(createdFiles).toEqual([{ path: "wiki/topics/page.md", content: "# Page" }]);
});

test("prepends content before an existing markdown file", async () => {
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile & { content: string } };
  const file = new TFileMock("wiki/log.md");
  file.content = "older entry";
  const existing = new Map<string, obsidian.TFile & { content: string }>([
    ["wiki/log.md", file]
  ]);
  const modify = jest.fn(async (target: obsidian.TFile & { content: string }, content: string) => {
    target.content = content;
  });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => existing.get(path) ?? null,
      read: async (target: obsidian.TFile & { content: string }) => target.content,
      modify,
      createFolder: jest.fn(),
      create: jest.fn()
    }
  };

  await applyChangePlan(app as never, {
    summary: "prepend log",
    operations: [{ kind: "prepend", path: "wiki/log.md", content: "new entry", rationale: "latest first" }]
  });

  expect(modify).toHaveBeenCalledWith(file, "new entry\n\nolder entry");
});

test("creates missing markdown file for prepend operations", async () => {
  const existing = new Map<string, { path: string; content: string }>();
  const create = jest.fn(async (path: string, content: string) => {
    existing.set(path, { path, content });
  });
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => existing.get(path) ?? null,
      read: jest.fn(),
      modify: jest.fn(),
      createFolder: jest.fn(),
      create
    }
  };

  await applyChangePlan(app as never, {
    summary: "create log",
    operations: [{ kind: "prepend", path: "wiki/log.md", content: "first entry", rationale: "start log" }]
  });

  expect(create).toHaveBeenCalledWith("wiki/log.md", "first entry");
});
