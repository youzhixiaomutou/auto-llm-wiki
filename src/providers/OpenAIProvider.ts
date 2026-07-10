import { ChatRequest, CompleteRequest, ConnectionTestRequest, VisionCompleteRequest } from "./LLMProvider";
import { BaseOpenAICompatibleProvider, DEFAULT_OPENAI_API_URL, ProviderError, BaseProviderOptions, HttpClient, defaultHttpClient, parseOpenAIResponse } from "./BaseOpenAICompatibleProvider";

export class OpenAIProviderError extends ProviderError {
  constructor(kind: "connection" | "request" | "missing-content" | "invalid-json" | "truncated" | "timeout", message: string) {
    super(kind, message);
    this.name = "OpenAIProviderError";
  }
}

function toOpenAIError(error: unknown): OpenAIProviderError {
  if (error instanceof ProviderError) {
    return new OpenAIProviderError(error.kind, error.message);
  }
  if (error instanceof Error) return new OpenAIProviderError("request", error.message);
  return new OpenAIProviderError("request", String(error));
}

export class OpenAIProvider extends BaseOpenAICompatibleProvider {
  readonly providerType = "openai";
  get defaultApiUrl(): string { return DEFAULT_OPENAI_API_URL; }

  constructor(httpClient: HttpClient = defaultHttpClient, options: BaseProviderOptions = {}) {
    super(httpClient, options);
  }

  async complete(request: CompleteRequest): Promise<string> {
    try {
      return await this.completeMessages(
        request.apiKey, request.apiUrl || this.defaultApiUrl, request.model,
        [
          { role: "system", content: "You are a careful ContextOS maintainer. Return strict JSON only." },
          { role: "user", content: request.prompt }
        ], true
      );
    } catch (error) { throw toOpenAIError(error); }
  }

  async completeVision(request: VisionCompleteRequest): Promise<string> {
    try {
      return await this.completeMessages(
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
    } catch (error) { throw toOpenAIError(error); }
  }

  async chat(request: ChatRequest): Promise<string> {
    try {
      return await this.completeMessages(
        request.apiKey, request.apiUrl || this.defaultApiUrl, request.model,
        request.messages, false, request.onToken
      );
    } catch (error) { throw toOpenAIError(error); }
  }

  async testConnection(request: ConnectionTestRequest): Promise<void> {
    try {
      const response = await this.withTimeout(this.httpClient({
        url: request.apiUrl || this.defaultApiUrl,
        options: {
          method: "POST",
          headers: {
            Authorization: `Bearer ${request.apiKey}`,
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
        throw new OpenAIProviderError("connection", `${response.status} ${response.text}`);
      }
    } catch (error) { throw toOpenAIError(error); }
  }
}
