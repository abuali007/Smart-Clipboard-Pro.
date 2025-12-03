import {
    initUI,
    render,
    updateSearchInput,
    openSnippetModal,
    closeSnippetModal,
    setTheme,
    openClipboardEditModal,
    closeClipboardEditModal,
    updateClipboardEditorCharCount
} from './ui.js';
import { registerEvents } from './events.js';
import { getState, patchState, updateState, setLoading, subscribe } from './state.js';
import { minutesFromCharacters } from './analytics.js';
import {
    bootstrapData,
    fetchHistory,
    fetchTopHistory,
    fetchPinnedItems,
    saveSnippets,
    requestPin,
    requestUnpin,
    requestDelete,
    saveSettings,
    updateClipboardItem,
    fetchSettings,
    recordUsage,
    saveToHistory,
    clearHistoryItems
} from './services.js';
import { showToast, showError } from './toast.js';
import { reportError } from './error-reporter.js';
import { TABS } from './constants.js';

// Chrome sometimes injects its WebUI color-change updater which expects Mojo (not available in extensions).
// Catch and silence that specific ReferenceError so it doesn't flood the console.
function installMojoErrorGuard() {
    const guard = (event) => {
        const message =
            event?.message ||
            event?.reason?.message ||
            (typeof event?.reason === 'string' ? event.reason : '');
        if (typeof message === 'string' && message.includes('Mojo is not defined')) {
            console.warn('Ignoring Chrome WebUI Mojo error in popup context.');
            event.preventDefault?.();
            event.stopImmediatePropagation?.();
            return true;
        }
        return false;
    };
    window.addEventListener('error', (event) => {
        if (guard(event)) {
            return false;
        }
    });
    window.addEventListener('unhandledrejection', (event) => {
        guard(event);
    });
}

installMojoErrorGuard();
const UI_PREFERENCES_KEY = 'popupUIPreferences';
const defaultUIPreferences = {
    infoCollapsed: true,
    bannerDismissed: false
};
let uiPreferences = { ...defaultUIPreferences };
let snippetIdCounter = 0;

function generateSnippetId(prefix = 'snippet') {
    if (typeof crypto?.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID().replace(/-/g, '')}`;
    }
    if (typeof crypto?.getRandomValues === 'function') {
        const bytes = crypto.getRandomValues(new Uint8Array(8));
        const randomPart = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        return `${prefix}-${Date.now().toString(36)}-${randomPart}`;
    }
    snippetIdCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${snippetIdCounter.toString(36)}`;
}
let domRefs;
let lastCopiedSnapshot = { text: '', at: 0 };
document.addEventListener('DOMContentLoaded', async () => {
    domRefs = initUI();
    await loadUIPreferences();
    applyUIPreferences();
    registerEvents(domRefs, createHandlers());
    subscribeToState();
    bootstrap();
});

function subscribeToState() {
    subscribe((state) => {
        render(state);
        applyUIPreferences();
    });
}

