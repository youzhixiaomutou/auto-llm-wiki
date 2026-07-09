import { requestUrl } from "obsidian";
import { EmbeddingsProvider, StoredEmbedding } from "./EmbeddingsProvider";

export class QdrantEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly collection: string,
    private readonly model: string
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await requestUrl({
      url: `${this.url}/collections/${this.collection}/points/embed`,
      method: "POST",
      headers: {
        "api-key": this.apiKey || "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ input: text, model: this.model }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Qdrant embed request failed: ${response.status} ${response.text}`);
    }
    const parsed = JSON.parse(response.text) as { embedding?: number[] };
    if (!parsed.embedding || parsed.embedding.length === 0) {
      throw new Error("Qdrant response did not include a valid embedding vector");
    }
    return parsed.embedding;
  }

  search(queryEmbedding: number[], _embeddings: StoredEmbedding[], topK: number): StoredEmbedding[] {
    throw new Error("Qdrant search must be called via searchRemote, not local cosine similarity");
  }

  async searchRemote(queryEmbedding: number[], topK: number): Promise<StoredEmbedding[]> {
    const response = await requestUrl({
      url: `${this.url}/collections/${this.collection}/points/search`,
      method: "POST",
      headers: {
        "api-key": this.apiKey || "",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ vector: queryEmbedding, limit: topK }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Qdrant search request failed: ${response.status} ${response.text}`);
    }
    const parsed = JSON.parse(response.text) as { result?: Array<{ payload?: { path?: string; hash?: string }; vector?: number[] }> };
    return (parsed.result ?? []).map((r) => ({
      path: r.payload?.path ?? "",
      hash: r.payload?.hash ?? "",
      embedding: r.vector ?? []
    }));
  }
}
