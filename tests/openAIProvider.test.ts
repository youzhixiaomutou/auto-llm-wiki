import { OpenAIProvider } from "../src/providers/OpenAIProvider";

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

test("connection test fails for non-2xx response", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 500, text: "server error" }));

  await expect(provider.testConnection({ apiKey: "key", model: "test-model" }))
    .rejects.toThrow("OpenAI connection test failed: 500 server error");
});

test("throws useful error on non-200 response", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 401, text: "bad key" }));
  await expect(provider.complete({ apiKey: "bad", model: "gpt-test", prompt: "hello" })).rejects.toThrow("OpenAI request failed: 401 bad key");
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

test("throws endpoint error when successful response is not JSON", async () => {
  const provider = new OpenAIProvider(async () => ({ status: 200, text: "<!doctype html><html></html>" }));

  await expect(provider.complete({
    apiKey: "key",
    model: "custom-model",
    prompt: "hello",
    apiUrl: "https://example.test"
  })).rejects.toThrow("OpenAI response was not JSON. Check the API URL; it should point to a chat completions endpoint.");
});
