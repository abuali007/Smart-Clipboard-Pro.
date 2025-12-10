import { ACTIONS, PAGINATION } from './constants.js';
import { reportError } from './error-reporter.js';

export function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    const msg = chrome.runtime.lastError.message || '';
                    const isPortClosed = msg.includes('The message port closed') || msg.includes('Receiving end does not exist');
                    if (isPortClosed) {
                        resolve(null);
                        return;
                    }
                    reject(new Error(msg));
                } else {
                    resolve(response);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

async function safeFetch(fetcher, fallback) {
    try {
        const result = await fetcher();
        return result ?? fallback;
    } catch (error) {
        reportError('bootstrapData', error);
        return fallback;
    }
}

export async function fetchHistory(page = 0, pageSize = PAGINATION.PAGE_SIZE) {
    return sendRuntimeMessage({
        action: ACTIONS.GET_HISTORY,
        page,
        pageSize
    });
}

export async function fetchTopHistory(limit = 10) {
    try {
        return await sendRuntimeMessage({
            action: ACTIONS.GET_TOP_HISTORY,
            limit
        });
    } catch (error) {
        reportError('fetchTopHistory', error);
        return { items: [] };
    }
}

export async function fetchPinnedItems() {
    return sendRuntimeMessage({ action: ACTIONS.GET_PINNED });
}

export async function fetchSnippets() {
    const response = await sendRuntimeMessage({ action: ACTIONS.GET_SNIPPETS });
    if (response && !response.items && Array.isArray(response.snippets)) {
        return { items: response.snippets };
    }
    return response;
}

export async function fetchLimits() {
    return sendRuntimeMessage({ action: ACTIONS.GET_LIMITS });
}

export async function fetchSettings() {
    return sendRuntimeMessage({ action: ACTIONS.GET_SETTINGS });
}

export async function saveSettings(settings) {
    return sendRuntimeMessage({
        action: ACTIONS.SAVE_SETTINGS,
        settings
    });
}

export async function fetchAnalytics() {
    return sendRuntimeMessage({ action: ACTIONS.GET_ANALYTICS });
}

export async function saveSnippets(snippets) {
    return sendRuntimeMessage({
        action: ACTIONS.SAVE_SNIPPETS,
        snippets
    });
}

export async function saveToHistory(text) {
    return sendRuntimeMessage({
        action: ACTIONS.SAVE_TO_HISTORY,
        text
    });
}

export async function clearHistoryItems() {
    return sendRuntimeMessage({
        action: ACTIONS.CLEAR_HISTORY
    });
}

export async function requestPin(itemId) {
    return sendRuntimeMessage({
        action: ACTIONS.PIN_ITEM,
        itemId
    });
}

export async function requestUnpin(itemId, text = '') {
    return sendRuntimeMessage({
        action: ACTIONS.UNPIN_ITEM,
        itemId,
        text
    });
}

export async function requestDelete(itemId, type) {
    return sendRuntimeMessage({
        action: ACTIONS.DELETE_ITEM,
        itemId,
        type
    });
}

export async function updateClipboardItem(itemId, payload, type = 'history') {
    return sendRuntimeMessage({
        action: ACTIONS.UPDATE_ITEM,
        itemId,
        type,
        payload
    });
}

export async function recordUsage(payload) {
    return sendRuntimeMessage({
        action: ACTIONS.RECORD_USAGE,
        payload
    }).catch((error) => {
        reportError('recordUsage', error);
        return { success: false };
    });
}

export async function bootstrapData() {
    const [history, pinned, snippets, top, limits, settings, analytics] = await Promise.all([
        safeFetch(() => fetchHistory(0, PAGINATION.PAGE_SIZE), { items: [], hasMore: false, total: 0 }),
        safeFetch(() => fetchPinnedItems(), { items: [] }),
        safeFetch(() => fetchSnippets(), { items: [] }),
        safeFetch(() => fetchTopHistory(10), { items: [] }),
        safeFetch(() => fetchLimits(), {}),
        safeFetch(() => fetchSettings(), {}),
        safeFetch(() => fetchAnalytics(), {})
    ]);
    return { history, pinned, snippets, top, limits, settings, analytics };
}
