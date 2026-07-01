export type LLMProviderId = "openai";

export interface RawFileStateEntry {
  hash: string;
  mtime: number;
  size: number;
}

export type RawFileState = Record<string, RawFileStateEntry>;

export interface LLMWikiPluginData {
  rawFileState?: Record<string, string | RawFileStateEntry>;
}

export interface LLMWikiSettings {
  rawFolder: string;
  wikiFolder: string;
  assetsFolder: string;
  indexPath: string;
  logPath: string;
  provider: LLMProviderId;
  openAIApiUrl: string;
  openAIApiKey: string;
  openAIModel: string;
  autoIngestEnabled: boolean;
  autoIngestDebounceMs: number;
}

export type FileOperationKind = "create" | "update" | "append" | "prepend";

export interface FileOperation {
  kind: FileOperationKind;
  path: string;
  content: string;
  rationale: string;
}

export interface ChangePlan {
  summary: string;
  operations: FileOperation[];
}

export interface WikiContext {
  index: string;
  log: string;
  sourcePath?: string;
  sourceContent?: string;
  sources?: Array<{ path: string; content: string }>;
  question?: string;
  wikiPages?: Array<{ path: string; content: string }>;
}
