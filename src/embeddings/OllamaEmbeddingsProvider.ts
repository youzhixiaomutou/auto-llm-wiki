import { requestUrl } from "obsidian";
import { EmbeddingsProvider, StoredEmbedding } from "./EmbeddingsProvider";

export class OllamaEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    private readonly apiUrl: string,
    private readonly model: string
  ) {}

  async embed(text: string): Promise<number[]> {
    const response = await requestUrl({
      url: this.apiUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Ollama embeddings request failed: ${response.status} ${response.text}`);
    }
    const parsed = JSON.parse(response.text) as { embeddings?: number[][] };
    const embedding = parsed.embeddings?.[0];
    if (!embedding || embedding.length === 0) {
      throw new Error("Ollama embeddings response did not include a valid embedding vector");
    }
    return embedding;
  }

  search(queryEmbedding: number[], embeddings: StoredEmbedding[], topK: number): StoredEmbedding[] {
    return cosineSearch(queryEmbedding, embeddings, topK);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dot / denominator;
}

export function cosineSearch(queryEmbedding: number[], embeddings: StoredEmbedding[], topK: number): StoredEmbedding[] {
  const scored = embeddings.map((e) => ({
    embedding: e,
    score: cosineSimilarity(queryEmbedding, e.embedding)
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((s) => s.embedding);
}
