import { providerRegistry } from "./ProviderRegistry";
import { OpenAIProvider } from "./OpenAIProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { GeminiProvider } from "./GeminiProvider";
import { OllamaProvider } from "./OllamaProvider";
import { DeepSeekProvider } from "./DeepSeekProvider";
import { GroqProvider } from "./GroqProvider";
import { BaseOpenAICompatibleProvider } from "./BaseOpenAICompatibleProvider";
import { ProviderConfig } from "../types";
import { LLMProvider } from "./LLMProvider";

function openAICompatibleFactory(config: ProviderConfig, timeoutMs?: number): LLMProvider {
  return new (BaseOpenAICompatibleProvider as unknown as new (httpClient: unknown, options: unknown) => LLMProvider)(
    undefined, { timeoutMs }
  ) as unknown as LLMProvider;
}

export function registerBuiltinProviders(): void {
  providerRegistry.register({
    type: "openai",
    create: (config, timeoutMs) => new OpenAIProvider(undefined, { timeoutMs })
  });
  providerRegistry.register({
    type: "anthropic",
    create: (config, timeoutMs) => new AnthropicProvider(timeoutMs)
  });
  providerRegistry.register({
    type: "gemini",
    create: (config, timeoutMs) => new GeminiProvider(timeoutMs)
  });
  providerRegistry.register({
    type: "ollama",
    create: (config, timeoutMs) => new OllamaProvider(undefined, { timeoutMs })
  });
  providerRegistry.register({
    type: "deepseek",
    create: (config, timeoutMs) => new DeepSeekProvider(undefined, { timeoutMs })
  });
  providerRegistry.register({
    type: "groq",
    create: (config, timeoutMs) => new GroqProvider(undefined, { timeoutMs })
  });
  providerRegistry.register({
    type: "openai-compatible",
    create: (config, timeoutMs) => new OpenAIProvider(undefined, { timeoutMs })
  });
}
