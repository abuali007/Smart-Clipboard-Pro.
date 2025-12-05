import { TABS } from './constants.js';

export function registerEvents(dom, handlers) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab) {
                handlers.switchTab(btn.dataset.tab);
            }
        });
    });

    dom.searchInput?.addEventListener('input', (event) => {
        handlers.search(event.target.value);
    });
    dom.searchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            handlers.clearSearch();
        }
    });

    dom.themeToggle?.addEventListener('click', handlers.toggleTheme);
    dom.autoSaveToggle?.addEventListener('click', (event) => {
        event.preventDefault();
        handlers.toggleAutoSave();
    });
    dom.settingsBtn?.addEventListener('click', handlers.openSettings);
    dom.upgradeBtn?.addEventListener('click', handlers.openUpgrade);
    dom.addSnippetBtns?.forEach((btn) => btn.addEventListener('click', handlers.openCreateSnippet));

    dom.freeUserBanner?.addEventListener('click', (event) => {
        if (event.target.closest('[data-action="open-upgrade"]')) {
            handlers.openUpgrade();
        }
    });
    dom.bannerUpgradeBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handlers.openUpgrade();
    });
    dom.bannerDismissBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handlers.dismissBanner();
    });

    dom.usageSummary?.addEventListener('click', (event) => {
        const toggle = event.target.closest('[data-action="toggle-info"]');
        if (toggle) {
            event.preventDefault();
            handlers.toggleInfoPanel();
        }
    });

    dom.historyTab?.addEventListener('click', (event) => handleListEvent(event, handlers));
    dom.pinnedTab?.addEventListener('click', (event) => handleListEvent(event, handlers));
    dom.topTab?.addEventListener('click', (event) => handleListEvent(event, handlers));
    dom.snippetsTab?.addEventListener('click', (event) => handleSnippetEvent(event, handlers));

    dom.snippetEditModal?.addEventListener('click', (event) => {
        if (event.target === dom.snippetEditModal) {
            handlers.closeSnippetModal();
        }
    });
    dom.modalCloseBtn?.addEventListener('click', handlers.closeSnippetModal);
    dom.saveSnippetChangesBtn?.addEventListener('click', handlers.saveSnippetFromModal);
    dom.saveClipboardChangesBtn?.addEventListener('click', handlers.saveClipboardEdits);
    dom.cancelClipboardEditBtn?.addEventListener('click', handlers.closeClipboardEditor);
    dom.closeClipboardEditModal?.addEventListener('click', handlers.closeClipboardEditor);
    dom.editClipboardText?.addEventListener('input', (event) => {
        handlers.onClipboardEditTextChange(event.target.value);
    });
    dom.clearEmojiBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        handlers.applyEmojiPreset('');
    });
    dom.toggleEmojiPopoverBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        handlers.toggleEmojiPopover();
    });
    dom.emojiSuggestions?.addEventListener('click', (event) => {
        const option = event.target.closest('.emoji-option');
        if (option) {
            event.preventDefault();
            const value = (option.textContent || '').trim() || option.dataset.emojiValue || '';
            handlers.applyEmojiPreset(value);
        }
    });

    document.addEventListener('click', (event) => {
        if (!dom.emojiPicker?.contains(event.target)) {
            handlers.hideEmojiPopover();
        }
    });
    document.addEventListener('keydown', handlers.handleGlobalShortcuts);
}

function handleListEvent(event, handlers) {
    const loadMoreBtn = event.target.closest('#loadMoreHistoryBtn');
    if (loadMoreBtn) {
        loadMoreBtn.disabled = true;
        handlers.loadMoreHistory();
        return;
    }

    const clearHistoryBtn = event.target.closest('[data-action="clear-history"]');
    if (clearHistoryBtn) {
        clearHistoryBtn.disabled = true;
        Promise.resolve(handlers.clearHistory?.())
            .finally(() => {
                clearHistoryBtn.disabled = false;
            });
        return;
    }

    const actionBtn = event.target.closest('.action-btn');
    if (actionBtn) {
        triggerAction(actionBtn.dataset, handlers);
        event.stopPropagation();
        return;
    }

    const item = event.target.closest('.clipboard-item');
    if (item) {
        handlers.copyItem(item.dataset.id, item.dataset.type || TABS.HISTORY);
    }
}

function handleSnippetEvent(event, handlers) {
    const actionBtn = event.target.closest('.action-btn');
    if (actionBtn) {
        triggerSnippetAction(actionBtn.dataset, handlers);
        event.stopPropagation();
        return;
    }
    const item = event.target.closest('.clipboard-item');
    if (item) {
        handlers.copySnippet(item.dataset.id);
    }
}

function triggerAction(dataset, handlers) {
    const { action, id, type, source } = dataset;
    switch (action) {
        case 'copy':
            handlers.copyItem(id, type ?? source);
            break;
        case 'pin':
            handlers.pinItem(id);
            break;
        case 'unpin':
            handlers.unpinItem(id);
            break;
        case 'unpin':
            handlers.unpinItem(id);
            break;
        case 'delete':
            handlers.deleteItem(id, type);
            break;
        case 'edit-item':
            handlers.editClipboardItem(id, type ?? source);
            break;
        case 'clear-history':
            handlers.clearHistory();
            break;
        case 'open-upgrade':
            handlers.openUpgrade();
            break;
    }
}

function triggerSnippetAction(dataset, handlers) {
    const { action, id } = dataset;
    switch (action) {
        case 'copy-snippet':
            handlers.copySnippet(id);
            break;
        case 'edit-snippet':
            handlers.editSnippet(id);
            break;
        case 'delete-snippet':
            handlers.deleteSnippet(id);
            break;
    }
}
