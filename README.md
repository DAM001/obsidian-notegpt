# NoteGPT

Refactor selected text in Obsidian using OpenAI models.
This plugin adds a command, context-menu entry, and ribbon button for quick refactoring based on a prompt you provide.
Core logic is handled in `main.js`, configuration in `config.json` (based on `config.sample.json`), metadata in `manifest.json`, and styles in `styles.css`.

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

   * Duplicate `config.sample.json` and rename it to `config.json`.
   * Open `config.json` and set:

     * `apiKey` → your ChatGPT API key
     * (Optional) change `endpoint`, `model`, `temperature`, etc.

   Example minimal config:

   ```json
   {
     "apiKey": "your-token-here"
   }
   ```

4. In Obsidian:

   * Go to **Settings → Community Plugins → Installed plugins**.
   * Enable **NoteGPT**.

## Usage

* Select text in the editor.
* Trigger **NoteGPT: Refactor selection** via:

  * Command Palette
  * Right-click context menu
  * Ribbon icon
* Enter your refactor instruction.
  The selection is replaced with the AI-generated result.

## Requirements

* Obsidian ≥ 1.5.0
* OpenAI API key compatible with the chosen model.

## Uninstall

Remove the folder from:

```
<your vault>/.obsidian/plugins/notegpt/
```