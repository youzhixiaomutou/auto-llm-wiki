import { buildIngestPrompt, buildLintPrompt, buildQueryPrompt, buildQuerySelectionPrompt, parseSelectedQueryPages } from "../src/prompts";
import { DEFAULT_SETTINGS } from "../src/settings";
import { __setLanguage } from "./obsidianMock";

beforeEach(() => {
  __setLanguage("en");
});

test("ingest prompt asks for strict JSON change plan", () => {
  const prompt = buildIngestPrompt({ index: "# Index", log: "# Log", sourcePath: "raw/a.md", sourceContent: "hello" });
  expect(prompt).toContain("Return only JSON");
  expect(prompt).toContain("raw/a.md");
  expect(prompt).toContain("create");
  expect(prompt).toContain("update");
  expect(prompt).toContain("append");
});

test("ingest prompt asks for newest-first log prepends", () => {
  const prompt = buildIngestPrompt({ index: "# Index", log: "# Log", sourcePath: "raw/a.md", sourceContent: "hello" });

  expect(prompt).toContain('"kind": "prepend"');
  expect(prompt).toContain("newest-first");
  expect(prompt).toContain("Use prepend for new entries in wiki/log.md");
});

test("ingest prompt uses Simplified Chinese output instruction for zh locale", () => {
  __setLanguage("zh");

  const prompt = buildIngestPrompt({ index: "# Index", log: "# Log", sourcePath: "raw/a.md", sourceContent: "hello" });

  expect(prompt).toContain("Write user-visible natural-language output in Simplified Chinese.");
});

test("query prompt includes question and asks for saveable result", () => {
  const prompt = buildQueryPrompt({ index: "# Index", log: "", question: "What changed?", wikiPages: [] });
  expect(prompt).toContain("What changed?");
  expect(prompt).toContain("optional wiki page");
});

test("lint prompt asks for contradictions and orphan pages", () => {
  const prompt = buildLintPrompt({ index: "# Index", log: "# Log", wikiPages: [{ path: "wiki/a.md", content: "A" }] });
  expect(prompt).toContain("contradictions");
  expect(prompt).toContain("orphan");
});

test("query selection prompt lists page paths and asks for a JSON array", () => {
  const prompt = buildQuerySelectionPrompt({
    index: "# Index",
    question: "What is X?",
    pagePaths: ["wiki/x.md", "wiki/y.md"]
  });
  expect(prompt).toContain("What is X?");
  expect(prompt).toContain("wiki/x.md");
  expect(prompt).toContain("wiki/y.md");
  expect(prompt).toContain("JSON array");
});

test("parseSelectedQueryPages keeps only known paths and caps the count", () => {
  const selected = parseSelectedQueryPages(
    '["wiki/a.md","wiki/b.md","wiki/ghost.md","wiki/c.md"]',
    ["wiki/a.md", "wiki/b.md", "wiki/c.md", "wiki/d.md"],
    2
  );
  expect(selected).toEqual(["wiki/a.md", "wiki/b.md"]);
});

test("parseSelectedQueryPages parses fenced JSON", () => {
  const selected = parseSelectedQueryPages("```json\n[\"wiki/a.md\"]\n```", ["wiki/a.md", "wiki/b.md"], 5);
  expect(selected).toEqual(["wiki/a.md"]);
});

test("parseSelectedQueryPages falls back to the first pages when the response is unusable", () => {
  const selected = parseSelectedQueryPages("all pages are relevant", ["wiki/a.md", "wiki/b.md", "wiki/c.md"], 2);
  expect(selected).toEqual(["wiki/a.md", "wiki/b.md"]);
});

test("prompt contract uses configured wiki paths", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    rawFolder: "sources",
    wikiFolder: "knowledge",
    assetsFolder: "sources/assets",
    indexPath: "knowledge/home.md",
    logPath: "knowledge/timeline.md"
  };
  const prompt = buildIngestPrompt(
    { index: "# Index", log: "# Log", sourcePath: "sources/a.md", sourceContent: "hello" },
    settings
  );
  expect(prompt).toContain("knowledge/example.md");
  expect(prompt).toContain("knowledge/home.md");
  expect(prompt).toContain("knowledge/timeline.md");
  expect(prompt).toContain("sources");
  expect(prompt).not.toContain("wiki/index.md");
  expect(prompt).not.toContain("wiki/log.md");
});
