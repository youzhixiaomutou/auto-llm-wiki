# Auto LLM Wiki

English | [简体中文](README.zh-CN.md)

Auto LLM Wiki is an Obsidian plugin for maintaining a Karpathy-style LLM Wiki. It helps turn raw source notes into a persistent, structured wiki that compounds over time instead of re-deriving knowledge from scratch on every query.

## Features

- Scan the configured raw source folder for new or changed Markdown files.
- Track raw file content hashes so unchanged sources are skipped on later runs.
- Send only new or changed raw files to an OpenAI-compatible chat completions endpoint.
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
wiki/log.md      # chronological ingest/query/lint log
```

All paths are configurable in the plugin settings.

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

- **Raw folder**: folder containing immutable source Markdown files.
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

Third-party OpenAI-compatible providers can be used as long as the URL points directly to their `/v1/chat/completions` endpoint.

## Usage

### Ingest changed raw files

1. Put source Markdown files under the configured raw folder.
2. Run the command:

   ```text
   Ingest active source into Auto LLM Wiki
   ```

Despite the command name, the current implementation scans the configured raw folder and processes only new or changed raw Markdown files. Files that have already been successfully applied are skipped until their content changes.

The command flow is:

1. Scan raw folder for changed files.
2. Send changed sources plus wiki context to the model.
3. Validate the returned change plan.
4. Show a review modal.
5. Apply changes only after confirmation.
6. Record raw file hashes only after changes are successfully applied.

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

This plugin sends selected vault content to the OpenAI-compatible chat completions endpoint configured in the plugin settings. During ingest, it sends new or changed raw Markdown source files plus wiki index/log context. During query and lint commands, it sends relevant wiki context. No network request is made until you configure an API URL and API key and run a command.

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
