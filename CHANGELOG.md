# Changelog

## 0.3.0 (2026-07-10)

### Added
- **Git integration**: Auto-commit wiki changes to a local or remote (SSH) git repository after each change plan is applied. Supports manual SSH setup and auto-generated Ed25519 keypairs.
- **Git connection test**: Test connectivity to the configured git remote directly from settings, with auto-test on URL entry (debounced).
- **Git as standalone settings section**: Git settings moved out of Advanced into their own section.

### Fixed
- Git push now uses `origin HEAD` explicitly to avoid "No configured push destination" errors on fresh repos.
- GitHub API error handling improved to surface token permission guidance on 403/401 responses.

## 0.2.0 (2026-07-09)

### Added
- **Multi-provider routing**: Configure separate LLM providers for text operations (ingest/lint), chat, and vision (OCR). Supports OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, and OpenAI-compatible endpoints.
- **Streaming chat responses**: Replies stream token-by-token with a loading indicator, then re-render as full Markdown on completion.
- **Parallel OCR**: PDF pages needing vision OCR are processed concurrently (configurable concurrency, default 3).
- **Embeddings-based page selection**: Optional vector similarity search via Ollama, OpenAI, or Qdrant embeddings to replace LLM-based page selection for faster, cheaper queries on large wikis.
- **Collapsible provider settings**: Provider configuration cards expand/collapse for cleaner settings UI.
- **Custom prompt templates**: Override the system prompts for ingest, chat, and lint.
- **Per-operation provider routing bar**: Assign specific providers to text/chat/vision operations.
- **Auto git commit**: Optionally auto-commit wiki changes after each change plan is applied.
- **OCR page concurrency** and **request timeout** settings.
