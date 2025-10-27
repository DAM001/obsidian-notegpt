const { Plugin, Modal, Notice } = require('obsidian');

/* ---------- utils ----------- */
async function readJson(adapter, path) {
    try { return JSON.parse(await adapter.read(path)); } catch { return null; }
}

/* ---------- OpenAI call ---------- */
async function callChat(cfg, prompt, selection) {
    if (!cfg?.apiKey) throw new Error('Missing apiKey in config.json');

    const res = await fetch(cfg.endpoint || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
            ...(cfg.extraHeaders || {})
        },
        body: JSON.stringify({
            model: cfg.model || 'gpt-4o-mini',
            temperature: typeof cfg.temperature === 'number' ? cfg.temperature : 0.3,
            max_tokens: typeof cfg.max_tokens === 'number' ? cfg.max_tokens : 800,
            messages: [
                { role: 'system', content: String(cfg.system || 'You are a terse expert editor. Refactor clearly, preserve meaning.') },
                { role: 'user', content: String(prompt || 'Refactor the following text.') },
                { role: 'user', content: `\n\n${String(selection || '')}` }
            ]
        })
    });

    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${t || res.statusText}`);
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || '').trim();
}

/* ---------- modal ---------- */
class RefactorModal extends Modal {
    constructor(app, editor, onSubmit) {
        super(app);
        this.editor = editor;
        this.onSubmit = onSubmit;
        this.selection = '';
    }
    setBusy(b) {
        this.ok?.setAttribute('disabled', b ? 'true' : null);
        this.cancel?.setAttribute('disabled', b ? 'true' : null);
        this.ta?.setAttribute('disabled', b ? 'true' : null);
        this.dim?.toggleClass('active', b);
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.style.position = 'relative';

        this.selection = String(this.editor?.getSelection?.() || '');

        contentEl.createEl('h3', { text: 'NoteGPT: Refactor' });

        this.ta = contentEl.createEl('textarea', {
            cls: 'notegpt-textarea',
            attr: { placeholder: 'How should it be refactored?' }
        });

        const det = contentEl.createEl('details', { cls: 'notegpt-details' });
        det.createEl('summary', { text: 'Show selection' });
        det.createEl('pre', { cls: 'notegpt-pre' }).setText(this.selection);

        const actions = contentEl.createDiv({ cls: 'notegpt-actions' });
        this.ok = actions.createEl('button', { text: 'OK', cls: 'mod-cta' });
        this.cancel = actions.createEl('button', { text: 'Cancel' });

        this.ok.addEventListener('click', async () => {
            this.setBusy(true);
            try {
                const currentSel = String(this.editor?.getSelection?.() || this.selection);
                const r = await this.onSubmit({
                    prompt: this.ta.value || '',
                    selection: currentSel
                });
                if (r !== 'keep-open') this.close();
            } catch (e) {
                new Notice(String(e?.message || e), 6000);
            } finally {
                this.setBusy(false);
            }
        });

        this.cancel.addEventListener('click', () => this.close());

        // overlay + spinner
        this.dim = contentEl.createDiv({ cls: 'notegpt-dim' });
        this.dim.createDiv({ cls: 'notegpt-spinner' });

        this.ta.focus();
    }
    onClose() { this.contentEl.empty(); }
}


/* ---------- plugin ---------- */
module.exports = class NoteGPT extends Plugin {
    async onload() {
        this.cfgPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/config.json`;
        this.cfg = await readJson(this.app.vault.adapter, this.cfgPath) || {};

        // Command palette + mobile-friendly trigger
        this.addCommand({
            id: 'notegpt-refactor',
            name: 'Refactor selection with NoteGPT',
            editorCallback: (editor) => this.openRefactor(editor)
        });

        // Ribbon icon (works on mobile toolbar too)
        this.addRibbonIcon('sparkles', 'NoteGPT Refactor', () => {
            const activeLeaf = this.app.workspace.activeLeaf;
            const editor = activeLeaf?.view?.editor;
            if (editor) this.openRefactor(editor);
            else new Notice('No active editor');
        });

        // Context menu (desktop only)
        this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor) => {
            const s = editor.getSelection?.() || '';
            if (!s) return;
            menu.addItem((item) => {
                item.setTitle('NoteGPT: Refactor selection')
                    .setIcon('sparkles')
                    .onClick(() => this.openRefactor(editor));
            });
        }));
    }

    openRefactor(editor) {
        new RefactorModal(this.app, editor, async ({ prompt, selection }) => {
            try {
                if (!selection) { new Notice('Select text first'); return 'keep-open'; }
                const out = await callChat(this.cfg, prompt, selection);
                editor.replaceSelection(String(out));
                return 'done';
            } catch (e) {
                console.error(e);
                new Notice(String(e?.message || e), 6000);
                return 'keep-open';
            }
        }).open();
    }

    onunload() {}
};