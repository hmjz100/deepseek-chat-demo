# deepseek-chat-demo

[简体中文](README.md) | English

A static chat demo powered by the DeepSeek API. No application backend is required: the browser connects directly to the configured API service.

This repository is an unofficial derivative of [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo), rebuilt and extended for UI research. It is not affiliated with or endorsed by DeepSeek. The UI is implemented piece by piece against chat.deepseek.com.

You can [try the app online](https://hmjz100.github.io/deepseek-chat-demo/) or download the archive from [Releases](https://github.com/hmjz100/deepseek-chat-demo/releases), extract it, and double-click `index.html` to use it locally without installation or a build. Enter your API key in Settings before your first chat.

## Getting started

Install Node.js 22.12+ and pnpm, then run:

```sh
git clone https://github.com/hmjz100/deepseek-chat-demo.git
cd deepseek-chat-demo
pnpm install
pnpm dev
```

Open http://localhost:8090.

To build the static site:

```sh
pnpm build
```

The output is written to `dist/`. Deploy it to a static web server or open `dist/index.html` directly. Opening the file directly requires browser support for storage on `file://` pages and an API service that permits their cross-origin requests.

## Features

- Multiple conversations with automatic titles, renaming, and deletion; edit prompts, regenerate replies, and switch between message branches.
- Streaming replies, deep thinking, smart search, link reading, and source citations; stop generation or continue eligible replies.
- Upload, paste, or drag and drop attachments; use voice input and read replies aloud. A live audio spectrum appears in the first row of the input area while recording on mobile.
- Markdown, syntax highlighting, KaTeX math, and Mermaid diagrams. Diagrams zoom and export to PNG, SVG, or source; images open in a full-screen viewer.
- Model and reasoning-effort picker in the composer, plus OpenAI- and Anthropic-compatible third-party providers in Settings: enable each provider separately, fetch its model list, and declare reasoning/image capability per model.
- Custom providers talk to their own base URL with their own API key, switching between OpenAI Chat Completions and Anthropic Messages. Attachments remain available only on built-in DeepSeek.
- A context-usage ring below the composer shows used / limit (click for details) once a conversation has started; on mobile the model picker moves to the top bar.
- Optional content safety check (`safety_check`); refused replies keep whatever text was streamed and show a notice with the reason instead of being discarded.
- Simplified Chinese and English, light and dark themes, mobile layouts, location settings, and chat history import and export.

## Data and storage

Your API key and settings are stored in the browser's localStorage. Conversations and original attachments are stored in IndexedDB. Local data is isolated by browser profile and site origin. Sending messages, uploading attachments, and using speech features sends the relevant content to the configured API service.

Settings → Account → Model providers lets you add third-party endpoints: choose OpenAI-compatible (Chat Completions) or Anthropic-compatible (Messages), enter a base URL and API key, and maintain models individually. Each provider can fetch its model list and test the connection; display metadata such as model names and vendor logos can still fall back to the public [models.dev](https://models.dev) catalog. Custom providers support text chat only for now; attachments (Files API) still use built-in DeepSeek. Their keys stay in localStorage, and the composer sends a request to the selected provider's own endpoint.

History import and export in Settings use ZIP archives. After confirmation and successful validation, importing replaces all local conversations and attachments. Exports include conversations and locally available original images, but exclude API keys, settings, and original non-image attachments. See the [history import/export documentation (Chinese)](src/services/chat/history/README.md) for the archive format and preservation details.

Settings → Data → Delete all chats clears all local conversations, original attachments, and unsent drafts after confirmation. It stops ongoing replies and returns to a new chat. Your API key and settings are preserved; files already uploaded to the API service are not deleted.

## Development

| Command       | Description                  |
| ------------- | ---------------------------- |
| `pnpm dev`    | Start the development server |
| `pnpm build`  | Build into `dist/`           |
| `pnpm type`   | Run TypeScript type checks   |
| `pnpm lint`   | Lint with oxlint             |
| `pnpm format` | Format with oxfmt            |

[rspack.config.ts](rspack.config.ts) uses `https://api.deepseek.com` by default. Use `createConfig({ apiOrigin, devServer, repoUrl })` to customize the API origin, the development server proxy, and the repository QR entry link.

Chat uses `deepseek-flash` by default through Anthropic-compatible Messages / Files APIs. Speech features use ASR / TTS endpoints. Requests include extensions for search, link reading, titles, and `latest_reminder`, so the configured service must support the corresponding capabilities. Supported attachment formats are determined by server-side validation.

```text
src/
  app/                 Application layout, themes, and global styles
  components/          Chat, settings, Markdown, and other UI components
  i18n/                English and Chinese translations
  services/
    api/               API requests, SSE, and protocol types
    chat/              Conversations, message branches, storage, and history import/export
    markdown/          Markdown parsing, syntax highlighting, and diagrams
    speech/            Audio recording and read-aloud playback
  utils/               Shared utilities
```

## License

[MIT](LICENSE). The build copies the license to `dist/LICENSE`; include it when distributing the app. Third-party dependencies are subject to their own licenses.