async function bootstrap() {
    setLoading(true);
    try {
        const { history, pinned, snippets, top, limits, settings, analytics } = await bootstrapData();
        const historyItems = history?.items || [];
        const normalizedSnippets = (snippets?.items || []).map(normalizeSnippet).filter(Boolean);
        const charactersPasted = analytics?.analytics?.charactersPasted || 0;
        const timeSavedMinutes = analytics?.analytics?.timeSaved ?? minutesFromCharacters(charactersPasted);
        const storedSettings = settings?.settings || {};
        const normalizedSettings = {
            ...storedSettings,
            theme: storedSettings.theme || 'light',
            autoSave: storedSettings.autoSave !== false
        };
        patchState({
            history: {
                items: dedupeById(historyItems),
                page: 0,
                hasMore: Boolean(history?.hasMore),
                total: history?.total ?? historyItems.length,
                isPageLoading: false
            },
            top: Array.isArray(top?.items) ? top.items : [],
            pinned: pinned?.items || [],
            snippets: normalizedSnippets,
            limits: {
                maxHistory: limits?.maxHistory || 0,
                maxPinned: limits?.maxPinned || 0,
                maxSnippets: limits?.maxSnippets || 0,
                freeHistoryLimit: limits?.freeHistoryLimit || limits?.maxHistory || 0,
                freePinnedLimit: limits?.freePinnedLimit || limits?.maxPinned || 0,
                freeSnippetsLimit: limits?.freeSnippetsLimit || limits?.maxSnippets || 0,
                isPro: Boolean(limits?.isPro),
                planLabel: limits?.planLabel || '',
                activatedAt: limits?.activatedAt || null,
                expiresAt: limits?.expiresAt || null,
                nextChargeAt: limits?.nextChargeAt || null,
                subscriptionCancelled: Boolean(limits?.subscriptionCancelled),
                status: limits?.status || null
            },
            settings: normalizedSettings,
            metrics: {
                timeSavedMinutes,
                charactersPasted
            }
        });
        const theme = normalizedSettings.theme || 'light';
        setTheme(theme);
    } catch (error) {
        reportError('bootstrap', error, true, 'Failed to load extension');
    } finally {
        setLoading(false);
    }
}

function createHandlers() {
    return {
        switchTab: (tab) => {
            patchState({ activeTab: tab });
            if (tab === TABS.TOP) {
                refreshTopItems(true);
            }
        },
        search: (query) => {
            updateSearchInput(query);
            patchState({ searchQuery: query.trim() });
        },
        clearSearch: () => {
            updateSearchInput('');
            patchState({ searchQuery: '' });
        },
        toggleTheme: () => toggleTheme(),
        openSettings: () => openSettings(),
        openUpgrade: () => openUpgradePage(),
        openCreateSnippet: () => openSnippetModal(),
        copyItem: (id, type) => copyItem(id, type),
        copySnippet: (id) => copySnippet(id),
        pinItem: (id) => pinItem(id),
        unpinItem: (id) => unpinItem(id),
        deleteItem: (id, type) => deleteItem(id, type),
        editSnippet: (id) => openSnippetEditor(id),
        editClipboardItem: (id, type) => openClipboardEditor(id, type),
        deleteSnippet: (id) => deleteSnippet(id),
        saveSnippetFromModal: () => saveSnippetFromModal(),
        closeSnippetModal: () => closeSnippetModal(),
        closeClipboardEditor: () => closeClipboardEditor(),
        saveClipboardEdits: () => saveClipboardEdits(),
        onClipboardEditTextChange: (text) => updateClipboardEditorCharCount(text?.length || 0),
        loadMoreHistory: () => loadMoreHistory(),
        handleGlobalShortcuts: (event) => handleGlobalShortcuts(event),
        toggleInfoPanel: () => toggleInfoPanel(),
        dismissBanner: () => dismissBanner(),
        toggleAutoSave: () => toggleAutoSave(),
        clearHistory: () => clearHistory(),
        applyEmojiPreset: (emoji) => applyEmojiSelection(emoji),
        toggleEmojiPopover: () => toggleEmojiPopover(),
        hideEmojiPopover: () => hideEmojiPopover()
    };
}

function openSettings() {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
}

function openUpgradePage() {
    chrome.tabs.create({ url: 'https://litextools.gumroad.com/l/imwysv' });
}

async function toggleTheme() {
    const currentTheme = getState().settings.theme === 'dark' ? 'dark' : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    const updatedSettings = {
        ...getState().settings,
        theme: nextTheme
    };
    patchState({ settings: updatedSettings });
    try {
        await saveSettings(updatedSettings);
    } catch (error) {
        reportError('toggleTheme', error, true, 'Unable to save theme');
    }
}

async function toggleAutoSave() {
    const current = getState().settings.autoSave !== false;
    const next = !current;
    const updatedSettings = {
        ...getState().settings,
        autoSave: next
    };
    patchState({ settings: updatedSettings });
    try {
        await saveSettings(updatedSettings);
        showToast(next ? 'Auto-save enabled' : 'Auto-save paused');
    } catch (error) {
        reportError('toggleAutoSave', error, true, 'Unable to update auto-save');
        patchState({
            settings: {
                ...updatedSettings,
                autoSave: current
            }
        });
    }
}

