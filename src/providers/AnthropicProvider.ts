import { requestUrl } from "obsidian";
import { ChatRequest, CompleteRequest, ConnectionTestRequest, LLMProvider, VisionCompleteRequest } from "./LLMProvider";
import { BaseProviderOptions, defaultSleep, ProviderError } from "./BaseOpenAICompatibleProvider";

const DEFAULT_ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export class AnthropicProvider implements LLMProvider {
  readonly providerType = "anthropic";

  constructor(private readonly timeoutMs: number = 900000) {}

  async complete(request: CompleteRequest): Promise<string> {
    return this.sendMessage(request.apiKey, request.model, [
      { role: "user", content: request.prompt }
    ], 8192);
  }

  async completeVision(request: VisionCompleteRequest): Promise<string> {
    const mimeType = request.imageDataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/png";
    return this.sendMessage(request.apiKey, request.model, [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: request.imageDataUrl.split(",")[1] } },
          { type: "text", text: request.prompt }
        ]
      }
    ], 4096);
  }

  async chat(request: ChatRequest): Promise<string> {
    const messages = request.messages.map((m) => ({ role: m.role, content: m.content }));
    if (request.onToken) return this.sendMessageStreaming(request.apiKey, request.model, messages, 8192, request.onToken);
    return this.sendMessage(request.apiKey, request.model, messages, 8192);
  }

  private async sendMessageStreaming(
    apiKey: string,
    model: string,
    messages: unknown[],
    maxTokens: number,
    onToken: (token: string) => void
  ): Promise<string> {
    const response = await requestUrl({
      url: DEFAULT_ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
        temperature: 0.2,
        stream: true
      }),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("request", `${response.status}: ${response.text}`);
    }

    let accumulated = "";
    const events = response.text.split("\n\n");
    for (const event of events) {
      const lines = event.split("\n");
      let dataLine = "";
      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        if (line.startsWith("data: ")) dataLine = line.slice(6).trim();
      }
      if (eventType === "content_block_delta" && dataLine) {
        try {
          const parsed = JSON.parse(dataLine) as { delta?: { text?: string } };
          const text = parsed.delta?.text;
          if (text) {
            accumulated += text;
            onToken(text);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
    return accumulated;
  }

  async testConnection(request: ConnectionTestRequest): Promise<void> {
    const response = await requestUrl({
      url: request.apiUrl || DEFAULT_ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": request.apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }]
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("connection", `${response.status}: ${response.text}`);
    }
  }

  private async sendMessage(
    apiKey: string,
    model: string,
    messages: unknown[],
    maxTokens: number
  ): Promise<string> {
    const response = await requestUrl({
      url: DEFAULT_ANTHROPIC_API_URL,
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": DEFAULT_ANTHROPIC_VERSION,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages,
        temperature: 0.2
      }),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("request", `${response.status}: ${response.text}`);
    }

    const parsed = JSON.parse(response.text) as { content?: Array<{ type: string; text?: string }> };
    const text = parsed.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new ProviderError("missing-content", "Response did not include text content");
    return text;
  }
}
