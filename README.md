# ContextOS

English | [简体中文](README.zh-CN.md)

ContextOS is an Obsidian plugin for maintaining a Karpathy-style LLM Wiki. It helps turn raw source notes into a persistent, structured wiki that compounds over time instead of re-deriving knowledge from scratch on every query.

![ContextOS chat panel in Obsidian](assets/preview-1.png)

## Features

- Scan the configured raw source folder for new or changed Markdown, plain text, CSV/TSV, code, HTML, PDF, image, DOC/DOCX, XLS/XLSX, PPT/PPTX, and RTF files.
- Extract text from text-layer PDFs, HTML pages, Office documents, spreadsheets, presentations, and RTF files; fall back to vision OCR for scanned/image-only PDF pages, image-only PPTX slides, and supported image files.
- **Parallel OCR**: PDF pages needing OCR are processed concurrently (configurable concurrency, default 3) for a 3–5× speedup on multi-page scanned PDFs.
- Detect changes via file mtime, size, and content hash, scanning changed files concurrently, so unchanged sources are skipped cheaply.
- **Multi-provider routing**: Configure separate providers for text operations (ingest, lint), chat, and vision (OCR). Supports OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, and any OpenAI-compatible endpoint.
- Send only new or changed raw files to a chat completions endpoint.
- Optionally auto-ingest changes on Obsidian file events and on a polling interval that also catches files changed outside Obsidian.
- Retry transient endpoint errors (network, 429, 5xx) with backoff, honor `Retry-After`, and time out slow requests with a configurable limit.
- Test the configured endpoint from the settings page.
- Generate a structured JSON change plan for wiki updates.
- Chat with your wiki in a dedicated side panel: multi-turn conversations grounded in your notes via index-first retrieval, with Markdown-rendered replies you can copy or file back into the wiki.
- **Streaming chat responses**: Replies stream token-by-token with a three-dot loading indicator while waiting for the model, then re-render as full Markdown on completion.
- **Embeddings-based page selection** (optional): Use Ollama, OpenAI, or Qdrant embeddings to select relevant pages by vector similarity instead of an LLM call — faster and cheaper for large wikis.
- Keep multiple conversations that coexist and persist across restarts — switch, rename, and delete them from a history list, and start or use another chat while one is still replying.
- Preview proposed changes before writing anything to your vault.
- Apply changes only after user confirmation.
- Apply change plans atomically: validate the whole plan first and roll back on failure so the vault is never left half-written.
- Keep raw sources and assets read-only.
- Maintain configurable wiki, index, and log paths.
- Show persistent command progress in the Obsidian status bar.
- Review changes in a wide card-based confirmation modal.
- **Git integration**: Automatically commit wiki changes to a local or remote (SSH) git repository, with auto-generated SSH keys and connection testing.

## Default vault layout

The plugin defaults to this structure:

```text
raw/             # immutable source notes
raw/assets/      # source attachments
wiki/            # LLM-maintained wiki pages
wiki/index.md    # content index
wiki/log.md      # newest-first ingest/chat/lint log
```

All paths are configurable in the plugin settings.

## Supported raw formats

