import { TABS } from './constants.js';

const initialState = {
    activeTab: TABS.HISTORY,
    searchQuery: '',
    isLoading: false,
    history: {
        items: [],
        page: 0,
        hasMore: true,
        total: 0,
        isPageLoading: false
    },
    top: [],
    pinned: [],
    snippets: [],
    limits: {
        maxHistory: 0,
        maxPinned: 0,
        maxSnippets: 0,
        freeHistoryLimit: 0,
        freePinnedLimit: 0,
        freeSnippetsLimit: 0,
        isPro: false,
        planLabel: '',
        activatedAt: null,
        expiresAt: null,
        nextChargeAt: null,
        subscriptionCancelled: false,
        status: null
    },
    settings: {
        theme: 'light',
        autoSave: true
    },
    metrics: {
        timeSavedMinutes: 0,
        charactersPasted: 0
    },
    ui: {
        infoCollapsed: true,
        bannerDismissed: false
    }
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const state = clone(initialState);
const subscribers = new Set();

export function getState() {
    return state;
}

export function resetState() {
    Object.keys(initialState).forEach((key) => {
        state[key] = clone(initialState[key]);
    });
    notifySubscribers();
}

export function patchState(partial) {
    let hasChanges = false;
    Object.entries(partial).forEach(([key, value]) => {
        if (!Object.is(state[key], value)) {
            state[key] = value;
            hasChanges = true;
        }
    });
    if (hasChanges) {
        notifySubscribers();
    }
}

export function updateState(updater) {
    const next = typeof updater === 'function' ? updater(clone(state)) : updater;
    if (next && typeof next === 'object') {
        patchState(next);
    }
}

export function setLoading(isLoading) {
    if (state.isLoading !== isLoading) {
        state.isLoading = isLoading;
        notifySubscribers();
    }
}

export function subscribe(callback) {
    if (typeof callback !== 'function') return () => {};
    subscribers.add(callback);
    callback(state);
    return () => subscribers.delete(callback);
}

function notifySubscribers() {
    subscribers.forEach((callback) => {
        try {
            callback(state);
        } catch (error) {
            console.error('State subscriber error:', error);
        }
    });
}
