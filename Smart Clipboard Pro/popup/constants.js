export const TABS = {
    HISTORY: 'history',
    PINNED: 'pinned',
    SNIPPETS: 'snippets',
    TOP: 'top'
};

export const ACTIONS = {
    GET_HISTORY: 'getClipboardHistory',
    GET_TOP_HISTORY: 'getTopHistory',
    GET_PINNED: 'getPinnedItems',
    GET_SNIPPETS: 'getSnippets',
    SAVE_SNIPPETS: 'saveSnippets',
    SAVE_TO_HISTORY: 'saveToHistory',
    CLEAR_HISTORY: 'clearClipboardHistory',
    PIN_ITEM: 'pinItem',
    UNPIN_ITEM: 'unpinItem',
    DELETE_ITEM: 'deleteItem',
    UPDATE_ITEM: 'updateClipboardItem',
    GET_SETTINGS: 'getSettings',
    SAVE_SETTINGS: 'saveSettings',
    GET_LIMITS: 'getLimits',
    GET_ANALYTICS: 'getAnalytics',
    RECORD_USAGE: 'recordUsage'
};

export const PAGINATION = {
    PAGE_SIZE: 100
};

export const ANALYTICS = {
    AVERAGE_CHARS_PER_MINUTE: 900 // ~45 WPM average typing speed
};

export const TOAST = {
    DEFAULT_DURATION: 3000
};
