import { requestUrl } from "obsidian";
import { ChatRequest, CompleteRequest, ConnectionTestRequest, LLMProvider, VisionCompleteRequest } from "./LLMProvider";
import { ProviderError } from "./BaseOpenAICompatibleProvider";

const DEFAULT_GEMINI_API_URL_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiProvider implements LLMProvider {
  readonly providerType = "gemini";

  constructor(private readonly timeoutMs: number = 900000) {}

  async complete(request: CompleteRequest): Promise<string> {
    return this.generateContent(request.apiKey, request.model, [
      { role: "user", parts: [{ text: request.prompt }] }
    ]);
  }

  async completeVision(request: VisionCompleteRequest): Promise<string> {
    const mimeType = request.imageDataUrl.match(/^data:([^;]+)/)?.[1] ?? "image/png";
    return this.generateContent(request.apiKey, request.model, [
      {
        role: "user",
        parts: [
          { text: request.prompt },
          { inline_data: { mime_type: mimeType, data: request.imageDataUrl.split(",")[1] } }
        ]
      }
    ]);
  }

  async chat(request: ChatRequest): Promise<string> {
    const contents = request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    if (request.onToken) return this.generateContentStreaming(request.apiKey, request.model, contents, request.onToken);
    return this.generateContent(request.apiKey, request.model, contents);
  }

  private async generateContentStreaming(
    apiKey: string,
    model: string,
    contents: unknown[],
    onToken: (token: string) => void
  ): Promise<string> {
    const url = `${DEFAULT_GEMINI_API_URL_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.2 }
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
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        try {
          const parsed = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
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
    const url = `${request.apiUrl || `${DEFAULT_GEMINI_API_URL_BASE}/${request.model}:generateContent`}?key=${request.apiKey}`;
    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "ping" }] }],
        generationConfig: { maxOutputTokens: 1 }
      }),
      throw: false
    });
    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("connection", `${response.status}: ${response.text}`);
    }
  }

  private async generateContent(
    apiKey: string,
    model: string,
    contents: unknown[]
  ): Promise<string> {
    const url = `${DEFAULT_GEMINI_API_URL_BASE}/${model}:generateContent?key=${apiKey}`;
    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        generationConfig: { temperature: 0.2 }
      }),
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("request", `${response.status}: ${response.text}`);
    }

    const parsed = JSON.parse(response.text) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    };
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new ProviderError("missing-content", "Response did not include text content");
    return text;
  }
}
