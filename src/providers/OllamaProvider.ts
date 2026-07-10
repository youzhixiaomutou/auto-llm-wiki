import { ChatRequest, CompleteRequest, ConnectionTestRequest, VisionCompleteRequest } from "./LLMProvider";
import { BaseOpenAICompatibleProvider, BaseProviderOptions, HttpClient, defaultHttpClient, ProviderError } from "./BaseOpenAICompatibleProvider";

const DEFAULT_OLLAMA_API_URL = "http://localhost:11434/v1/chat/completions";

export class OllamaProvider extends BaseOpenAICompatibleProvider {
  readonly providerType = "ollama";
  get defaultApiUrl(): string { return DEFAULT_OLLAMA_API_URL; }

  constructor(httpClient: HttpClient = defaultHttpClient, options: BaseProviderOptions = {}) {
    super(httpClient, options);
  }

  async complete(request: CompleteRequest): Promise<string> {
    return this.completeMessages(
      request.apiKey, request.apiUrl || this.defaultApiUrl, request.model,
      [
        { role: "system", content: "You are a careful ContextOS maintainer. Return strict JSON only." },
        { role: "user", content: request.prompt }
      ], true
    );
  }

  async completeVision(request: VisionCompleteRequest): Promise<string> {
    return this.completeMessages(
      request.apiKey, request.apiUrl || this.defaultApiUrl, request.model,
      [
        { role: "system", content: "You transcribe visible text from document images. Return plain text only." },
        {
          role: "user",
          content: [
            { type: "text", text: request.prompt },
            { type: "image_url", image_url: { url: request.imageDataUrl } }
          ]
        }
      ], false
    );
  }

  async chat(request: ChatRequest): Promise<string> {
    return this.completeMessages(
      request.apiKey, request.apiUrl || this.defaultApiUrl, request.model,
      request.messages, false, request.onToken
    );
  }

  async testConnection(request: ConnectionTestRequest): Promise<void> {
    const response = await this.withTimeout(this.httpClient({
      url: request.apiUrl || this.defaultApiUrl,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      }
    }));
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("connection", `${response.status} ${response.text}`);
    }
  }
}
