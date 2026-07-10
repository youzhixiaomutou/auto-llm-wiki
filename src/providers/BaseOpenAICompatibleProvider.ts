import { requestUrl } from "obsidian";
import { ChatRequest, CompleteRequest, ConnectionTestRequest, LLMProvider, VisionCompleteRequest } from "./LLMProvider";

export type HttpRequest = {
  url: string;
  options: {
    method: string;
    headers: Record<string, string>;
    body: string;
  };
};

export type HttpResponse = { status: number; text: string; headers?: Record<string, string> };
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export const DEFAULT_OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 900000;
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_AFTER_MS = 60000;

export interface BaseProviderOptions {
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

export class ProviderError extends Error {
  constructor(readonly kind: "connection" | "request" | "missing-content" | "invalid-json" | "truncated" | "timeout", message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

type OpenAIMessage = { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> };

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function retryAfterMs(response: HttpResponse): number | undefined {
  const raw = response.headers?.["retry-after"] ?? response.headers?.["Retry-After"];
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

export function parseOpenAIResponse(text: string): { choices?: Array<{ finish_reason?: string; message?: { content?: string; delta?: { content?: string } } }> } {
  try {
    return JSON.parse(text) as { choices?: Array<{ finish_reason?: string; message?: { content?: string; delta?: { content?: string } } }> };
  } catch {
    throw new ProviderError("invalid-json", "Response was not JSON. Check the API URL; it should point to a chat completions endpoint.");
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function defaultHttpClient(request: HttpRequest): Promise<HttpResponse> {
  const response = await requestUrl({
    url: request.url,
    method: request.options.method,
    headers: request.options.headers,
    body: request.options.body,
    throw: false
  });
  return { status: response.status, text: response.text, headers: response.headers };
}

export abstract class BaseOpenAICompatibleProvider implements LLMProvider {
  protected readonly sleep: (ms: number) => Promise<void>;
  protected readonly maxAttempts: number;
  protected readonly timeoutMs: number;

  constructor(httpClient: HttpClient = defaultHttpClient, options: BaseProviderOptions = {}) {
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.httpClient = httpClient;
  }

  protected readonly httpClient: HttpClient;

  abstract get defaultApiUrl(): string;
  abstract get providerType(): string;

  protected async withTimeout(promise: Promise<HttpResponse>): Promise<HttpResponse> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError("timeout", "Request timed out")), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  protected async sendWithRetry(request: HttpRequest): Promise<HttpResponse> {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await this.withTimeout(this.httpClient(request));
        if (attempt < this.maxAttempts && isRetryableStatus(response.status)) {
          const delay = (response.status === 429 ? retryAfterMs(response) : undefined) ?? retryDelayMs(attempt);
          await this.sleep(delay);
          continue;
        }
        return response;
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "timeout") throw error;
        if (attempt >= this.maxAttempts) throw error;
        await this.sleep(retryDelayMs(attempt));
      }
    }
  }

  protected async completeMessages(
    apiKey: string,
    apiUrl: string,
    model: string,
    messages: OpenAIMessage[],
    rejectOnTruncation = false,
    onToken?: (token: string) => void
  ): Promise<string> {
    if (onToken) return this.completeMessagesStreaming(apiKey, apiUrl, model, messages, onToken);
    return this.completeMessagesNonStreaming(apiKey, apiUrl, model, messages, rejectOnTruncation);
  }

  private async completeMessagesNonStreaming(
    apiKey: string,
    apiUrl: string,
    model: string,
    messages: OpenAIMessage[],
    rejectOnTruncation = false
  ): Promise<string> {
    const response = await this.sendWithRetry({
      url: apiUrl || this.defaultApiUrl,
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2
        })
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("request", `${response.status} ${response.text}`);
    }

    const parsed = parseOpenAIResponse(response.text);
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;
    if (rejectOnTruncation && choice?.finish_reason === "length") {
      throw new ProviderError("truncated", "Response was truncated before completion");
    }
    if (!content) throw new ProviderError("missing-content", "Response did not include message content");
    return content;
  }

  private async completeMessagesStreaming(
    apiKey: string,
    apiUrl: string,
    model: string,
    messages: OpenAIMessage[],
    onToken: (token: string) => void
  ): Promise<string> {
    const response = await this.sendWithRetry({
      url: apiUrl || this.defaultApiUrl,
      options: {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream"
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: true
        })
      }
    });

    if (response.status < 200 || response.status >= 300) {
      throw new ProviderError("request", `${response.status} ${response.text}`);
    }

    let accumulated = "";
    const events = response.text.split("\n\n");
    for (const event of events) {
      const lines = event.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            onToken(delta);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
        } catch {
          // Skip unparseable chunks
        }
      }
    }
    return accumulated;
  }

  abstract complete(request: CompleteRequest): Promise<string>;
  abstract completeVision(request: VisionCompleteRequest): Promise<string>;
  abstract chat(request: ChatRequest): Promise<string>;
  abstract testConnection(request: ConnectionTestRequest): Promise<void>;
}