function handleGlobalShortcuts(event) {
    if (event.ctrlKey && event.key === 'f') {
        event.preventDefault();
        domRefs.searchInput?.focus();
        return;
    }
    if (event.key === 'Escape' && document.activeElement === domRefs.searchInput) {
        event.preventDefault();
        updateSearchInput('');
        patchState({ searchQuery: '' });
        return;
    }
    if (event.ctrlKey && ['1', '2', '3', '4'].includes(event.key)) {
        event.preventDefault();
        const tabMap = [TABS.HISTORY, TABS.PINNED, TABS.SNIPPETS, TABS.TOP];
        const targetTab = tabMap[event.key - 1];
        patchState({ activeTab: targetTab });
        if (targetTab === TABS.TOP) {
            refreshTopItems(true);
        }
    }
}

async function copyItem(id, type = TABS.HISTORY) {
    const item = findItemById(id, type);
    if (!item) return;
    const normalizedText = (item.text || '').trim();
    const now = Date.now();
    if (normalizedText && normalizedText === lastCopiedSnapshot.text && now - lastCopiedSnapshot.at < 1500) {
        showToast('Already copied');
        return;
    }
    try {
        await navigator.clipboard.writeText(item.text);
        showToast('Copied to clipboard');
        recordUsage({ source: type, charCount: item.text.length });
        const nextCount = (item.timesCopied || 0) + 1;
        updateState((prev) => {
            const updateList = (list = []) => list.map((x) => (x.id === id ? { ...x, timesCopied: nextCount } : x));
            return {
                history: { ...prev.history, items: type === TABS.HISTORY ? updateList(prev.history.items) : prev.history.items },
                pinned: type === TABS.PINNED ? updateList(prev.pinned) : prev.pinned
            };
        });
        await updateClipboardItem(id, { timesCopied: nextCount }, type);
        refreshTopItems(true);
        lastCopiedSnapshot = { text: normalizedText, at: now };
    } catch (error) {
        reportError('copyItem', error, true, 'Unable to copy');
    }
}

async function copySnippet(id) {
    const snippet = getState().snippets.find((item) => item.id === id);
    if (!snippet) return;
    try {
        await navigator.clipboard.writeText(snippet.text);
        showToast('Snippet copied');
        recordUsage({ source: 'snippet', charCount: snippet.text.length });
    } catch (error) {
        reportError('copySnippet', error, true, 'Unable to copy snippet');
    }
}

async function pinItem(id) {
    try {
        const response = await requestPin(id);
        if (response?.limitReached) {
            showError('Pin limit reached. Upgrade for more pins.');
            return;
        }
        await refreshPinned();
        showToast('Pinned item');
        refreshTopItems(true);
    } catch (error) {
        reportError('pinItem', error, true, 'Unable to pin item');
    }
}

function findPinnedMatch(id, text = '') {
    const normalized = (text || '').trim();
    const state = getState();
    return state.pinned.find(
        (item) => item.id === id || (normalized && (item.text || '').trim() === normalized)
    );
}

async function unpinItem(id) {
    try {
        const item = findItemById(id, TABS.HISTORY);
        const pinnedMatch = findPinnedMatch(id, item?.text);
        const targetId = pinnedMatch?.id || id;
        const targetText = pinnedMatch?.text || item?.text || '';
        const response = await requestUnpin(targetId, targetText);
        if (response?.success || response === true) {
            updateState((prev) => ({
                pinned: prev.pinned.filter((p) => p.id !== targetId && (targetText ? (p.text || '').trim() !== (targetText || '').trim() : true))
            }));
            showToast('Unpinned');
            refreshTopItems(true);
        }
    } catch (error) {
        reportError('unpinItem', error, true, 'Unable to unpin');
    }
}

