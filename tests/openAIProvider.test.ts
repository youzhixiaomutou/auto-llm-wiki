import * as obsidian from "obsidian";
import { OpenAIProvider } from "../src/providers/OpenAIProvider";

afterEach(() => {
  jest.restoreAllMocks();
});

test("sends chat completion request and returns text", async () => {
  const calls: Array<{ url: string; options: { body: string; headers: Record<string, string>; method: string } }> = [];
  const provider = new OpenAIProvider(async (request) => {
    calls.push(request);
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "{\"summary\":\"ok\",\"operations\":[]}" } }] }) };
  });

  const result = await provider.complete({ apiKey: "key", model: "gpt-test", prompt: "hello" });

  expect(result).toContain("summary");
  expect(calls[0].url).toBe("https://api.openai.com/v1/chat/completions");
  expect(calls[0].options.headers.Authorization).toBe("Bearer key");
  expect(JSON.parse(calls[0].options.body).model).toBe("gpt-test");
});

test("sends vision chat completion request and returns OCR text", async () => {
  const calls: Array<{ url: string; options: { body: string; headers: Record<string, string>; method: string } }> = [];
  const provider = new OpenAIProvider(async (request) => {
    calls.push(request);
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "OCR text" } }] }) };
  });

  const result = await provider.completeVision({
    apiKey: "key",
    model: "vision-model",
    prompt: "Transcribe",
    imageDataUrl: "data:image/png;base64,abc"
  });

  const body = JSON.parse(calls[0].options.body);
  expect(result).toBe("OCR text");
  expect(body.messages[1].content[0]).toEqual({ type: "text", text: "Transcribe" });
  expect(body.messages[1].content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,abc" } });
});

test("tests configured endpoint with HTTP-only validation", async () => {
  const calls: Array<{ url: string; options: { body: string; headers: Record<string, string>; method: string } }> = [];
  const provider = new OpenAIProvider(async (request) => {
    calls.push(request);
    return { status: 204, text: "" };
  });

  await provider.testConnection({
    apiKey: "key",
    apiUrl: "https://example.test/v1/chat/completions",
    model: "test-model"
  });

  const body = JSON.parse(calls[0].options.body);
  expect(calls[0].url).toBe("https://example.test/v1/chat/completions");
  expect(calls[0].options.headers.Authorization).toBe("Bearer key");
  expect(body.model).toBe("test-model");
  expect(body.max_tokens).toBe(1);
});

test("connection test exposes raw provider error for non-2xx response", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 500, text: "server error" }));

  await expect(provider.testConnection({ apiKey: "key", model: "test-model" }))
    .rejects.toMatchObject({
      name: "OpenAIProviderError",
      kind: "connection",
      message: "500 server error"
    });
});

test("completion exposes raw provider error for non-2xx response", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 401, text: "bad key" }));

  await expect(provider.complete({ apiKey: "bad", model: "gpt-test", prompt: "hello" }))
    .rejects.toMatchObject({
      name: "OpenAIProviderError",
      kind: "request",
      message: "401 bad key"
    });
});

test("uses custom chat completions URL", async () => {
  const calls: Array<{ url: string; options: { body: string; headers: Record<string, string>; method: string } }> = [];
  const provider = new OpenAIProvider(async (request) => {
    calls.push(request);
    return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
  });

  await provider.complete({
    apiKey: "key",
    model: "custom-model",
    prompt: "hello",
    apiUrl: "https://example.test/v1/chat/completions"
  });

  expect(calls[0].url).toBe("https://example.test/v1/chat/completions");
});

test("throws structured provider error when successful response is missing message content", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 200, text: JSON.stringify({ choices: [{ message: {} }] }) }));

  await expect(provider.complete({
    apiKey: "key",
    model: "custom-model",
    prompt: "hello"
  })).rejects.toMatchObject({
    name: "OpenAIProviderError",
    kind: "missing-content",
    message: "Response did not include message content"
  });
});

test("throws structured provider error when successful response is not JSON", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 200, text: "<!doctype html><html></html>" }));

  await expect(provider.complete({
    apiKey: "key",
    model: "custom-model",
    prompt: "hello",
    apiUrl: "https://example.test"
  })).rejects.toMatchObject({
    name: "OpenAIProviderError",
    kind: "invalid-json",
    message: "Response was not JSON. Check the API URL; it should point to a chat completions endpoint."
  });
});

const okResponse = { status: 200, text: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) };
const noop = async () => undefined;

