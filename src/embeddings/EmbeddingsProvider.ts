export interface StoredEmbedding {
  path: string;
  hash: string;
  embedding: number[];
}

export interface EmbeddingsProvider {
  embed(text: string): Promise<number[]>;
  search(queryEmbedding: number[], embeddings: StoredEmbedding[], topK: number): StoredEmbedding[];
}