async function deleteItem(id, type = TABS.HISTORY) {
    try {
        const response = await requestDelete(id, type);
        if (response?.success || response === true) {
            updateState((prev) => {
                if (type === TABS.HISTORY) {
                    return {
                        history: {
                            ...prev.history,
                            items: prev.history.items.filter((item) => item.id !== id),
                            total: Math.max(prev.history.total - 1, 0)
                        }
                    };
                }
                if (type === TABS.PINNED) {
                    return { pinned: prev.pinned.filter((item) => item.id !== id) };
                }
                return prev;
            });
            showToast('Item deleted');
            refreshTopItems(true);
        } else {
            showError('Failed to delete item');
        }
    } catch (error) {
        reportError('deleteItem', error, true, 'Failed to delete');
    }
}

async function clearHistory() {
    const state = getState();
    if (!state.limits?.isPro) {
        showError('Clearing history is available on the Pro tier.');
        return;
    }
    const totalItems = state.history.total || state.history.items.length;
    if (totalItems === 0) {
        showToast('History is already empty');
        return;
    }
    if (!confirm('Clear all clipboard history items? Pinned entries stay untouched. This action cannot be undone.')) {
        return;
    }
    try {
        const response = await clearHistoryItems();
        if (response?.success || response === true) {
            const nextHistory = {
                ...state.history,
                items: [],
                total: 0,
                hasMore: false,
                isPageLoading: false
            };
            patchState({ history: nextHistory });
            showToast('History cleared');
            refreshTopItems(true);
        } else {
            showError('Unable to clear history');
        }
    } catch (error) {
        reportError('clearHistory', error, true, 'Unable to clear history');
    }
}

function applyEmojiSelection(value = '') {
    if (!domRefs?.editClipboardEmoji) return;
    domRefs.editClipboardEmoji.value = value;
    domRefs.editClipboardEmoji.focus();
    hideEmojiPopover();
}

function openClipboardEditor(id, type = TABS.HISTORY) {
    const item = findItemById(id, type);
    if (!item) {
        showError('Item not found');
        return;
    }
    hideEmojiPopover();
    openClipboardEditModal(item, type);
}

function closeClipboardEditor() {
    closeClipboardEditModal();
    hideEmojiPopover();
}

async function saveClipboardEdits() {
    const id = domRefs.editClipboardId?.value;
    const type = domRefs.editClipboardType?.value || TABS.HISTORY;
    const text = domRefs.editClipboardText?.value.trim();
    const emoji = domRefs.editClipboardEmoji?.value?.trim() || '';
    const language = domRefs.editClipboardLanguage?.value?.trim() || '';
    if (!id) {
        showError('Unable to determine item');
        return;
    }
    if (!text) {
        showError('Text cannot be empty');
        return;
    }
    try {
        const response = await updateClipboardItem(
            id,
            { text, emoji, language, title: '' },
            type
        );
        if (response?.success && response.item) {
            updateState((prev) => {
                const updated = response.item;
                const prevText = findItemById(id, type)?.text || '';
                const replaceItem = (list = []) =>
                    list.map((item) => {
                        const matchesId = item.id === id;
                        const matchesText = prevText && item.text === prevText;
                        return matchesId || matchesText ? updated : item;
                    });
                return {
                    history: {
                        ...prev.history,
                        items: replaceItem(prev.history.items)
                    },
                    pinned: replaceItem(prev.pinned)
                };
            });
            showToast('Item updated');
            closeClipboardEditModal();
        } else {
            showError('Unable to update item');
        }
    } catch (error) {
        reportError('saveClipboardEdits', error, true, 'Unable to update item');
    }
}

function findItemById(id, type = TABS.HISTORY) {
    if (type === TABS.PINNED) {
        return getState().pinned.find((item) => item.id === id);
    }
    const state = getState();
    return state.history.items.find((item) => item.id === id) ||
        (Array.isArray(state.top) ? state.top.find((item) => item.id === id) : undefined);
}

async function refreshPinned() {
    try {
        const response = await fetchPinnedItems();
        patchState({ pinned: response?.items || [] });
    } catch (error) {
        reportError('refreshPinned', error);
    }
}

