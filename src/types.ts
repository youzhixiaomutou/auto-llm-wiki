export interface RawFileStateEntry {
  hash: string;
  mtime: number;
  size: number;
}

export type RawFileState = Record<string, RawFileStateEntry>;

export interface LLMWikiPluginData {
  rawFileState?: Record<string, string | RawFileStateEntry>;
}

export const LLM_PROVIDER_TYPES = ["openai", "anthropic", "gemini", "ollama", "deepseek", "groq", "openai-compatible"] as const;
export type LLMProviderType = typeof LLM_PROVIDER_TYPES[number];

export type EmbeddingsBackend = "none" | "ollama" | "openai" | "qdrant";

export interface ProviderConfig {
  id: string;
  type: LLMProviderType;
  name: string;
  apiKey: string;
  apiUrl: string;
  model: string;
  enabled: boolean;
}

export interface LLMWikiSettings {
  rawFolder: string;
  wikiFolder: string;
  assetsFolder: string;
  indexPath: string;
  logPath: string;
  // Legacy single-provider fields; migrated to providers[] on load.
  openAIApiUrl: string;
  openAIApiKey: string;
  openAIModel: string;
  providers: ProviderConfig[];
  activeProviderId: string;
  textProviderId: string;
  chatProviderId: string;
  visionProviderId: string;
  autoIngestEnabled: boolean;
  autoIngestDebounceMs: number;
  autoIngestPollSeconds: number;
  requestTimeoutMs: number;
  // Custom prompt templates; empty means use built-in default.
  ingestSystemPrompt: string;
  chatSystemPrompt: string;
  lintSystemPrompt: string;
  ocrPdfPrompt: string;
  ocrImagePrompt: string;
  // OCR
  ocrPageConcurrency: number;
  // Embeddings
  embeddingsBackend: EmbeddingsBackend;
  embeddingsModel: string;
  embeddingsApiKey: string;
  embeddingsApiUrl: string;
  qdrantUrl: string;
  qdrantApiKey: string;
  qdrantCollection: string;
  // Git integration
  gitMode: "none" | "local" | "remote";
  gitRemoteMethod: "ssh-manual" | "ssh-keygen";
  gitRemoteUrl: string;
  gitAutoPush: boolean;
  gitCommitMessageTemplate: string;
  gitHubToken: string;
  gitHubRepoName: string;
  gitSshKeyPath: string;
}

export type FileOperationKind = "create" | "update" | "append" | "prepend" | "delete";

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
  /** A finished answer to persist verbatim (Save-to-wiki), instead of re-deriving one. */
  answer?: string;
  wikiPages?: Array<{ path: string; content: string }>;
  /** Paths of raw sources that still exist, so lint can detect orphaned wiki pages. */
  rawPaths?: string[];
}
