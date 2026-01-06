const { Plugin, Modal, Notice, ItemView, WorkspaceLeaf, TFile, TFolder, Menu, MarkdownRenderer } = require('obsidian');

/* ---------- utils ----------- */
async function readJson(adapter, path) {
    try { return JSON.parse(await adapter.read(path)); } catch { return null; }
}

/* ---------- OpenAI call ---------- */
async function callChat(cfg, prompt, selection) {
    if (!cfg?.apiKey) throw new Error('Missing apiKey in data.json');

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

/* ---------- chat view constants ---------- */
const CHAT_VIEW_TYPE = 'notegpt-chat-view';

/* ---------- chat view ---------- */
class ChatView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentChatFile = null;
        this.currentChatFolder = null;
        this.resizeHandler = null;
    }

    getViewType() {
        return CHAT_VIEW_TYPE;
    }

    getDisplayText() {
        return this.currentChatFolder ? this.currentChatFolder.name : 'NoteGPT Chat';
    }

    getIcon() {
        return 'messages-square';
    }

    async onOpen() {
        // Force proper mobile behavior on the Obsidian container
        const viewContent = this.containerEl.children[1];
        if (viewContent) {
            viewContent.style.height = '100%';
            viewContent.style.overflow = 'hidden';
            viewContent.style.position = 'relative';
        }
        
        await this.showChatList();
    }

    async showChatList() {
        this.currentChatFile = null;
        this.currentChatFolder = null;

        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('notegpt-chat-view');

        // Header
        const header = container.createDiv({ cls: 'notegpt-chat-header' });
        header.createEl('h4', { text: 'Chat History' });

        const newChatBtn = header.createEl('button', {
            text: '+ New Chat',
            cls: 'mod-cta notegpt-new-chat-btn'
        });
        newChatBtn.addEventListener('click', () => this.createNewChat());

        // Chat list
        const chatList = container.createDiv({ cls: 'notegpt-chat-list' });

        const chatFolderPath = this.plugin.cfg.chatFolder || 'NoteGPT Chats';
        const folder = this.app.vault.getAbstractFileByPath(chatFolderPath);

        if (!folder || !(folder instanceof TFolder)) {
            chatList.createDiv({
                cls: 'notegpt-empty-state',
                text: 'No chats yet. Click "+ New Chat" to start.'
            });
            return;
        }

        const chatFolders = folder.children
            .filter(f => f instanceof TFolder)
            .sort((a, b) => (b.stat?.mtime || 0) - (a.stat?.mtime || 0));

        if (chatFolders.length === 0) {
            chatList.createDiv({
                cls: 'notegpt-empty-state',
                text: 'No chats yet. Click "+ New Chat" to start.'
            });
            return;
        }

        for (const chatFolder of chatFolders) {
            const chatMd = chatFolder.children.find(f => f.name === 'chat.md');
            if (!chatMd) continue;

            const item = chatList.createDiv({ cls: 'notegpt-chat-item' });

            const itemContent = item.createDiv({ cls: 'notegpt-chat-item-content' });

            const title = itemContent.createDiv({ cls: 'notegpt-chat-title' });
            title.setText(chatFolder.name);

            const date = itemContent.createDiv({ cls: 'notegpt-chat-date' });
            const mtime = chatFolder.stat?.mtime || Date.now();
            date.setText(new Date(mtime).toLocaleString());

            const deleteBtn = item.createEl('button', {
                cls: 'notegpt-delete-btn',
                attr: { 'aria-label': 'Delete chat' }
            });
            deleteBtn.innerHTML = '×';

            itemContent.addEventListener('click', () => this.openChat(chatMd, chatFolder));

            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete chat "${chatFolder.name}"?`)) {
                    await this.app.vault.delete(chatFolder, true);
                    await this.showChatList();
                }
            });

            // Right-click menu
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const menu = new Menu();

                menu.addItem((menuItem) => {
                    menuItem
                        .setTitle('Delete chat')
                        .setIcon('trash')
                        .onClick(async () => {
                            if (confirm(`Delete chat "${chatFolder.name}"?`)) {
                                await this.app.vault.delete(chatFolder, true);
                                await this.showChatList();
                            }
                        });
                });

                menu.showAtMouseEvent(e);
            });
        }
    }

    async createNewChat() {
        const modal = new Modal(this.app);
        modal.titleEl.setText('New Chat');

        const input = modal.contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Chat name (optional)',
            cls: 'notegpt-chat-name-input'
        });
        input.style.width = '100%';
        input.style.marginBottom = '1rem';

        const actions = modal.contentEl.createDiv({ cls: 'notegpt-actions' });
        const okBtn = actions.createEl('button', { text: 'Create', cls: 'mod-cta' });
        const cancelBtn = actions.createEl('button', { text: 'Cancel' });

        okBtn.addEventListener('click', async () => {
            const name = input.value.trim() || 'Untitled';
            await this.createChat(name);
            modal.close();
        });

        cancelBtn.addEventListener('click', () => modal.close());

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                okBtn.click();
            }
        });

        modal.open();
        input.focus();
    }

    async createChat(name) {
        const chatFolderPath = this.plugin.cfg.chatFolder || 'NoteGPT Chats';

        const folder = this.app.vault.getAbstractFileByPath(chatFolderPath);
        if (!folder) {
            await this.app.vault.createFolder(chatFolderPath);
        }

        const timestamp = new Date().toISOString().split('T')[0];
        const time = new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
        const folderName = `${timestamp}-${time}-${name.replace(/[\\/:*?"<>|]/g, '-')}`;
        const fullPath = `${chatFolderPath}/${folderName}`;

        try {
            await this.app.vault.createFolder(fullPath);
        } catch (e) {
            // Folder might already exist, that's ok
        }

        const chatFilePath = `${fullPath}/chat.md`;
        let chatFile = this.app.vault.getAbstractFileByPath(chatFilePath);

        if (!chatFile) {
            chatFile = await this.app.vault.create(
                chatFilePath,
                `# ${name}\n\nCreated: ${new Date().toLocaleString()}\n\n---\n\n`
            );
        }

        const chatFolder = this.app.vault.getAbstractFileByPath(fullPath);
        await this.openChat(chatFile, chatFolder);
    }

    async openChat(file, folder) {
        this.currentChatFile = file;
        this.currentChatFolder = folder;

        const container = this.containerEl.children[1];
        container.empty();
        container.addClass('notegpt-chat-view');
        
        // Force Obsidian container to cooperate on mobile
        container.style.height = '100%';
        container.style.maxHeight = '100%';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';

        // Header with back button
        const header = container.createDiv({ cls: 'notegpt-chat-header' });

        const backBtn = header.createEl('button', {
            text: '← Back',
            cls: 'notegpt-back-btn'
        });
        backBtn.addEventListener('click', () => this.showChatList());

        header.createEl('h4', { text: folder.name, cls: 'notegpt-chat-current-title' });

        // Chat content
        const chatContent = container.createDiv({ cls: 'notegpt-chat-content' });
        const content = await this.app.vault.read(file);
        await MarkdownRenderer.renderMarkdown(content, chatContent, file.path, this);

        // Style message bubbles
        const paragraphs = chatContent.querySelectorAll('p');
        paragraphs.forEach(p => {
            const text = p.textContent || '';
            if (text.startsWith('You:')) {
                // Get the message content without "You:"
                const messageText = p.innerHTML.replace(/^\*\*You:\*\*\s*/, '').trim();

                // Clear and rebuild as bubble
                p.empty();
                p.addClass('notegpt-user-message');
                const bubble = p.createDiv({ cls: 'notegpt-bubble' });
                bubble.innerHTML = messageText;
            } else if (text.startsWith('Assistant:')) {
                // Remove "Assistant:" prefix - keep default Obsidian formatting
                p.innerHTML = p.innerHTML.replace(/^\*\*Assistant:\*\*\s*/, '').trim();
            }
        });

        // Scroll to bottom
        chatContent.scrollTop = chatContent.scrollHeight;

        // Input area
        const inputArea = container.createDiv({ cls: 'notegpt-input-area' });

        const textarea = inputArea.createEl('textarea', {
            placeholder: 'Ask something...',
            cls: 'notegpt-input'
        });

        const sendBtn = inputArea.createEl('button', {
            text: 'Send',
            cls: 'mod-cta notegpt-send-btn'
        });

        const sendMessage = async () => {
            const message = textarea.value.trim();
            if (!message) return;

            textarea.value = '';
            textarea.disabled = true;
            sendBtn.disabled = true;

            // Append user message immediately
            const userMsg = `\n\n**You:** ${message}\n\n`;
            await this.app.vault.append(file, userMsg);

            // Show user message and loading indicator
            const userBubbleContainer = chatContent.createDiv({ cls: 'notegpt-user-message' });
            const userBubble = userBubbleContainer.createDiv({ cls: 'notegpt-bubble' });
            userBubble.setText(message);

            const loadingDiv = chatContent.createDiv({ cls: 'notegpt-loading' });
            const loadingDots = loadingDiv.createDiv({ cls: 'notegpt-loading-dots' });
            loadingDots.createSpan();
            loadingDots.createSpan();
            loadingDots.createSpan();

            chatContent.scrollTop = chatContent.scrollHeight;

            try {
                // Get AI response with chat-specific config
                const chatCfg = {
                    ...this.plugin.cfg,
                    system: 'You are a helpful AI assistant integrated into Obsidian. Provide concise, helpful responses.'
                };
                const aiResponse = await callChat(chatCfg, message, '');
                const aiMsg = `**Assistant:** ${aiResponse}\n\n`;
                await this.app.vault.append(file, aiMsg);

                // Reload chat
                await this.openChat(file, folder);
            } catch (e) {
                new Notice(String(e?.message || e), 6000);
                loadingDiv.remove();
                textarea.value = message;
                textarea.disabled = false;
                sendBtn.disabled = false;
                textarea.focus();
            }
        };

        sendBtn.addEventListener('click', sendMessage);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Mobile keyboard handling - detect keyboard height and adjust input position
        let initialHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        let keyboardHeight = 0;
        
        // Remove old resize handler if exists
        if (this.resizeHandler) {
            window.removeEventListener('resize', this.resizeHandler);
        }
        
        const updateLayout = () => {
            const currentHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
            keyboardHeight = Math.max(0, initialHeight - currentHeight);
            
            if (keyboardHeight > 100) {
                // Keyboard is open - move input area up by keyboard height
                inputArea.style.transform = `translateY(-${keyboardHeight}px)`;
                inputArea.style.transition = 'transform 0.2s ease-out';
                
                // Adjust chat content to not be covered
                chatContent.style.marginBottom = `${keyboardHeight}px`;
                
                // Scroll to bottom
                setTimeout(() => {
                    chatContent.scrollTop = chatContent.scrollHeight;
                }, 100);
            } else {
                // Keyboard closed - reset
                inputArea.style.transform = 'translateY(0)';
                chatContent.style.marginBottom = '0';
            }
        };
        
        textarea.addEventListener('focus', () => {
            setTimeout(updateLayout, 300);
            setTimeout(updateLayout, 600);
        });
        
        textarea.addEventListener('blur', () => {
            setTimeout(() => {
                inputArea.style.transform = 'translateY(0)';
                chatContent.style.marginBottom = '0';
                keyboardHeight = 0;
            }, 100);
        });
        
        // Handle window resize (keyboard open/close) using visualViewport if available
        this.resizeHandler = () => {
            updateLayout();
        };
        
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', this.resizeHandler);
            window.visualViewport.addEventListener('scroll', this.resizeHandler);
        } else {
            window.addEventListener('resize', this.resizeHandler);
        }

        textarea.focus();
    }

    async onClose() {
        // Cleanup resize handler
        if (this.resizeHandler) {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', this.resizeHandler);
                window.visualViewport.removeEventListener('scroll', this.resizeHandler);
            } else {
                window.removeEventListener('resize', this.resizeHandler);
            }
            this.resizeHandler = null;
        }
    }
}


/* ---------- plugin ---------- */
module.exports = class NoteGPT extends Plugin {
    async onload() {
        this.cfgPath = `${this.app.vault.configDir}/plugins/${this.manifest.id}/data.json`;
        this.cfg = await readJson(this.app.vault.adapter, this.cfgPath) || {};

        // Register chat view
        this.registerView(
            CHAT_VIEW_TYPE,
            (leaf) => new ChatView(leaf, this)
        );

        // Command: Open chat sidebar
        this.addCommand({
            id: 'notegpt-open-chat',
            name: 'NoteGPT: Open chat history',
            callback: () => this.activateChatView(),
        });

        // Command: Refactor selection
        this.addCommand({
            id: 'notegpt-refactor-selection',
            name: 'NoteGPT: Refactor selection',
            editorCheckCallback: (checking, editor) => {
                const hasSel = !!editor.getSelection();
                if (checking) return hasSel;      // show/enable only when selection exists
                this.openRefactor(editor);        // runs with current selection
            },
        });

        // Ribbon icon: Open chat history
        this.addRibbonIcon('messages-square', 'NoteGPT Chat History', () => {
            this.activateChatView();
        });

        // Context menu: Refactor (desktop only)
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

    async activateChatView() {
        const { workspace } = this.app;

        let leaf = null;
        const leaves = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

        if (leaves.length > 0) {
            // View already exists, reveal it
            leaf = leaves[0];
        } else {
            // Create new view in a regular tab
            leaf = workspace.getLeaf('tab');
            await leaf.setViewState({
                type: CHAT_VIEW_TYPE,
                active: true,
            });
        }

        workspace.revealLeaf(leaf);
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

    onunload() { }
};