- Text and code: `.md`, `.txt`, `.csv`, `.tsv`, `.json`, `.yaml`, `.yml`, `.log`, `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java`, `.cpp`, `.sql`, `.sh`
- Web pages: `.html`, `.htm`
- Documents: `.doc`, `.docx`, `.rtf`
- Spreadsheets: `.xls`, `.xlsx`
- Presentations: `.ppt`, `.pptx`
- PDFs: `.pdf`
- Images for OCR: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`

PDFs and PPTX files are parsed directly when they contain readable text. PDF pages, PPTX slides, and image files only use vision OCR when text is not directly extractable.

## Installation

### Install from Obsidian community plugins

1. Open **Settings → Community plugins** in Obsidian.
2. Turn off **Restricted mode** if needed.
3. Select **Browse** and search for **ContextOS**.
4. Install and enable the plugin.

### Installation for development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Build the plugin:

   ```bash
   npm run build
   ```

3. Copy the files from `build/` into your Obsidian vault plugin directory:

   ```text
   build/main.js       → <your-vault>/.obsidian/plugins/contextos/main.js
   build/styles.css    → <your-vault>/.obsidian/plugins/contextos/styles.css
   build/manifest.json → <your-vault>/.obsidian/plugins/contextos/manifest.json
   ```

4. Enable **ContextOS** in Obsidian community plugin settings.

## Configuration

Open the plugin settings and configure:

- **Raw folder**: folder containing immutable source files. Supported raw inputs include Markdown, plain text, CSV/TSV, common code files, HTML, PDF, PNG/JPEG/WebP/GIF images, DOC/DOCX, XLS/XLSX, PPT/PPTX, and RTF.
- **Wiki folder**: folder where generated wiki pages should be written.
- **Assets folder**: read-only attachment folder.
- **Index path**: wiki index file path.
- **Log path**: wiki log file path.

### Providers

Configure one or more LLM providers under the **Providers** section. Each provider has a type (OpenAI, Anthropic, Gemini, DeepSeek, Groq, Ollama, or OpenAI-compatible), API key, API URL, and model.

Use the **Operation routing** bar to assign specific providers to each operation:

| Operation | Description |
|---|---|
| Default provider | Fallback when no specific provider is configured for an operation |
| Text operations | Ingest, lint, and save-to-wiki |
| Chat operations | Chat panel conversations |
| Vision operations | PDF OCR, image OCR |

For example: use a cheap model (e.g. GPT-4.1 Mini) for text operations, a powerful model (e.g. Claude Opus) for chat, and a vision-capable model for OCR.

Third-party OpenAI-compatible providers can be used as long as the URL points directly to their `/v1/chat/completions` endpoint. Use **Test connection** in settings to check whether the configured endpoint returns HTTP 2xx — the connection is also auto-tested when you enter an API key.

### Prompt templates

Customize the system prompts for ingest, chat, and lint. Leave empty to use the built-in defaults.

### Embeddings (optional)

Replace the LLM-based page selection step with vector similarity search. Configure under **Embeddings**:

| Backend | Description |
|---|---|
| None (default) | Current LLM-based page selection. No changes needed. |
| Ollama | Uses a local Ollama embedding model (e.g. `mxbai-embed-large`). Stores vectors in `wiki/.embeddings/`. |
| OpenAI | Uses OpenAI's embeddings API (`text-embedding-3-small` or similar). Stores vectors in `wiki/.embeddings/`. |
| Qdrant | Full vector database via Qdrant Cloud. Embeddings and search are delegated to Qdrant. |

When enabled, embeddings are computed automatically on ingest and used on chat queries. Falls back to LLM-based selection if the embeddings folder is empty or the backend is unreachable.

### Git

Automatically commit wiki changes after each change plan is applied. Configure under the **Git** section:

| Setting | Description |
|---|---|
| Git integration | Off, local-only, or remote (SSH) synchronization. |
| Connection method | SSH manual setup (paste your remote URL) or SSH auto-generate key (creates an Ed25519 keypair). |
| Remote URL | SSH remote URL (e.g. `git@github.com:user/repo.git`). |
| Auto push after commit | Push to the remote after each local commit. |
| Test connection | Verify git is installed and the remote is reachable. |

When using SSH auto-generate key, the plugin creates an Ed25519 keypair in `~/.ssh/` and displays the public key — copy it to your GitHub/GitLab SSH keys settings. Remote URL entry auto-tests the connection after you finish typing.

### Advanced

- **Auto ingest raw file changes**: disabled by default. When enabled, supported raw file changes are analyzed automatically after a short debounce and validated model changes are applied without opening the review modal.
- **Auto ingest debounce (seconds)**: when auto ingest is on, how long to wait after the last file change before analyzing. Defaults to 3.
- **Auto ingest poll interval (seconds)**: when auto ingest is on, how often to scan the raw folder for changes made outside Obsidian (e.g. dragged-in files, which do not fire file events). Defaults to 15; set 0 to disable polling.
- **OCR page concurrency**: maximum PDF pages to OCR simultaneously (default 3). Lower for rate-limited providers.
- **Request timeout (seconds)**: how long to wait for a model response before timing out. Defaults to 900 seconds; raise it for slow local or reasoning models, lower it for fast hosted models.

## Usage

### Ingest changed raw files

1. Put supported source files under the configured raw folder, such as Markdown, text, CSV/TSV, code, HTML, PDF, images, DOC/DOCX, XLS/XLSX, PPT/PPTX, or RTF.
2. Run the command:

   ```text
   Ingest changed raw files into ContextOS
   ```

The command scans the configured raw folder and processes all new or changed supported raw files. Text/code-like files are read directly, HTML is converted to readable text, Office documents, spreadsheets, presentations, and RTF files are extracted locally, and text-layer PDFs are extracted directly. Scanned or image-only PDF pages and image-only PPTX slides use vision OCR (pages are OCR'd concurrently — configurable with OCR page concurrency), and supported image files are sent to the configured vision model for OCR before the extracted text is ingested. Files that have already been successfully applied are skipped until their content changes.

When **Auto ingest raw file changes** is enabled, the plugin watches the configured raw folder for supported file creations and modifications. After a short debounce, it runs the same ingest pipeline and automatically applies validated changes without opening the review modal. It also polls the raw folder on the configured interval to catch files changed outside Obsidian (which do not fire file events). Auto ingest is disabled by default.

The command flow is:

1. Scan raw folder for changed files and report supported raw/PDF candidates in progress notices.
2. Extract source text from text/code, HTML, PDF, image, Office, spreadsheet, presentation, and RTF inputs, using vision OCR when a PDF page, PPTX slide, or image needs OCR.
3. Send changed sources plus wiki context to the model.
4. Validate the returned change plan.
5. Show a review modal.
6. Apply changes only after confirmation.
7. Record raw file hashes only after changes are successfully applied.

### Chat with the wiki

Open the chat panel from the ribbon (the chat icon) or run:

```text
Query ContextOS
```

This opens a chat panel docked in the right sidebar. Ask questions in natural language and the plugin answers from your wiki: it reads the index first and, for larger wikis, asks the model which pages are relevant and drills into only those (index-first retrieval). If embeddings are configured, page selection uses vector similarity search instead of an extra LLM call. Replies stream token-by-token with a three-dot loading indicator, then re-render as full Markdown. You can **Copy** a reply or **Save to wiki** to file a worthwhile answer back as a page through the reviewed change-plan flow (the exchange is also recorded in the log), so explorations compound over time.

The panel keeps multiple conversations:

- **New chat** starts a fresh conversation without discarding the current one.
- The history list (the toggle in the panel header) lets you switch between conversations, **rename** them, or **delete** them (with a confirmation prompt).
- Conversations are saved with the plugin and persist across Obsidian restarts.
- Waiting is per-conversation: you can start or use another chat while one is still awaiting a reply, and each reply lands back in its own conversation.

### Lint the wiki

Run:

```text
Lint ContextOS
```

The plugin asks the model to reconcile the wiki with the current raw sources and to look for stale claims, contradictions, missing cross-references, important concepts without pages, and data gaps. Because the wiki is a synthesis distilled from many sources, a page whose raw source was removed is usually revised — its now-unsupported claims dropped — rather than deleted; a page is deleted only when nothing of value would remain. Deletions are proposed in the change plan and applied only after you review them (following Karpathy's model: sources are immutable, and the wiki is reconciled during lint rather than automatically when a source is deleted).

## Safety model

- Raw files are never modified by generated change plans.
- Assets are treated as read-only.
- Writes outside the configured wiki folder are rejected.
- Deletions are limited to the wiki folder, previewed like any other change, and rolled back if applying fails.
- `indexPath` and `logPath` must stay inside the configured wiki folder.
- Proposed file changes must be reviewed before applying.
- Raw file state is updated only after Apply succeeds.

## Privacy and network use

This plugin sends selected vault content to the OpenAI-compatible chat completions endpoint configured in the plugin settings. During ingest, it sends new or changed raw text extracted from supported source files, including Markdown, text/code, HTML, PDFs, Office documents, spreadsheets, presentations, and RTF files; when OCR is needed, it sends rendered PDF page images, embedded PPTX slide images, or supported image files to the configured model. Wiki index/log context is included. When you chat, it sends the wiki index plus the pages selected for each turn along with the recent conversation messages; saving a chat answer and the lint command also send relevant wiki context. The **Test OpenAI connection** button sends a small ping-style chat completions request to the configured endpoint. No network request is made until you configure an API URL and API key and run a command or click the test button.

The API key is stored locally in Obsidian plugin data and is sent as an Authorization header only to the configured API URL. If you configure a third-party OpenAI-compatible endpoint, your API key and selected vault content are sent to that provider.

The plugin does not include telemetry, analytics, ads, or a self-update mechanism.

## Development

Run tests:

```bash
npm test
```

Build:

```bash
npm run build
```

The generated `main.js` is intentionally ignored by git and should not be committed.
