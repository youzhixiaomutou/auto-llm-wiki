import { LLMProvider } from "./LLMProvider";
import { ProviderConfig, LLMProviderType, LLM_PROVIDER_TYPES } from "../types";
import { BaseOpenAICompatibleProvider } from "./BaseOpenAICompatibleProvider";

export interface ProviderFactory {
  type: LLMProviderType;
  create(config: ProviderConfig, timeoutMs?: number): LLMProvider;
}

class ProviderRegistryImpl {
  private factories = new Map<LLMProviderType, ProviderFactory>();
  private cachedProviders = new Map<string, LLMProvider>();
  private cacheConfigHashes = new Map<string, string>();

  register(factory: ProviderFactory): void {
    if (this.factories.has(factory.type)) return;
    this.factories.set(factory.type, factory);
  }

  unregister(type: LLMProviderType): void {
    this.factories.delete(type);
    for (const [id, provider] of this.cachedProviders) {
      if (provider instanceof BaseOpenAICompatibleProvider && provider.providerType === type) {
        this.cachedProviders.delete(id);
        this.cacheConfigHashes.delete(id);
      }
    }
  }

  getProvider(config: ProviderConfig, timeoutMs?: number): LLMProvider {
    const hash = this.configHash(config, timeoutMs);
    const cachedHash = this.cacheConfigHashes.get(config.id);
    if (cachedHash === hash && this.cachedProviders.has(config.id)) {
      return this.cachedProviders.get(config.id)!;
    }

    const factory = this.factories.get(config.type);
    if (!factory) throw new Error(`No factory registered for provider type "${config.type}"`);

    const provider = factory.create(config, timeoutMs);
    this.cachedProviders.set(config.id, provider);
    this.cacheConfigHashes.set(config.id, hash);
    return provider;
  }

  getAvailableTypes(): LLMProviderType[] {
    return Array.from(this.factories.keys());
  }

  hasType(type: string): type is LLMProviderType {
    return LLM_PROVIDER_TYPES.includes(type as LLMProviderType) && this.factories.has(type as LLMProviderType);
  }

  invalidateCache(providerId?: string): void {
    if (providerId) {
      this.cachedProviders.delete(providerId);
      this.cacheConfigHashes.delete(providerId);
    } else {
      this.cachedProviders.clear();
      this.cacheConfigHashes.clear();
    }
  }

  private configHash(config: ProviderConfig, timeoutMs?: number): string {
    return `${config.type}|${config.apiKey.slice(-4)}|${config.apiUrl}|${config.model}|${timeoutMs ?? ""}`;
  }
}

export const providerRegistry = new ProviderRegistryImpl();
