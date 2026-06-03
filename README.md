# Auto LLM Wiki

English | [简体中文](README.zh-CN.md)

Auto LLM Wiki is an Obsidian plugin for maintaining a Karpathy-style LLM Wiki. It helps turn raw source notes into a persistent, structured wiki that compounds over time instead of re-deriving knowledge from scratch on every query.

## Features

- Scan the configured raw source folder for new or changed Markdown, plain text, CSV/TSV, code, HTML, PDF, image, DOC/DOCX, XLS/XLSX, PPT/PPTX, and RTF files.
- Extract text from text-layer PDFs, HTML pages, Office documents, spreadsheets, presentations, and RTF files; fall back to vision OCR for scanned/image-only PDF pages, image-only PPTX slides, and supported image files.
- Track raw file content hashes so unchanged sources are skipped on later runs.
- Send only new or changed raw files to an OpenAI-compatible chat completions endpoint.
- Test the configured OpenAI-compatible endpoint from the settings page.
- Generate a structured JSON change plan for wiki updates.
- Preview proposed changes before writing anything to your vault.
- Apply changes only after user confirmation.
- Keep raw sources and assets read-only.
- Maintain configurable wiki, index, and log paths.
- Show persistent command progress in the Obsidian status bar.
- Review changes in a wide card-based confirmation modal.

## Default vault layout

The plugin defaults to this structure:

```text
raw/             # immutable source notes
raw/assets/      # source attachments
wiki/            # LLM-maintained wiki pages
wiki/index.md    # content index
wiki/log.md      # newest-first ingest/query/lint log
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
3. Select **Browse** and search for **Auto LLM Wiki**.
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

3. Copy these files into your Obsidian vault plugin directory:

   ```text
   <your-vault>/.obsidian/plugins/auto-llm-wiki/manifest.json
   <your-vault>/.obsidian/plugins/auto-llm-wiki/main.js
   <your-vault>/.obsidian/plugins/auto-llm-wiki/styles.css
   ```

4. Enable **Auto LLM Wiki** in Obsidian community plugin settings.

## Configuration

Open the plugin settings and configure:

- **Raw folder**: folder containing immutable source files. Supported raw inputs include Markdown, plain text, CSV/TSV, common code files, HTML, PDF, PNG/JPEG/WebP/GIF images, DOC/DOCX, XLS/XLSX, PPT/PPTX, and RTF.
- **Wiki folder**: folder where generated wiki pages should be written.
- **Assets folder**: read-only attachment folder.
- **Index path**: wiki index file path.
- **Log path**: wiki log file path.
- **OpenAI API URL**: chat completions endpoint, for example:

  ```text
  https://api.openai.com/v1/chat/completions
  ```

- **OpenAI API key**: API key for your OpenAI-compatible provider.
- **OpenAI model**: model name to use.

Third-party OpenAI-compatible providers can be used as long as the URL points directly to their `/v1/chat/completions` endpoint. Use **Test OpenAI connection** in settings to check whether the configured endpoint returns HTTP 2xx for the current URL, key, and model.

## Usage

### Ingest changed raw files

1. Put supported source files under the configured raw folder, such as Markdown, text, CSV/TSV, code, HTML, PDF, images, DOC/DOCX, XLS/XLSX, PPT/PPTX, or RTF.
2. Run the command:

   ```text
   Ingest active source into Auto LLM Wiki
   ```

Despite the command name, the current implementation scans the configured raw folder and processes only new or changed supported raw files. Text/code-like files are read directly, HTML is converted to readable text, Office documents, spreadsheets, presentations, and RTF files are extracted locally, and text-layer PDFs are extracted directly. Scanned or image-only PDF pages and image-only PPTX slides use vision OCR, and supported image files are sent to the configured OpenAI-compatible model for OCR before the extracted text is ingested. Files that have already been successfully applied are skipped until their content changes.

The command flow is:

1. Scan raw folder for changed files and report supported raw/PDF candidates in progress notices.
2. Extract source text from text/code, HTML, PDF, image, Office, spreadsheet, presentation, and RTF inputs, using vision OCR when a PDF page, PPTX slide, or image needs OCR.
3. Send changed sources plus wiki context to the model.
4. Validate the returned change plan.
5. Show a review modal.
6. Apply changes only after confirmation.
7. Record raw file hashes only after changes are successfully applied.

### Query the wiki

Run:

```text
Query Auto LLM Wiki
```

The plugin reads wiki context and asks the model to return a saveable change plan. You can review and apply the proposed result.

### Lint the wiki

Run:

```text
Lint Auto LLM Wiki
```

The plugin asks the model to look for stale claims, contradictions, orphan pages, missing cross-references, and data gaps.

## Safety model

- Raw files are never modified by generated change plans.
- Assets are treated as read-only.
- Writes outside the configured wiki folder are rejected.
- `indexPath` and `logPath` must stay inside the configured wiki folder.
- Proposed file changes must be reviewed before applying.
- Raw file state is updated only after Apply succeeds.

## Privacy and network use

This plugin sends selected vault content to the OpenAI-compatible chat completions endpoint configured in the plugin settings. During ingest, it sends new or changed raw text extracted from supported source files, including Markdown, text/code, HTML, PDFs, Office documents, spreadsheets, presentations, and RTF files; when OCR is needed, it sends rendered PDF page images, embedded PPTX slide images, or supported image files to the configured model. Wiki index/log context is included. During query and lint commands, it sends relevant wiki context. The **Test OpenAI connection** button sends a small ping-style chat completions request to the configured endpoint. No network request is made until you configure an API URL and API key and run a command or click the test button.

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
