import { __setLanguage } from "./obsidianMock";
import { formatOpenAIErrorMessage } from "../src/main";
import { OpenAIProviderError } from "../src/providers/OpenAIProvider";

beforeEach(() => {
  __setLanguage("en");
});

test("maps truncated provider error to a localized message", () => {
  const message = formatOpenAIErrorMessage(new OpenAIProviderError("truncated", "raw"), "fallback");
  expect(message).toBe("OpenAI response was truncated. Try fewer sources at once or a model with a larger output limit.");
});

test("maps timeout provider error to a localized message", () => {
  const message = formatOpenAIErrorMessage(new OpenAIProviderError("timeout", "raw"), "fallback");
  expect(message).toBe("OpenAI request timed out. Check your connection or try again.");
});

test("still maps request provider error using the raw message", () => {
  const message = formatOpenAIErrorMessage(new OpenAIProviderError("request", "401 bad key"), "fallback");
  expect(message).toBe("OpenAI request failed: 401 bad key");
});
