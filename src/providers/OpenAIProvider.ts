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
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 120000;
const RETRY_BASE_DELAY_MS = 500;

interface OpenAIProviderOptions {
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

export class OpenAIProviderError extends Error {
  constructor(readonly kind: "connection" | "request" | "missing-content" | "invalid-json" | "truncated" | "timeout", message: string) {
    super(message);
    this.name = "OpenAIProviderError";
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

export class OpenAIProvider implements LLMProvider {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly timeoutMs: number;

  constructor(private readonly httpClient: HttpClient = defaultHttpClient, options: OpenAIProviderOptions = {}) {
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async withTimeout(promise: Promise<HttpResponse>): Promise<HttpResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new OpenAIProviderError("timeout", "Request timed out")), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async sendWithRetry(request: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.withTimeout(this.httpClient(request));
        if (attempt < this.maxAttempts && isRetryableStatus(response.status)) {
          await this.sleep(retryDelayMs(attempt));
          continue;
        }
        return response;
      } catch (error) {
        if (attempt >= this.maxAttempts) throw error;
        await this.sleep(retryDelayMs(attempt));
      }
    }
  }

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
    const response = await this.sendWithRetry({
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
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (!content) throw new OpenAIProviderError("missing-content", "Response did not include message content");
    if (choice?.finish_reason === "length") {
      throw new OpenAIProviderError("truncated", "Response was truncated before completion");
    }
    return content;
  }
}

function parseOpenAIResponse(text: string): { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> } {
  try {
    return JSON.parse(text) as { choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
  } catch (error) {
    throw new OpenAIProviderError("invalid-json", "Response was not JSON. Check the API URL; it should point to a chat completions endpoint.");
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultHttpClient(request: HttpRequest): Promise<HttpResponse> {
  return requestUrl({
    url: request.url,
    method: request.options.method,
    headers: request.options.headers,
    body: request.options.body
  });
}