test("default http client requests with throw:false so non-2xx is returned, not thrown", async () => {
  const spy = jest.spyOn(obsidian, "requestUrl").mockResolvedValue({
    status: 200,
    text: JSON.stringify({ choices: [{ message: { content: "ok" } }] })
  } as never);

  await new OpenAIProvider().complete({ apiKey: "k", model: "m", prompt: "p" });

  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ throw: false }));
});

test("uses Retry-After header for backoff when retrying a 429", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    return attempts < 2
      ? { status: 429, text: "rate limited", headers: { "retry-after": "2" } }
      : okResponse;
  }, { sleep: async (ms) => { delays.push(ms); }, maxAttempts: 3 });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" })).resolves.toBe("ok");
  expect(delays).toEqual([2000]);
});

test("retries on 5xx responses then succeeds", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    return attempts < 3 ? { status: 503, text: "unavailable" } : okResponse;
  }, { sleep: noop });

  const result = await provider.complete({ apiKey: "k", model: "m", prompt: "p" });

  expect(result).toBe("ok");
  expect(attempts).toBe(3);
});

test("retries on network errors then succeeds", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    if (attempts < 3) throw new Error("network down");
    return okResponse;
  }, { sleep: noop });

  const result = await provider.complete({ apiKey: "k", model: "m", prompt: "p" });

  expect(result).toBe("ok");
  expect(attempts).toBe(3);
});

test("does not retry on 4xx responses", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    return { status: 401, text: "bad key" };
  }, { sleep: noop });

  await expect(provider.complete({ apiKey: "bad", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ kind: "request", message: "401 bad key" });
  expect(attempts).toBe(1);
});

test("gives up after maxAttempts on persistent 5xx", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    return { status: 503, text: "unavailable" };
  }, { sleep: noop, maxAttempts: 3 });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ kind: "request", message: "503 unavailable" });
  expect(attempts).toBe(3);
});

test("rethrows the last network error after exhausting retries", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(async () => {
    attempts++;
    throw new Error(`network down ${attempts}`);
  }, { sleep: noop, maxAttempts: 3 });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toThrow("network down 3");
  expect(attempts).toBe(3);
});

test("throws truncated error when finish_reason is length", async () => {
  const provider = new OpenAIProvider(async () => ({
    status: 200,
    text: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "partial answer that got cut" } }] })
  }), { sleep: noop });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ name: "OpenAIProviderError", kind: "truncated" });
});

test("does not flag truncation when finish_reason is stop", async () => {
  const provider = new OpenAIProvider(async () => ({
    status: 200,
    text: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "complete" } }] })
  }), { sleep: noop });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" })).resolves.toBe("complete");
});

test("maps length-truncation with empty content to truncated, not missing-content", async () => {
  const provider = new OpenAIProvider(async () => ({
    status: 200,
    text: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "" } }] })
  }), { sleep: noop });

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ name: "OpenAIProviderError", kind: "truncated" });
});

test("completeVision returns partial OCR text even when the response is length-truncated", async () => {
  const provider = new OpenAIProvider(async () => ({
    status: 200,
    text: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "partial OCR text" } }] })
  }), { sleep: noop });

  await expect(provider.completeVision({ apiKey: "k", model: "m", prompt: "Transcribe", imageDataUrl: "data:image/png;base64,abc" }))
    .resolves.toBe("partial OCR text");
});

test("times out a hung testConnection", async () => {
  const provider = new OpenAIProvider(
    () => new Promise<never>(() => undefined),
    { maxAttempts: 1, timeoutMs: 10 }
  );

  await expect(provider.testConnection({ apiKey: "k", model: "m" }))
    .rejects.toMatchObject({ name: "OpenAIProviderError", kind: "timeout" });
}, 1000);

test("times out a hung request", async () => {
  const provider = new OpenAIProvider(
    () => new Promise<never>(() => undefined),
    { sleep: noop, maxAttempts: 1, timeoutMs: 10 }
  );

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ name: "OpenAIProviderError", kind: "timeout" });
}, 1000);

test("does not retry after a timeout (fails fast, no concurrent duplicate request)", async () => {
  let attempts = 0;
  const provider = new OpenAIProvider(
    () => {
      attempts++;
      return new Promise<never>(() => undefined);
    },
    { sleep: noop, maxAttempts: 3, timeoutMs: 10 }
  );

  await expect(provider.complete({ apiKey: "k", model: "m", prompt: "p" }))
    .rejects.toMatchObject({ name: "OpenAIProviderError", kind: "timeout" });
  expect(attempts).toBe(1);
}, 1000);
