import { requestUrl } from "obsidian";
import { CompleteRequest, ConnectionTestRequest, LLMProvider, VisionCompleteRequest } from "./LLMProvider";

type HttpRequest = {
  url: string;
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
};

type HttpResponse = { status: number; text: string };
type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;
const DEFAULT_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export class OpenAIProviderError extends Error {
  constructor(readonly kind: "connection" | "request" | "missing-content" | "invalid-json", message: string) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

export class OpenAIProvider implements LLMProvider {
  constructor(private readonly httpClient: HttpClient = defaultHttpClient) {}

  async complete(request: CompleteRequest): Promise<string> {
    return this.completeMessages(request, [
      { role: "system", content: "You are a careful Auto LLM Wiki maintainer. Return strict JSON only." },
      { role: "user", content: request.prompt }
    ]);
  }

  async completeVision(request: VisionCompleteRequest): Promise<string> {
    return this.completeMessages(request, [
      { role: "system", content: "You transcribe visible text from document images. Return plain text only." },
      {
        role: "user",
        content: [
          { type: "text", text: request.prompt },
          { type: "image_url", image_url: { url: request.imageDataUrl } }
        ]
      }
    ]);
  }

  async testConnection(request: ConnectionTestRequest): Promise<void> {
    const response = await this.httpClient({
      url: request.apiUrl || DEFAULT_OPENAI_API_URL,
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
    });
    if (response.status < 200 || response.status >= 300) {
      throw new OpenAIProviderError("connection", `${response.status} ${response.text}`);
    }
  }

  private async completeMessages(
    request: CompleteRequest,
    messages: Array<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }>
  ): Promise<string> {
    const response = await this.httpClient({
      url: request.apiUrl || DEFAULT_OPENAI_API_URL,
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: request.model,
          messages,
          temperature: 0.2
        })
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new OpenAIProviderError("request", `${response.status} ${response.text}`);
    }

    const parsed = parseOpenAIResponse(response.text);
    const content = parsed.choices?.[0]?.message?.content;
    if (!content) throw new OpenAIProviderError("missing-content", "Response did not include message content");
    return content;
  }
}

function parseOpenAIResponse(text: string): { choices?: Array<{ message?: { content?: string } }> } {
  try {
    return JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  } catch (error) {
    throw new OpenAIProviderError("invalid-json", "Response was not JSON. Check the API URL; it should point to a chat completions endpoint.");
  }
}

async function defaultHttpClient(request: HttpRequest): Promise<HttpResponse> {
  return requestUrl({
    url: request.url,
    method: request.options.method,
    headers: request.options.headers,
    body: request.options.body
  });
}