async function refreshHistoryList() {
    try {
        const response = await fetchHistory(0);
        const items = response?.items || [];
        patchState({
            history: {
                items: dedupeById(items),
                page: 0,
                hasMore: Boolean(response?.hasMore),
                total: response?.total ?? items.length,
                isPageLoading: false
            }
        });
    } catch (error) {
        reportError('refreshHistoryList', error);
    }
}

async function loadMoreHistory() {
    const { history } = getState();
    if (!history.hasMore || history.isPageLoading) return;
    patchState({
        history: {
            ...history,
            isPageLoading: true
        }
    });
    try {
        const nextPage = history.page + 1;
        const response = await fetchHistory(nextPage);
        const items = response?.items || [];
        patchState({
            history: {
                items: dedupeById([...history.items, ...items]),
                page: nextPage,
                hasMore: Boolean(response?.hasMore),
                total: response?.total ?? history.total,
                isPageLoading: false
            }
        });
    } catch (error) {
        reportError('loadMoreHistory', error, true, 'Unable to load more items');
        patchState({
            history: {
                ...history,
                isPageLoading: false
            }
        });
    }
}

async function refreshTopItems(silent = false) {
    try {
        const response = await fetchTopHistory(10);
        if (response?.items) {
            patchState({ top: response.items });
        }
    } catch (error) {
        if (!silent) {
            reportError('refreshTopItems', error);
        }
    }
}

function toggleEmojiPopover() {
    if (!domRefs?.emojiSuggestions) return;
    const isNowVisible = !domRefs.emojiSuggestions.classList.contains('is-visible');
    if (isNowVisible) {
        domRefs.emojiSuggestions.classList.add('is-visible');
        domRefs.emojiSuggestions.setAttribute('aria-hidden', 'false');
        domRefs.toggleEmojiPopoverBtn?.setAttribute('aria-expanded', 'true');
        positionEmojiPopover();
    } else {
        hideEmojiPopover();
    }
}

function hideEmojiPopover() {
    if (!domRefs?.emojiSuggestions) return;
    domRefs.emojiSuggestions.classList.remove('is-visible');
    domRefs.emojiSuggestions.setAttribute('aria-hidden', 'true');
    domRefs.toggleEmojiPopoverBtn?.setAttribute('aria-expanded', 'false');
    domRefs.emojiSuggestions.style.left = '';
    domRefs.emojiSuggestions.style.top = '';
}

function positionEmojiPopover() {
    if (!domRefs?.emojiSuggestions || !domRefs.toggleEmojiPopoverBtn) return;
    const pop = domRefs.emojiSuggestions;
    const btn = domRefs.toggleEmojiPopoverBtn;
    const container = pop.parentElement || btn.parentElement;
    const btnRect = btn.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();
    if (!btnRect || !containerRect) return;

    const popWidth = pop.offsetWidth || 200;
    const margin = 4;
    const maxLeft = Math.max(0, containerRect.width - popWidth - margin);

    const relativeLeft = btnRect.right - containerRect.left - popWidth + btnRect.width;
    const clampedLeft = Math.max(0, Math.min(relativeLeft, maxLeft));
    const top = btnRect.bottom - containerRect.top + 6;

    pop.style.left = `${clampedLeft}px`;
    pop.style.top = `${top}px`;
}

function openSnippetEditor(id) {
    const snippet = getState().snippets.find((item) => item.id === id);
    openSnippetModal(snippet);
}

async function deleteSnippet(id) {
    const confirmed = window.confirm('Delete this snippet?');
    if (!confirmed) return;
    const nextSnippets = getState().snippets.filter((item) => item.id !== id);
    try {
        const normalizedList = nextSnippets.map(normalizeSnippet).filter(Boolean);
        const response = await saveSnippets(normalizedList);
        if (response?.success || response === true) {
            patchState({ snippets: normalizedList });
            showToast('Snippet deleted');
        } else {
            showError('Failed to delete snippet');
        }
    } catch (error) {
        reportError('deleteSnippet', error, true, 'Failed to delete snippet');
    }
}

