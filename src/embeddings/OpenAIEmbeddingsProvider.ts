import { requestUrl } from "obsidian";
import { EmbeddingsProvider, StoredEmbedding } from "./EmbeddingsProvider";
import { cosineSearch } from "./OllamaEmbeddingsProvider";

export class OpenAIEmbeddingsProvider implements EmbeddingsProvider {
  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string,
    private readonly model: string
  ) {}

  async embed(text: string): Promise<number[]> {
    const url = this.apiUrl || "https://api.openai.com/v1/embeddings";
    const response = await requestUrl({
      url,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: this.model, input: text }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`OpenAI embeddings request failed: ${response.status} ${response.text}`);
    }
    const parsed = JSON.parse(response.text) as { data?: Array<{ embedding?: number[] }> };
    const embedding = parsed.data?.[0]?.embedding;
    if (!embedding || embedding.length === 0) {
      throw new Error("OpenAI embeddings response did not include a valid embedding vector");
    }
    return embedding;
  }

  search(queryEmbedding: number[], embeddings: StoredEmbedding[], topK: number): StoredEmbedding[] {
    return cosineSearch(queryEmbedding, embeddings, topK);
  }
}
