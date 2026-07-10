import { App, normalizePath } from "obsidian";
import { LLMWikiSettings } from "../types";
import { StoredEmbedding } from "./EmbeddingsProvider";

export class EmbeddingsStore {
  private folder: string;

  constructor(
    private readonly app: App,
    private readonly settings: LLMWikiSettings
  ) {
    this.folder = normalizePath(`${this.settings.wikiFolder}/.embeddings`);
  }

  private filePath(pagePath: string, hash: string): string {
    const sanitized = pagePath.replace(/[/\\:]/g, "-");
    return normalizePath(`${this.folder}/page-${sanitized}-${hash}.json`);
  }

  async loadAll(): Promise<StoredEmbedding[]> {
    const embeddings: StoredEmbedding[] = [];
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(this.folder));
    let primaryDim = 0;
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const parsed = JSON.parse(content) as StoredEmbedding;
        if (parsed.path && parsed.hash && Array.isArray(parsed.embedding)) {
          if (primaryDim === 0) primaryDim = parsed.embedding.length;
          // Skip embeddings with mismatched dimensions (model changed)
          if (parsed.embedding.length === primaryDim) {
            embeddings.push(parsed);
          }
        }
      } catch {
        // Skip corrupt files
      }
    }
    return embeddings;
  }

  async save(pagePath: string, hash: string, embedding: number[]): Promise<void> {
    // Remove any existing embedding for this page path
    await this.deleteByPath(pagePath);

    const content = JSON.stringify({ path: pagePath, hash, embedding });
    const fp = this.filePath(pagePath, hash);
    // Ensure the .embeddings folder exists
    try {
      await this.app.vault.createFolder(this.folder);
    } catch {
      // Folder likely already exists
    }
    await this.app.vault.create(fp, content);
  }

  async deleteByPath(pagePath: string): Promise<void> {
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(this.folder));
    for (const file of files) {
      try {
        const content = await this.app.vault.read(file);
        const parsed = JSON.parse(content) as StoredEmbedding;
        if (parsed.path === pagePath) {
          await this.app.vault.delete(file);
        }
      } catch {
        // Skip corrupt, keep scanning
      }
    }
  }
}