async function saveSnippetFromModal() {
    const id = domRefs.editSnippetId.value || `snippet-${Date.now()}`;
    const rawInput = domRefs.editSnippetKeyword.value.trim();
    const keyword = rawInput.replace(/^:/, '');
    const text = domRefs.editSnippetText.value.trim();
    if (!keyword || !text) {
        showError('Keyword and text are required');
        return;
    }
    const shortcut = rawInput || `:${keyword}`;
    const existing = getState().snippets.slice();
    const index = existing.findIndex((item) => item.id === id);
    const { limits } = getState();
    const isPro = Boolean(limits?.isPro);
    const maxSnippets = limits?.maxSnippets || (isPro ? Number.MAX_SAFE_INTEGER : 10);
    const isEditing = index >= 0;
    if (!isEditing && !isPro && existing.length >= maxSnippets) {
        showError(`Free plan allows up to ${maxSnippets} snippets`);
        return;
    }
    if (index >= 0) {
        existing[index] = { ...existing[index], keyword, shortcut, text };
    } else {
        existing.unshift({ id, keyword, shortcut, text });
    }
    const normalizedList = existing.map(normalizeSnippet).filter(Boolean);
    try {
        const response = await saveSnippets(normalizedList);
        if (response?.success || response === true) {
            patchState({ snippets: normalizedList });
            closeSnippetModal();
            showToast('Snippet saved');
            if (!isEditing) {
                recordUsage({ event: 'snippet_created' });
            }
        } else {
            showError('Unable to save snippet');
        }
    } catch (error) {
        reportError('saveSnippet', error, true, 'Unable to save snippet');
    }
}

async function loadUIPreferences() {
    try {
        const stored = await chrome.storage.local.get([UI_PREFERENCES_KEY]);
        const prefs = stored[UI_PREFERENCES_KEY];
        if (prefs && typeof prefs === 'object') {
            uiPreferences = { ...uiPreferences, ...prefs };
        }
    } catch (error) {
        console.warn('Unable to load UI preferences', error);
    } finally {
        syncUIStateWithPreferences();
    }
}

async function saveUIPreferences() {
    try {
        await chrome.storage.local.set({ [UI_PREFERENCES_KEY]: uiPreferences });
    } catch (error) {
        console.warn('Unable to save UI preferences', error);
    }
}

function applyUIPreferences() {
    document.body.classList.add('compact-mode');
    if (domRefs?.usageSummary) {
        domRefs.usageSummary.classList.toggle('collapsed', uiPreferences.infoCollapsed);
    }
}

function syncUIStateWithPreferences() {
    const currentState = getState();
    const currentUI = currentState.ui || {};
    const nextUI = {
        ...currentUI,
        infoCollapsed: uiPreferences.infoCollapsed,
        bannerDismissed: uiPreferences.bannerDismissed
    };
    patchState({ ui: nextUI });
}

async function toggleInfoPanel() {
    uiPreferences.infoCollapsed = !uiPreferences.infoCollapsed;
    syncUIStateWithPreferences();
    applyUIPreferences();
    await saveUIPreferences();
}

async function dismissBanner() {
    if (uiPreferences.bannerDismissed) return;
    uiPreferences.bannerDismissed = true;
    syncUIStateWithPreferences();
    applyUIPreferences();
    await saveUIPreferences();
}

function dedupeById(items) {
    const map = new Map();
    items.forEach((item) => {
        if (item?.id) {
            map.set(item.id, item);
        }
    });
    return Array.from(map.values());
}

function normalizeSnippet(snippet) {
    if (!snippet) return null;
    const rawInput = (snippet.shortcut || snippet.keyword || '').trim();
    if (!rawInput) return null;
    const keyword = rawInput.replace(/^:/, '');
    const shortcut = rawInput;
    return {
        id: snippet.id || generateSnippetId('snippet'),
        keyword,
        shortcut,
        text: snippet.text || ''
    };
}
