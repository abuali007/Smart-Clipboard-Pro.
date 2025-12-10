// Smart Clipboard Pro Enhanced - Content Script v5.1.5
// ================================================

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        AUTO_SAVE_DELAY: 500, // ms
        MIN_TEXT_LENGTH: 3,
        MAX_TEXT_LENGTH: 10000,
        CONTEXT_MENU_ID: 'smart-clipboard-copy'
    };

    function debounce(fn, wait = 200) {
        let timeoutId = null;
        return function debounced(...args) {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    class SnippetTrie {
        constructor() {
            this.root = { children: {}, value: null };
        }

        insert(trigger, snippet) {
            if (!trigger) return;
            let node = this.root;
            for (let i = trigger.length - 1; i >= 0; i -= 1) {
                const char = trigger[i];
                if (!node.children[char]) {
                    node.children[char] = { children: {}, value: null };
                }
                node = node.children[char];
            }
            node.value = { snippet, trigger };
        }

        matchSuffix(text = '') {
            if (!text) return null;
            let node = this.root;
            let match = null;
            for (let i = text.length - 1; i >= 0; i -= 1) {
                const char = text[i];
                if (!node.children[char]) break;
                node = node.children[char];
                if (node.value) {
                    match = node.value;
                }
            }
            return match;
        }
    }

    // State management
    let isExtensionActive = true;
    let lastSelectedText = '';
    let autoSaveTimeout = null;
    let isProcessing = false;

    // Snippets expansion
    let snippets = [];
    let lastInputValue = '';
    let snippetExpansionEnabled = true;
    let keyboardShortcutsEnabled = true;
    const SUPPORTED_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'password', 'tel', 'number']);
    const snippetKeydownListener = (event) => handleSnippetKeydown(event);
    let cleanupObserver = null;
    const debouncedHandleTextSelection = debounce((event) => handleTextSelection(event), 300);
    let debouncedSnippetInput = null;
    let snippetTrie = null;

    function ensureSnippetTrie() {
        if (!snippetTrie) {
            snippetTrie = new SnippetTrie();
        }
        return snippetTrie;
    }

    // Initialize content script
    async function init() {
        try {
            console.log('Smart Clipboard Pro Enhanced - Content Script v5.1.5 initialized');
            
            // Check if extension context is valid
            if (!chrome.runtime?.id) {
                console.warn('Extension context invalid, content script disabled');
                isExtensionActive = false;
                return;
            }

            await loadSettingsPreferences();
            setupEventListeners();
            setupContextMenu();
            
        } catch (error) {
            console.error('Failed to initialize Smart Clipboard Pro content script:', error);
            isExtensionActive = false;
        }
    }
    
    // Load snippets
    async function loadSnippets() {
        try {
            const data = await chrome.storage.local.get(['snippets']);
            updateSnippetsCache(data.snippets || []);
        } catch (error) {
            console.error('Error loading snippets:', error);
        }
    }

    async function loadSettingsPreferences() {
        try {
            const data = await chrome.storage.local.get(['settings']);
            applySettingsPreference(data.settings || {});
        } catch (error) {
            console.error('Error loading settings preference:', error);
        }
    }

    function applySettingsPreference(settings = {}) {
        applyAutoSaveSetting(settings);
        applyKeyboardShortcutSetting(settings);
    }

    function applyAutoSaveSetting(settings = {}) {
        const shouldEnable = settings.autoSave !== false;
        updateExtensionActiveState(shouldEnable);
    }

    function applyKeyboardShortcutSetting(settings = {}) {
        const enabled = settings.keyboardShortcuts !== false;
        keyboardShortcutsEnabled = enabled;
        snippetExpansionEnabled = enabled;
        console.log(`Snippet/shortcut expansion ${enabled ? 'enabled' : 'disabled'} via settings`);
    }

    function updateExtensionActiveState(enabled) {
        const nextState = enabled !== false;
        if (isExtensionActive === nextState) return;
        isExtensionActive = nextState;
        if (!isExtensionActive && autoSaveTimeout) {
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = null;
            lastSelectedText = '';
        }
        console.log(`Smart Clipboard Pro auto-save ${isExtensionActive ? 'enabled' : 'paused'}`);
    }
    
    async function sendMessageSafe(message) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    resolve(response);
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Check if Pro user
    async function isProUser() {
        try {
            const response = await sendMessageSafe({ action: 'checkLicenseStatus' });
            return response?.isPro || false;
        } catch (error) {
            return false;
        }
    }

    function recordSnippetUsage(snippet) {
        const shortcut = snippet?.shortcut || snippet?.keyword || '';
        sendMessageSafe({
            action: 'recordUsage',
            payload: { event: 'snippet_used', source: 'snippet', shortcut }
        }).catch(() => {});
    }
    
    // Expand snippet inside standard inputs/textareas
    function expandSnippetInTextInput(inputElement, shortcut, fullText) {
        const currentValue = inputElement.value || '';
        const cursorPos = inputElement.selectionStart || 0;
        const beforeCursor = currentValue.substring(0, cursorPos);
        const shortcutIndex = beforeCursor.lastIndexOf(shortcut);
        
        if (shortcutIndex === -1) return false;
        
        const charBefore = shortcutIndex > 0 ? currentValue[shortcutIndex - 1] : ' ';
        const afterIndex = shortcutIndex + shortcut.length;
        const charAfter = afterIndex < currentValue.length ? currentValue[afterIndex] : ' ';
        
        if (!isWordBoundary(charBefore) && shortcutIndex > 0) {
            return false;
        }
        if (!isWordBoundary(charAfter)) {
            return false;
        }
        
        const beforeShortcut = currentValue.substring(0, shortcutIndex);
        const afterShortcut = currentValue.substring(afterIndex);
        const newValue = beforeShortcut + fullText + afterShortcut;
        
        inputElement.value = newValue;
        
        const newCursorPos = shortcutIndex + fullText.length;
        inputElement.setSelectionRange(newCursorPos, newCursorPos);
        
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        recordSnippetUsage({ shortcut, text: fullText });
        
        return true;
    }

    const BOUNDARY_PUNCTUATION = new Set(['', ' ', '\n', '\r', '\t', '.', ',', '!', '?', ':', ';', '"', '\'', '(', ')', '[', ']', '{', '}', '-', '—', '…']);

    function isWordBoundary(char) {
        if (char === undefined || char === null) return true;
        if (BOUNDARY_PUNCTUATION.has(char)) return true;
        return /\s/.test(char);
    }

    function isSupportedTextInput(element) {
        if (!element) return false;
        if (element.tagName === 'TEXTAREA') return true;
        if (element.tagName === 'INPUT') {
            const type = (element.getAttribute('type') || 'text').toLowerCase();
            return !element.readOnly && !element.disabled && (SUPPORTED_INPUT_TYPES.has(type) || type === '');
        }
        return false;
    }

    function isContentEditableTarget(element) {
        if (!element) return false;
        return Boolean(element.isContentEditable || element.getAttribute?.('contenteditable') === 'true');
    }

    function findSnippetTrigger(text = '') {
        if (!text) return null;
        const trie = ensureSnippetTrie();
        return trie.matchSuffix(text);
    }

    function getEditableCaretContext(target) {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        if (!target.contains(range.startContainer)) return null;

        const beforeRange = range.cloneRange();
        beforeRange.selectNodeContents(target);
        beforeRange.setEnd(range.startContainer, range.startOffset);
        const beforeText = beforeRange.toString();

        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(target);
        afterRange.setStart(range.startContainer, range.startOffset);
        const afterChar = afterRange.toString().charAt(0) || ' ';

        return { beforeText, afterChar, range, selection };
    }

    function expandSnippetInContentEditable(target, shortcut, fullText, caretContext = null) {
        const context = caretContext || getEditableCaretContext(target);
        if (!context) return false;
        const { beforeText, afterChar, range, selection } = context;
        
        if (!beforeText.endsWith(shortcut)) return false;
        const charBefore = beforeText.length > shortcut.length ? beforeText[beforeText.length - shortcut.length - 1] : ' ';
        if (!isWordBoundary(charBefore)) return false;
        if (!isWordBoundary(afterChar)) return false;

        const workingRange = range.cloneRange();
        selection.removeAllRanges();
        selection.addRange(workingRange);

        if (selection.modify) {
            for (let i = 0; i < shortcut.length; i++) {
                selection.modify('extend', 'backward', 'character');
            }
        } else {
            const startOffset = Math.max(0, workingRange.startOffset - shortcut.length);
            workingRange.setStart(workingRange.startContainer, startOffset);
            selection.removeAllRanges();
            selection.addRange(workingRange);
        }

        if (selection.toString() !== shortcut) {
            selection.removeAllRanges();
            selection.addRange(range);
            return false;
        }

        const inserted = document.execCommand('insertText', false, fullText);
        if (!inserted) {
            const activeRange = selection.getRangeAt(0);
            activeRange.deleteContents();
            const textNode = document.createTextNode(fullText);
            activeRange.insertNode(textNode);
            activeRange.setStartAfter(textNode);
            activeRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(activeRange);
        }

        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        recordSnippetUsage({ shortcut, text: fullText });
        return true;
    }
    
    // Handle input for snippet expansion
    function handleSnippetInput(event) {
        if (!snippetExpansionEnabled || snippets.length === 0) return;
        
        const target = event.target;
        if (!target) return;
        
        if (isSupportedTextInput(target)) {
            const currentValue = target.value || '';
            const cursorPos = target.selectionStart || 0;
            const beforeCursor = currentValue.substring(0, cursorPos);
            const match = findSnippetTrigger(beforeCursor);
            if (match) {
                const charAfter = cursorPos < currentValue.length ? currentValue[cursorPos] : ' ';
                if (isWordBoundary(charAfter)) {
                    expandSnippetInTextInput(target, match.trigger, match.snippet.text);
                }
            }
            return;
        }
        
        if (isContentEditableTarget(target)) {
            const context = getEditableCaretContext(target);
            if (!context) return;
            const match = findSnippetTrigger(context.beforeText);
            if (match && isWordBoundary(context.afterChar)) {
                expandSnippetInContentEditable(target, match.trigger, match.snippet.text, context);
            }
        }
    }
    
    // Handle keydown for snippet expansion (trigger on space/enter/tab)
    function handleSnippetKeydown(event) {
        if (!snippetExpansionEnabled || snippets.length === 0) return;
        
        const target = event.target;
        if (!target) return;
        
        if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'Tab') {
            return;
        }
        
        if (isSupportedTextInput(target)) {
            const currentValue = target.value || '';
            const cursorPos = target.selectionStart || 0;
            const beforeCursor = currentValue.substring(0, cursorPos);
            const match = findSnippetTrigger(beforeCursor);
            if (!match) return;
            
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
            }
            
            setTimeout(() => {
                expandSnippetInTextInput(target, match.trigger, match.snippet.text);
            }, 10);
            return;
        }
        
        if (isContentEditableTarget(target)) {
            const context = getEditableCaretContext(target);
            if (!context) return;
            const match = findSnippetTrigger(context.beforeText);
            if (!match) return;
            
            if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
            }
            
            setTimeout(() => {
                const refreshed = getEditableCaretContext(target);
                if (!refreshed) return;
                expandSnippetInContentEditable(target, match.trigger, match.snippet.text, refreshed);
            }, 10);
        }
    }
    
    // Setup event listeners
    function setupEventListeners() {
        // Text selection monitoring
        document.addEventListener('mouseup', debouncedHandleTextSelection, { passive: true });
        document.addEventListener('keyup', debouncedHandleTextSelection, { passive: true });
        document.addEventListener('touchend', debouncedHandleTextSelection, { passive: true });
        
        // Copy event monitoring
        document.addEventListener('copy', handleCopyEvent, { passive: true });
        
        // Context menu events
        document.addEventListener('contextmenu', handleContextMenu, { passive: true });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', handleKeyboardShortcuts);
        
        // Snippet expansion
        debouncedSnippetInput = debouncedSnippetInput || debounce(handleSnippetInput, 200);
        document.addEventListener('input', debouncedSnippetInput, { capture: true });
        
        // Handle keydown for snippet expansion
        document.addEventListener('keydown', snippetKeydownListener, true);
        
        // Extension message listener
        chrome.runtime.onMessage.addListener(handleExtensionMessage);
        chrome.storage.onChanged.addListener(handleStorageChange);
        
        // Load snippets on init
        loadSnippets();
        installCleanupObserver();
        
        console.log('Event listeners setup completed');
    }

    function normalizeSnippetData(snippet) {
        if (!snippet) return null;
        const rawShortcut = (snippet.shortcut || snippet.keyword || '').trim();
        if (!rawShortcut) return null;
        const keyword = rawShortcut.replace(/^:/, '');
        const normalized = {
            ...snippet,
            keyword,
            shortcut: rawShortcut
        };
        normalized.triggers = buildSnippetTriggers(normalized);
        return normalized;
    }

    function buildSnippetTriggers(snippet) {
        const triggers = new Set();
        if (snippet.shortcut) {
            triggers.add(snippet.shortcut);
            triggers.add(snippet.shortcut.replace(/^:/, ''));
        }
        if (snippet.keyword) {
            triggers.add(snippet.keyword);
            triggers.add(`:${snippet.keyword}`);
        }
        return Array.from(triggers).filter(Boolean);
    }

    function updateSnippetsCache(list) {
        snippets = list
            .map(normalizeSnippetData)
            .filter(Boolean);
        snippetTrie = new SnippetTrie();
        for (const snippet of snippets) {
            if (!Array.isArray(snippet.triggers)) continue;
            snippet.triggers.forEach((trigger) => snippetTrie.insert(trigger, snippet));
        }
        console.log('Loaded snippets:', snippets.length);
    }

    function handleStorageChange(changes, areaName) {
        if (areaName !== 'local') return;
        if (changes.snippets) {
            updateSnippetsCache(changes.snippets.newValue || []);
        }
        if (changes.settings) {
            applySettingsPreference(changes.settings.newValue || {});
        }
    }

    // Handle text selection
    function handleTextSelection(event) {
        if (!isExtensionActive || isProcessing) return;
        
        try {
            const selectedText = getSelectedText();
            
            if (selectedText && selectedText !== lastSelectedText) {
                lastSelectedText = selectedText;
                
                // Clear previous timeout
                if (autoSaveTimeout) {
                    clearTimeout(autoSaveTimeout);
                }
                
                // Auto-save with delay
                autoSaveTimeout = setTimeout(() => {
                    autoSaveSelectedText(selectedText);
                }, CONFIG.AUTO_SAVE_DELAY);
            }
        } catch (error) {
            console.error('Error handling text selection:', error);
        }
    }

    // Handle copy events
    function handleCopyEvent(event) {
        if (!isExtensionActive || !keyboardShortcutsEnabled) return;
        
        try {
            // Get clipboard data from the copy event
            const clipboardData = event.clipboardData;
            if (clipboardData) {
                const text = clipboardData.getData('text/plain');
                if (text && isValidText(text)) {
                    saveToClipboardHistory(text, 'copy_event');
                }
            }
        } catch (error) {
            console.error('Error handling copy event:', error);
        }
    }

    // Handle context menu
    async function handleContextMenu(event) {
        if (!isExtensionActive) return;
        if (!chrome.runtime?.id) return;
        
        try {
            const selectedText = getSelectedText();
            
            // Store selected text for context menu action
            if (selectedText && isValidText(selectedText)) {
                await sendMessageSafe({
                    action: 'setContextText',
                    text: selectedText,
                    source: 'context_menu'
                }).catch(() => {});
            }
        } catch (error) {
            // Swallow context menu errors to avoid noisy logs on sites like YouTube
        }
    }

    // Handle keyboard shortcuts
    function handleKeyboardShortcuts(event) {
        if (!isExtensionActive) return;
        
        try {
            // Ctrl+Shift+S: Save selected text
            if (event.ctrlKey && event.shiftKey && event.key === 'S') {
                event.preventDefault();
                const selectedText = getSelectedText();
                if (selectedText && isValidText(selectedText)) {
                    saveToClipboardHistory(selectedText, 'keyboard_shortcut');
                    showNotification('Text saved to clipboard', 'success');
                }
            }
            
            // Ctrl+Shift+C: Copy and save
            if (event.ctrlKey && event.shiftKey && event.key === 'C') {
                const selectedText = getSelectedText();
                if (selectedText && isValidText(selectedText)) {
                    copyToClipboard(selectedText);
                    saveToClipboardHistory(selectedText, 'keyboard_shortcut');
                    showNotification('Text copied and saved', 'success');
                }
            }
        } catch (error) {
            console.error('Error handling keyboard shortcuts:', error);
        }
    }

    // Handle extension messages
    function handleExtensionMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'getSelectedText':
                    sendResponse({ text: getSelectedText() });
                    break;
                    
                case 'copyText':
                    copyToClipboard(request.text);
                    sendResponse({ success: true });
                    break;
                    
                case 'saveSelectedText':
                    const selectedText = getSelectedText();
                    if (selectedText && isValidText(selectedText)) {
                        saveToClipboardHistory(selectedText, 'manual_save');
                        sendResponse({ success: true, text: selectedText });
                    } else {
                        sendResponse({ success: false, error: 'No valid text selected' });
                    }
                    break;
                    
                case 'checkStatus':
                    sendResponse({ 
                        active: isExtensionActive,
                        lastSelectedText: lastSelectedText
                    });
                    break;
                    
                default:
                    sendResponse({ error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Error handling extension message:', error);
            sendResponse({ error: error.message });
        }
        
        return true; // Keep message channel open for async response
    }

    // Get selected text
    function getSelectedText() {
        try {
            const selection = window.getSelection();
            if (selection && selection.rangeCount > 0) {
                const text = selection.toString().trim();
                return text || '';
            }
            return '';
        } catch (error) {
            console.error('Error getting selected text:', error);
            return '';
        }
    }

    // Validate text
    function isValidText(text) {
        if (!text || typeof text !== 'string') return false;
        
        const trimmedText = text.trim();
        return trimmedText.length >= CONFIG.MIN_TEXT_LENGTH && 
               trimmedText.length <= CONFIG.MAX_TEXT_LENGTH;
    }

    // Auto-save selected text
    function autoSaveSelectedText(text) {
        if (!isValidText(text) || isProcessing) return;
        if (!isExtensionActive || !chrome.runtime?.id) {
            return;
        }
        
        isProcessing = true;

        saveToClipboardHistory(text, 'auto_save')
            .then((result) => {
                if (result?.success) {
                    console.log('Auto-saved selected text:', `${text.substring(0, 50)}...`);
                }
            })
            .catch((error) => {
                const message = error?.message || '';
                if (message.includes('Extension not active')) {
                    return;
                }
                // Swallow other auto-save failures silently to reduce console noise
            })
            .finally(() => {
                isProcessing = false;
            });
    }

    // Save to clipboard history
    async function saveToClipboardHistory(text, source = 'unknown') {
        if (!isExtensionActive || !chrome.runtime?.id) {
            return { success: false, skipped: true, error: 'Extension not active' };
        }

        try {
            const response = await sendMessageSafe({
                action: 'saveToHistory',
                text,
                source,
                timestamp: Date.now(),
                url: window.location.href,
                title: document.title
            });
            if (response?.success) {
                return response;
            }
            return { success: false, error: response?.error || 'Failed to save text' };
        } catch (error) {
            if (isConnectionUnavailable(error)) {
                console.warn('Background unreachable, using fallback history writer.');
                return await fallbackSaveToHistory(text);
            }
            return { success: false, error: error?.message || 'Unknown save error' };
        }
    }

    function isConnectionUnavailable(error) {
        const message = error?.message || '';
        return message.includes('Could not establish connection') || message.includes('Receiving end does not exist');
    }

    let fallbackIdCounter = 0;
    function generateFallbackId(prefix = 'fallback') {
        if (typeof crypto?.randomUUID === 'function') {
            return `${prefix}-${crypto.randomUUID().replace(/-/g, '')}`;
        }
        if (typeof crypto?.getRandomValues === 'function') {
            const bytes = crypto.getRandomValues(new Uint8Array(8));
            const randomPart = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
            return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
        }
        fallbackIdCounter += 1;
        return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
    }

    async function fallbackSaveToHistory(text) {
        try {
            const data = await chrome.storage.local.get(['clipboardHistory']);
            const history = Array.isArray(data.clipboardHistory) ? data.clipboardHistory.slice() : [];
            const normalized = text.trim();
            const filtered = history.filter((item) => (item?.text || '').trim() !== normalized);
            const newItem = {
                id: generateFallbackId('fallback'),
                text,
                timestamp: Date.now(),
                type: detectContentType(text)
            };
            filtered.unshift(newItem);
            const maxItems = 50;
            const trimmed = filtered.slice(0, maxItems);
            await chrome.storage.local.set({ clipboardHistory: trimmed });
            return { success: true, fallback: true };
        } catch (fallbackError) {
            console.error('Fallback history save failed:', fallbackError);
            return { success: false, error: fallbackError?.message || 'Fallback save failed' };
        }
    }

    function detectContentType(text) {
        if (/^https?:\/\/.+/.test(text)) return 'url';
        if (/^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(text)) return 'email';
        if (/^\d+$/.test(text)) return 'number';
        if (text.includes('function') || text.includes('class') || text.includes('const') || text.includes('let')) return 'code';
        return 'text';
    }

    // Copy text to clipboard
    function copyToClipboard(text) {
        try {
            // Try modern clipboard API first
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).catch(error => {
                    console.warn('Modern clipboard API failed, using fallback:', error);
                    fallbackCopyToClipboard(text);
                });
            } else {
                fallbackCopyToClipboard(text);
            }
        } catch (error) {
            console.error('Error copying to clipboard:', error);
            fallbackCopyToClipboard(text);
        }
    }

    // Fallback copy method
    function fallbackCopyToClipboard(text) {
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (!successful) {
                throw new Error('execCommand copy failed');
            }
        } catch (error) {
            console.error('Fallback copy failed:', error);
        }
    }

    // Setup context menu
    function setupContextMenu() {
        try {
            // Context menu is handled by background script
            // This function is for future context menu enhancements
            console.log('Context menu setup completed');
        } catch (error) {
            console.error('Error setting up context menu:', error);
        }
    }



    // Show notification
    function showNotification(message, type = 'info') {
        try {
            // Create notification element
            const notification = document.createElement('div');
            notification.className = `smart-clipboard-notification ${type}`;
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: ${type === 'success' ? '#059669' : type === 'error' ? '#dc2626' : '#2563eb'};
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 500;
                z-index: 10000;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                transform: translateX(100%);
                transition: transform 0.3s ease;
                max-width: 300px;
                word-wrap: break-word;
                direction: rtl;
                text-align: right;
            `;
            
            document.body.appendChild(notification);
            
            // Animate in
            setTimeout(() => {
                notification.style.transform = 'translateX(0)';
            }, 100);
            
            // Remove after delay
            setTimeout(() => {
                notification.style.transform = 'translateX(100%)';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }, 3000);
            
        } catch (error) {
            console.error('Error showing notification:', error);
        }
    }

    function installCleanupObserver() {
        if (cleanupObserver) return;
        cleanupObserver = new MutationObserver(() => {
            if (!document || !document.body) return;
            if (!document.body.isConnected) {
                cleanup();
            }
        });
        try {
            cleanupObserver.observe(document.documentElement || document, { childList: true, subtree: true });
        } catch (error) {
            console.warn('Cleanup observer install failed:', error);
        }
    }

    // Cleanup function
    function cleanup() {
        try {
            if (autoSaveTimeout) {
                clearTimeout(autoSaveTimeout);
            }
            
            // Remove event listeners
            document.removeEventListener('mouseup', debouncedHandleTextSelection);
            document.removeEventListener('keyup', debouncedHandleTextSelection);
            document.removeEventListener('touchend', debouncedHandleTextSelection);
            document.removeEventListener('copy', handleCopyEvent);
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyboardShortcuts);
            if (debouncedSnippetInput) {
                document.removeEventListener('input', debouncedSnippetInput, true);
            } else {
                document.removeEventListener('input', handleSnippetInput, true);
            }
            document.removeEventListener('keydown', snippetKeydownListener, true);
            chrome.runtime.onMessage.removeListener(handleExtensionMessage);
            chrome.storage.onChanged.removeListener(handleStorageChange);
            if (cleanupObserver) {
                try {
                    cleanupObserver.disconnect();
                } catch (observerError) {
                    console.warn('Cleanup observer disconnect failed:', observerError);
                }
                cleanupObserver = null;
            }
            
            console.log('Smart Clipboard Pro content script cleanup completed');
        } catch (error) {
            // Swallow cleanup errors to avoid noisy console logs on certain sites
            console.warn('Cleanup skipped due to page scripts:', error);
        }
    }

    // Handle page unload
    window.addEventListener('beforeunload', cleanup);

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for debugging (development only)
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        window.SmartClipboardContent = {
            getSelectedText,
            saveToClipboardHistory,
            copyToClipboard,
            isExtensionActive: () => isExtensionActive,
            lastSelectedText: () => lastSelectedText
        };
    }

})();
