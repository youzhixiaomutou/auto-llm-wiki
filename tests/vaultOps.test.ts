import * as obsidian from "obsidian";
import { applyChangePlan, ensureMarkdownPath, isRawPath, listMarkdownFilePaths, readWikiPages } from "../src/vaultOps";
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

test("listMarkdownFilePaths returns wiki page paths without reading content", () => {
  const read = jest.fn();
  const app = {
    vault: {
      getMarkdownFiles: () => [{ path: "wiki/a.md" }, { path: "wiki/b.md" }, { path: "raw/c.md" }],
      read
    }
  };

  const paths = listMarkdownFilePaths(app as never, "wiki");

  expect(paths).toEqual(["wiki/a.md", "wiki/b.md"]);
  expect(read).not.toHaveBeenCalled();
});

test("readWikiPages reads only the requested existing pages", async () => {
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const store = new Map<string, string>([["wiki/a.md", "A"], ["wiki/b.md", "B"]]);
  const readPaths: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (store.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => {
        readPaths.push(file.path);
        return store.get(file.path) ?? "";
      }
    }
  };

  const pages = await readWikiPages(app as never, ["wiki/a.md", "wiki/missing.md"]);

  expect(pages).toEqual([{ path: "wiki/a.md", content: "A" }]);
  expect(readPaths).toEqual(["wiki/a.md"]);
});

test("pre-validates the plan and writes nothing when a create targets an existing file", async () => {
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const store = new Map<string, string>([["wiki/exists.md", "e"]]);
  const created: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (store.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => store.get(file.path) ?? "",
      create: async (path: string, content: string) => { created.push(path); store.set(path, content); },
      modify: async () => undefined,
      delete: async () => undefined,
      createFolder: async () => undefined
    }
  };

  await expect(applyChangePlan(app as never, {
    summary: "x",
    operations: [
      { kind: "create", path: "wiki/new.md", content: "a", rationale: "r" },
      { kind: "create", path: "wiki/exists.md", content: "b", rationale: "r" }
    ]
  })).rejects.toThrow();

  expect(created).toEqual([]);
});

test("rejects writing to a path occupied by a folder", async () => {
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === "wiki/foo.md" ? { path } : null),
      read: async () => "",
      create: jest.fn(),
      modify: jest.fn(),
      delete: jest.fn(),
      createFolder: async () => undefined
    }
  };

  await expect(applyChangePlan(app as never, {
    summary: "x",
    operations: [{ kind: "update", path: "wiki/foo.md", content: "a", rationale: "r" }]
  })).rejects.toThrow("a folder exists");

  expect(app.vault.create).not.toHaveBeenCalled();
  expect(app.vault.modify).not.toHaveBeenCalled();
});

test("rolls back created and modified files when a later operation fails", async () => {
  const TFileMock = obsidian.TFile as unknown as { new(path: string): obsidian.TFile };
  const store = new Map<string, string>([["wiki/b.md", "original-b"]]);
  const deleted: string[] = [];
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (store.has(path) ? new TFileMock(path) : null),
      read: async (file: { path: string }) => store.get(file.path) ?? "",
      create: async (path: string, content: string) => {
        if (path === "wiki/c.md") throw new Error("disk fail");
        store.set(path, content);
      },
      modify: async (file: { path: string }, content: string) => { store.set(file.path, content); },
      delete: async (file: { path: string }) => { deleted.push(file.path); store.delete(file.path); },
      createFolder: async () => undefined
    }
  };

  await expect(applyChangePlan(app as never, {
    summary: "x",
    operations: [
      { kind: "create", path: "wiki/a.md", content: "new-a", rationale: "r" },
      { kind: "update", path: "wiki/b.md", content: "changed-b", rationale: "r" },
      { kind: "create", path: "wiki/c.md", content: "x", rationale: "r" }
    ]
  })).rejects.toThrow("disk fail");

  expect(store.has("wiki/a.md")).toBe(false);
  expect(deleted).toContain("wiki/a.md");
  expect(store.get("wiki/b.md")).toBe("original-b");
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
