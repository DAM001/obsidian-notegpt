# NoteGPT

Chat with AI and refactor text in Obsidian using OpenAI models.

## Features

- **Chat Interface**: Persistent chat history stored as markdown files
- **Text Refactoring**: Quick refactoring of selected text with AI
- **Organized Storage**: Each chat gets its own folder with `chat.md` and attachments
- **Multiple Access Points**: Commands, ribbon icons, and context menus

## Installation

1. Download or copy the plugin folder containing:

   * `manifest.json`
   * `main.js`
   * `styles.css`
   * `config.sample.json`

2. Place the entire folder into:

   ```
   <your vault>/.obsidian/plugins/notegpt/
   ```

3. Create your configuration file:

   * Duplicate `config.sample.json` and rename it to `data.json`.
   * Open `data.json` and set:

     * `apiKey` → your ChatGPT API key
     * `chatFolder` → folder name for storing chats (default: "NoteGPT Chats")
     * (Optional) change `endpoint`, `model`, `temperature`, etc.

   Example minimal config:

   ```json
   {
     "apiKey": "your-token-here",
     "chatFolder": "NoteGPT Chats"
   }
   ```

4. In Obsidian:

   * Go to **Settings → Community Plugins → Installed plugins**.
   * Enable **NoteGPT**.

## Usage

### Chat Feature

1. Click the **messages-square** icon in the left ribbon, or
2. Use Command Palette: **NoteGPT: Open chat history**
3. Click **+ New Chat** to create a new conversation
4. Each chat is stored in its own folder: `{chatFolder}/{date-name}/chat.md`
5. Right-click any chat to delete it

### Text Refactoring

1. Select text in the editor
2. Trigger **NoteGPT: Refactor selection** via:
   - Command Palette
   - Right-click context menu
3. Enter your refactor instruction
4. The selection is replaced with the AI-generated result

## Requirements

* Obsidian ≥ 1.5.0
* OpenAI API key compatible with the chosen model.

## Uninstall

Remove the folder from:

```
<your vault>/.obsidian/plugins/notegpt/
```