import { filterAndRank } from './search.js';
import { TABS, PAGINATION } from './constants.js';
import translations from './translations/index.js';

const dom = {};
let openModalCount = 0;
const INFINITY_SYMBOL = '\u221E';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const VIRTUAL_SCROLL_THRESHOLD = 9999;
const DEFAULT_VIRTUAL_ITEM_HEIGHT = 92;
let historyVirtualList = null;
const ACTION_ICON_MAP = {
    copy: '&#x1F4CB;', // clipboard
    pin: '&#x1F4CC;', // pushpin
    unpin: '&#x274C;', // cross mark
    delete: '&#x1F5D1;', // trash bin
    'copy-snippet': '&#x1F4CB;',
    'edit-snippet': '&#x270E;', // pencil
    'delete-snippet': '&#x1F5D1;',
    'edit-item': '&#x270E;'
};
let currentStrings = translations.en;

function htmlToFragment(html = '') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const container = doc.body.firstChild;
    const fragment = document.createDocumentFragment();
    while (container && container.firstChild) {
        fragment.appendChild(container.firstChild);
    }
    return fragment;
}

function replaceContent(target, html = '') {
    if (!target) return;
    if (!html) {
        target.replaceChildren();
        return;
    }
    target.replaceChildren(htmlToFragment(html));
}

function appendHTML(target, html = '') {
    if (!target || !html) return;
    target.appendChild(htmlToFragment(html));
}

const ALLOWED_INLINE_TAGS = new Set(['STRONG', 'EM', 'B', 'I', 'BR']);
function sanitizeInlineHtml(html = '', allowedTags = ALLOWED_INLINE_TAGS) {
    if (!html || typeof html !== 'string') return '';
    const template = document.createElement('template');
    template.innerHTML = html;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT);
    const nodesToStrip = [];
    while (walker.nextNode()) {
        const el = walker.currentNode;
        if (!allowedTags.has(el.tagName)) {
            nodesToStrip.push(el);
            continue;
        }
        [...el.attributes].forEach((attr) => {
            const name = attr.name.toLowerCase();
            if (name === 'style' || name.startsWith('on')) {
                el.removeAttribute(attr.name);
            }
        });
    }
    nodesToStrip.forEach((node) => node.replaceWith(...node.childNodes));
    return template.innerHTML;
}

export function initUI() {
    dom.historyTab = document.getElementById('historyTab');
    dom.historyList = document.getElementById('historyList');
    dom.historyEmpty = document.getElementById('historyEmpty');
    dom.historyCounter = document.getElementById('historyTabCounter');
    dom.usageSummary = document.getElementById('usageSummary');

    dom.pinnedTab = document.getElementById('pinnedTab');
    dom.pinnedList = document.getElementById('pinnedList');
    dom.pinnedEmpty = document.getElementById('pinnedEmpty');
    dom.pinnedCounter = document.getElementById('pinnedTabCounter');

    dom.topTab = document.getElementById('topTab');
    dom.topList = document.getElementById('topList');
    dom.topEmpty = document.getElementById('topEmpty');
    dom.topCounter = document.getElementById('topTabCounter');

    dom.snippetsTab = document.getElementById('snippetsTab');
    dom.snippetsList = document.getElementById('snippetsList');
    dom.snippetsEmpty = document.getElementById('snippetsEmpty');
    dom.snippetsCounter = document.getElementById('snippetsTabCounter');

    dom.searchInput = document.getElementById('searchInput');
    dom.loadingIndicator = document.getElementById('loadingIndicator');
    dom.themeToggle = document.getElementById('themeToggle');
    dom.themeToggleIcon = dom.themeToggle ? dom.themeToggle.querySelector('.theme-icon') : null;
    dom.themeToggleLabel = dom.themeToggle ? dom.themeToggle.querySelector('.sr-only') : null;
    dom.settingsBtn = document.getElementById('settingsBtn');
    dom.upgradeBtn = document.getElementById('upgradeBtn');
    dom.autoSaveToggle = document.getElementById('autoSaveToggle');
    dom.autoSaveToggleIcon = dom.autoSaveToggle ? dom.autoSaveToggle.querySelector('.auto-toggle-icon') : null;
    dom.autoSaveToggleLabel = dom.autoSaveToggle ? dom.autoSaveToggle.querySelector('.auto-toggle-label') : null;
    dom.addSnippetBtns = [
        document.getElementById('addSnippetBtn'),
        document.getElementById('addSnippetBtn_empty')
    ].filter(Boolean);

    dom.toastContainer = document.getElementById('toastContainer');
    dom.freeUserBanner = document.getElementById('freeUserBanner');
    dom.bannerUpgradeBtn = document.getElementById('bannerUpgradeBtn');
    dom.bannerDismissBtn = document.getElementById('bannerDismissBtn');

    // Snippet modal
    dom.snippetEditModal = document.getElementById('snippetEditModal');
    dom.editSnippetId = document.getElementById('editSnippetId');
    dom.editSnippetKeyword = document.getElementById('editSnippetKeyword');
    dom.editSnippetText = document.getElementById('editSnippetText');
    dom.saveSnippetChangesBtn = document.getElementById('saveSnippetChangesBtn');
    dom.modalCloseBtn = dom.snippetEditModal?.querySelector('.close-btn');

    dom.clipboardEditModal = document.getElementById('clipboardEditModal');
    dom.editClipboardId = document.getElementById('editClipboardId');
    dom.editClipboardType = document.getElementById('editClipboardType');
    dom.editClipboardEmoji = document.getElementById('editClipboardEmoji');
    dom.editClipboardLanguage = document.getElementById('editClipboardLanguage');
    dom.editClipboardText = document.getElementById('editClipboardText');
    dom.editClipboardCharCount = document.getElementById('editClipboardCharCount');
    dom.editClipboardMeta = document.getElementById('editClipboardMeta');
    dom.saveClipboardChangesBtn = document.getElementById('saveClipboardChangesBtn');
    dom.cancelClipboardEditBtn = document.getElementById('cancelClipboardEditBtn');
    dom.closeClipboardEditModal = document.getElementById('closeClipboardEditModal');
    dom.emojiSuggestions = document.getElementById('emojiSuggestions');
    dom.clearEmojiBtn = document.getElementById('clearEmojiBtn');
    dom.emojiPicker = document.getElementById('emojiPicker');
    dom.toggleEmojiPopoverBtn = document.getElementById('toggleEmojiPopover');

    return dom;
}

export function getDomRefs() {
    return dom;
}

function detectDefaultLanguage() {
    try {
        const raw = navigator?.language || 'en';
        const normalized = raw.toLowerCase();
        if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant')) return 'zh-TW';
        if (normalized.startsWith('zh')) return 'zh-CN';
        const short = normalized.split('-')[0];
        return ['ar', 'hi', 'pt', 'es', 'ru', 'ja', 'de', 'fr', 'id'].includes(short) ? short : 'en';
    } catch (error) {
        return 'en';
    }
}

export function applyLanguage(langSetting = 'auto') {
    const lang = !langSetting || langSetting === 'auto' ? detectDefaultLanguage() : langSetting;
    currentStrings = translations[lang] || translations.en;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.body.classList.toggle('rtl', lang === 'ar');

    const setText = (selector, text) => {
        const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (el && typeof text === 'string') el.textContent = text;
    };
    setText('.logo-title', currentStrings.appTitle);
    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
        upgradeBtn.title = currentStrings.upgradeTitle;
        const sr = upgradeBtn.querySelector('.sr-only');
        if (sr) sr.textContent = currentStrings.upgradeSr;
        const badge = upgradeBtn.querySelector('.header-chip');
        if (badge) badge.textContent = currentStrings.proBadge;
    }
    const autoBtn = document.getElementById('autoSaveToggle');
    if (autoBtn) {
        const isEnabled = !autoBtn.classList.contains('is-paused');
        const labelText = isEnabled
            ? currentStrings.autoLabelOn || currentStrings.auto
            : currentStrings.autoLabelOff || currentStrings.auto;
        const actionLabel = isEnabled
            ? currentStrings.autoActionPause || currentStrings.autoSr
            : currentStrings.autoActionResume || currentStrings.autoSr;
        autoBtn.title = actionLabel || currentStrings.autoSr;
        autoBtn.setAttribute('aria-label', actionLabel || currentStrings.autoSr);
        setText(autoBtn.querySelector('.auto-toggle-label'), labelText);
        const sr = autoBtn.querySelector('.sr-only');
        if (sr) sr.textContent = actionLabel || currentStrings.autoSr;
    }
    const addSnippetBtn = document.getElementById('addSnippetBtn');
    if (addSnippetBtn) addSnippetBtn.title = currentStrings.addSnippet;
    setText('#settingsBtn .sr-only', currentStrings.settings);
    setText('#themeToggle .sr-only', currentStrings.themeToggle);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.placeholder = currentStrings.searchPlaceholder;

    const banner = document.getElementById('freeUserBanner');
    if (banner) {
        const text = banner.querySelector('.banner-text');
        if (text) {
            const safeBannerHtml = sanitizeInlineHtml(currentStrings.bannerText);
            text.innerHTML = safeBannerHtml;
        }
        setText('#bannerUpgradeBtn', currentStrings.bannerUpgrade);
        const dismiss = document.getElementById('bannerDismissBtn');
        if (dismiss) dismiss.title = currentStrings.bannerDismiss;
    }

    const tabButtons = document.querySelectorAll('.tabs .tab-btn');
    const labels = [
        currentStrings.tabs.history,
        currentStrings.tabs.pinned,
        currentStrings.tabs.snippets,
        currentStrings.tabs.top
    ];
    tabButtons.forEach((btn, idx) => {
        const lbl = btn.querySelector('.tab-label');
        if (lbl && labels[idx]) lbl.textContent = labels[idx];
    });

    setText('#topTab .section-title', currentStrings.sections.topTitle);
    setText('#topTab .section-subtitle', currentStrings.sections.topSubtitle);

    setText('#historyEmpty .empty-title', currentStrings.emptyStates.historyTitle);
    setText('#historyEmpty .empty-subtitle', currentStrings.emptyStates.historySubtitle);
    setText('#pinnedEmpty .empty-title', currentStrings.emptyStates.pinnedTitle);
    setText('#pinnedEmpty .empty-subtitle', currentStrings.emptyStates.pinnedSubtitle);
    setText('#snippetsEmpty .empty-state-title', currentStrings.emptyStates.snippetsTitle);
    setText('#snippetsEmpty .empty-state-description', currentStrings.emptyStates.snippetsSubtitle);
    setText('#addSnippetBtn_empty', currentStrings.emptyStates.snippetsCta);
    setText('#topEmpty .empty-title', currentStrings.emptyStates.topTitle);
    setText('#topEmpty .empty-subtitle', currentStrings.emptyStates.topSubtitle);

    // Modals
    setText('#snippetEditModal h2', currentStrings.snippetModal.title);
    setText('label[for=\"editSnippetKeyword\"]', currentStrings.snippetModal.keyword);
    const keywordInput = document.getElementById('editSnippetKeyword');
    if (keywordInput) keywordInput.placeholder = currentStrings.snippetModal.keywordPh;
    setText('label[for=\"editSnippetText\"]', currentStrings.snippetModal.text);
    const snippetText = document.getElementById('editSnippetText');
    if (snippetText) snippetText.placeholder = currentStrings.snippetModal.textPh;
    setText('#saveSnippetChangesBtn', currentStrings.snippetModal.save);

    setText('#clipboardEditModal h2', currentStrings.clipModal.title);
    setText('label[for=\"editClipboardEmoji\"]', currentStrings.clipModal.emoji);
    const emojiInput = document.getElementById('editClipboardEmoji');
    if (emojiInput) emojiInput.placeholder = currentStrings.clipModal.emojiPh;
    const pickBtn = document.getElementById('toggleEmojiPopover');
    if (pickBtn) pickBtn.textContent = `🙂 ${currentStrings.clipModal.emojiPick}`;
    const clearBtn = document.getElementById('clearEmojiBtn');
    if (clearBtn) {
        clearBtn.textContent = `× ${currentStrings.clipModal.emojiClear}`;
        clearBtn.title = currentStrings.clipModal.emojiClearTitle;
    }
    setText('label[for=\"editClipboardLanguage\"]', currentStrings.clipModal.languageLabel || currentStrings.clipModal.language);
    const languageInput = document.getElementById('editClipboardLanguage');
    if (languageInput && currentStrings.clipModal.languagePh) {
        languageInput.placeholder = currentStrings.clipModal.languagePh;
    }
    const languageHint = document.getElementById('languageFieldHint');
    if (languageHint && currentStrings.clipModal.languageHint) {
        languageHint.textContent = currentStrings.clipModal.languageHint;
    }
    setText('label[for=\"editClipboardText\"]', currentStrings.clipModal.text);
    const contentHint = document.getElementById('clipboardContentHint');
    if (contentHint && currentStrings.clipModal.contentHint) {
        contentHint.textContent = currentStrings.clipModal.contentHint;
    }
    const clipboardText = document.getElementById('editClipboardText');
    if (clipboardText && currentStrings.clipModal.textPh) {
        clipboardText.placeholder = currentStrings.clipModal.textPh;
    }
    setText('#saveClipboardChangesBtn', currentStrings.clipModal.save || currentStrings.snippetModal.save);
    setText('#cancelClipboardEditBtn', currentStrings.clipModal.cancel || 'Cancel');
}

export function getStrings() {
    return currentStrings;
}

export function render(state) {
    updateActiveTab(state.activeTab);
    renderHistory(state);
    renderPinned(state);
    renderTop(state);
    renderSnippets(state);
    updateFreeBanner(state);
    updateTabCounters(state);
    updateUsageSummary(state);
    toggleLoading(state.isLoading || state.history.isPageLoading);
    updateThemeIcon(state.settings.theme);
    updateAutoSaveToggle(state.settings.autoSave !== false);
}

export function toggleLoading(isLoading) {
    if (!dom.loadingIndicator) return;
    dom.loadingIndicator.style.display = isLoading ? 'flex' : 'none';
}

export function updateSearchInput(query) {
    if (dom.searchInput && dom.searchInput.value !== query) {
        dom.searchInput.value = query;
    }
}

export function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeIcon(theme);
}

export function updateThemeIcon(theme) {
    if (!dom.themeToggle) return;
    const isLight = theme !== 'dark';
    const symbol = isLight ? '\u263C' : '\u263E';
    if (dom.themeToggleIcon) {
        dom.themeToggleIcon.textContent = symbol;
    } else {
        dom.themeToggle.textContent = symbol;
    }
    const label = isLight ? currentStrings.themeLightLabel : currentStrings.themeDarkLabel;
    dom.themeToggle.title = label;
    dom.themeToggle.setAttribute('aria-label', label);
    if (dom.themeToggleLabel) {
        dom.themeToggleLabel.textContent = label;
    }
}

export function updateAutoSaveToggle(isEnabled) {
    if (!dom.autoSaveToggle) return;
    const enabled = isEnabled !== false;
    dom.autoSaveToggle.classList.toggle('active', enabled);
    dom.autoSaveToggle.classList.toggle('is-paused', !enabled);
    dom.autoSaveToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    const icon = enabled ? '\u23F5' : '\u23F8'; // play/pause icons
    const label = enabled
        ? currentStrings.autoLabelOn || currentStrings.auto || 'Auto'
        : currentStrings.autoLabelOff || currentStrings.autoToastOff || 'Paused';
    if (dom.autoSaveToggleIcon) {
        dom.autoSaveToggleIcon.textContent = icon;
    }
    if (dom.autoSaveToggleLabel) {
        dom.autoSaveToggleLabel.textContent = label;
    }
    const actionLabel = enabled
        ? currentStrings.autoActionPause || currentStrings.autoSr || 'Pause automatic saving'
        : currentStrings.autoActionResume || currentStrings.autoSr || 'Resume automatic saving';
    dom.autoSaveToggle.title = actionLabel;
    dom.autoSaveToggle.setAttribute('aria-label', actionLabel);
    const srLabel = dom.autoSaveToggle.querySelector('.sr-only');
    if (srLabel) {
        srLabel.textContent = actionLabel;
    }
}

export function openSnippetModal(snippet) {
    if (!dom.snippetEditModal) return;
    const wasHidden = dom.snippetEditModal.style.display === 'none' || !dom.snippetEditModal.style.display;
    dom.snippetEditModal.style.display = 'block';
    if (wasHidden) {
        lockBodyScroll();
    }
    dom.editSnippetId.value = snippet?.id || '';
    dom.editSnippetKeyword.value = snippet?.shortcut || snippet?.keyword || '';
    dom.editSnippetText.value = snippet?.text || '';
    dom.editSnippetKeyword?.focus();
}

export function closeSnippetModal() {
    if (!dom.snippetEditModal) return;
    const wasVisible = dom.snippetEditModal.style.display !== 'none' && dom.snippetEditModal.style.display !== '';
    dom.snippetEditModal.style.display = 'none';
    if (wasVisible) {
        unlockBodyScroll();
    }
    dom.editSnippetId.value = '';
    dom.editSnippetKeyword.value = '';
    dom.editSnippetText.value = '';
}

function updateActiveTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach((content) => {
        content.classList.toggle('active', content.id === `${tabName}Tab`);
    });
}

function renderHistory(state) {
    if (!dom.historyList) return;
    const filteredItems = filterAndRank(
        state.history.items.map((item) => ({ ...item, source: TABS.HISTORY })),
        state.searchQuery
    );

    const limitWarning = buildLimitWarning(state);
    const renderItem = (item) => htmlToFragment(createHistoryItem(item, state.pinned));
    const useVirtual = filteredItems.length >= VIRTUAL_SCROLL_THRESHOLD;
    const historyActions = createHistoryActions(state);
    const fragment = document.createDocumentFragment();

    if (filteredItems.length === 0) {
        dom.historyList.replaceChildren();
        dom.historyEmpty?.classList.remove('hidden');
        dom.historyList.classList.remove('is-virtualized');
        historyVirtualList?.destroy?.();
        historyVirtualList = null;
        return;
    }

    dom.historyEmpty?.classList.add('hidden');
    if (limitWarning) {
        fragment.appendChild(htmlToFragment(limitWarning));
    }

    if (useVirtual) {
        const existingContainer = dom.historyList.querySelector('.virtual-list-container') || document.createElement('div');
        existingContainer.className = 'virtual-list-container';
        fragment.appendChild(existingContainer);
        if (historyActions) {
            fragment.appendChild(historyActions);
        }
        dom.historyList.replaceChildren(fragment);
        dom.historyList.classList.add('is-virtualized');

        if (!historyVirtualList || historyVirtualList.container !== existingContainer) {
            historyVirtualList?.destroy?.();
            historyVirtualList = new VirtualList(
                existingContainer,
                filteredItems,
                renderItem,
                { itemHeight: DEFAULT_VIRTUAL_ITEM_HEIGHT }
            );
        } else {
            historyVirtualList.setItems(filteredItems);
        }
        return;
    }

    dom.historyList.classList.remove('is-virtualized');
    historyVirtualList?.destroy?.();
    historyVirtualList = null;

    filteredItems.forEach((item) => {
        fragment.appendChild(renderItem(item));
    });
    if (historyActions) {
        fragment.appendChild(historyActions);
    }
    dom.historyList.replaceChildren(fragment);
}

function renderTop(state) {
    if (!dom.topList) return;
    const query = (state.searchQuery || '').trim().toLowerCase();
    const filtered = (state.top || []).filter((item) => {
        if (!query) return true;
        const text = (item.text || '').toLowerCase();
        const title = (item.title || '').toLowerCase();
        return text.includes(query) || title.includes(query);
    });

    if (filtered.length === 0) {
        dom.topList.replaceChildren();
        dom.topEmpty?.classList.remove('hidden');
        return;
    }

    dom.topEmpty?.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    filtered.slice(0, 10).forEach((item, index) => {
        fragment.appendChild(htmlToFragment(createTopItem(item, index + 1)));
    });
    dom.topList.replaceChildren(fragment);
}

function createHistoryActions(state) {
    const { history } = state;
    const actions = [];
    const loadedCount = history.items.length;
    if (history.hasMore) {
        const totalItems = history.total || loadedCount;
        const isPageLoading = Boolean(history.isPageLoading);
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'loadMoreHistoryBtn';
        loadMoreBtn.type = 'button';
        loadMoreBtn.className = 'load-more-btn';
        const progressLabel =
            typeof currentStrings.loadMoreProgress === 'function'
                ? currentStrings.loadMoreProgress(Math.min(loadedCount, totalItems), totalItems)
                : `${Math.min(loadedCount, totalItems)}/${totalItems}`;
        loadMoreBtn.textContent = isPageLoading
            ? currentStrings.loadingMore || 'Loading more...'
            : `${currentStrings.loadMore || 'Load'} ${PAGINATION.PAGE_SIZE} ${currentStrings.moreItems || 'more'} (${progressLabel})`;
        loadMoreBtn.disabled = isPageLoading;
        loadMoreBtn.setAttribute('aria-busy', isPageLoading ? 'true' : 'false');
        actions.push(loadMoreBtn);
    }
    if (state.limits?.isPro && loadedCount > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'clear-history-btn';
        clearBtn.dataset.action = 'clear-history';
        clearBtn.textContent = currentStrings.clearHistoryBtn || 'Clear history';
        actions.push(clearBtn);
    }
    if (!actions.length) {
        return null;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'history-actions';
    actions.forEach((node) => wrapper.appendChild(node));
    return wrapper;
}

function renderPinned(state) {
    if (!dom.pinnedList) return;
    const filtered = filterAndRank(
        state.pinned.map((item) => ({ ...item, source: TABS.PINNED })),
        state.searchQuery
    );

    if (filtered.length === 0) {
        dom.pinnedList.replaceChildren();
        dom.pinnedEmpty?.classList.remove('hidden');
        return;
    }
    dom.pinnedEmpty?.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => {
        fragment.appendChild(htmlToFragment(createPinnedItem(item)));
    });
    dom.pinnedList.replaceChildren(fragment);
}

function renderSnippets(state) {
    if (!dom.snippetsList) return;
    const filtered = filterAndRank(
        state.snippets.map((item) => ({ ...item, source: TABS.SNIPPETS })),
        state.searchQuery
    );

    if (filtered.length === 0) {
        dom.snippetsList.replaceChildren();
        dom.snippetsEmpty?.classList.remove('hidden');
        return;
    }
    dom.snippetsEmpty?.classList.add('hidden');
    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => {
        fragment.appendChild(htmlToFragment(createSnippetItem(item)));
    });
    dom.snippetsList.replaceChildren(fragment);
}

function updateFreeBanner(state) {
    if (!dom.freeUserBanner) return;
    const isDismissed = state.ui?.bannerDismissed;
    const isCollapsed = state.ui?.infoCollapsed;
    if (state.limits.isPro || isDismissed || isCollapsed) {
        dom.freeUserBanner.style.display = 'none';
        return;
    }
    dom.freeUserBanner.style.display = 'flex';
    if (dom.bannerUpgradeBtn) {
        dom.bannerUpgradeBtn.dataset.action = 'open-upgrade';
    }
}

function buildLimitWarning(state) {
    if (!state.limits || state.limits.isPro) return '';
    const { maxHistory } = state.limits;
    if (!maxHistory) return '';
    const percent = (state.history.items.length / maxHistory) * 100;
    if (percent < 80) return '';
    return `
        <div class="limit-warning">
            ${currentStrings.limitWarning(state.history.items.length, maxHistory)}
            <button class="upgrade-inline-btn" data-action="open-upgrade">${currentStrings.limitUpgrade}</button>
        </div>
    `;
}

function updateUsageSummary(state) {
    if (!dom.usageSummary) return;
    const isPro = Boolean(state.limits.isPro);
    const isCollapsed = Boolean(state.ui?.infoCollapsed);
    const timeSavedMinutes = Number(state.metrics?.timeSavedMinutes || 0);
    const expiryTimestamp = Number(state.limits.expiresAt) || null;
    const nextChargeTimestamp = Number(state.limits.nextChargeAt) || null;
    const countdownTarget = expiryTimestamp || nextChargeTimestamp || null;
    const shortRemaining = countdownTarget ? formatRemainingShortLabel(countdownTarget) : '';
    const expiryCountdown = countdownTarget ? formatExpiryCountdownValue(countdownTarget) : '';
    const planDescription = isPro
        ? currentStrings.planProDesc
        : currentStrings.planFreeDesc;
    const planLabel = state.limits.planLabel || (isPro ? currentStrings.planProLabel : currentStrings.planFreeLabel);
    const activatedLabel = isPro && state.limits.activatedAt ? formatPlanExpiry(state.limits.activatedAt) : '';
    const futureEndLabel = (() => {
        if (!isPro) return '';
        if (expiryTimestamp) {
            const text = formatPlanExpiry(expiryTimestamp);
            if (!text) return '';
            return `${expiryTimestamp <= Date.now() ? currentStrings.planEnded : currentStrings.planEnds} ${text}`;
        }
        if (nextChargeTimestamp) {
            const text = formatPlanExpiry(nextChargeTimestamp);
            if (!text) return '';
            const cancelled = state.limits.subscriptionCancelled;
            return `${cancelled ? currentStrings.planEnds : currentStrings.planRenews} ${text}`;
        }
        return '';
    })();
    let planMeta = '';
    if (isPro && shortRemaining) {
        if (expiryTimestamp || state.limits.subscriptionCancelled) {
            planMeta = shortRemaining;
        } else {
            const trimmed = shortRemaining.replace(/\sleft$/, '');
            planMeta = `${currentStrings.planRenewsIn} ${trimmed}`;
        }
    }
    const planDescriptionTitle = futureEndLabel ? ` title="${futureEndLabel}"` : '';
    const timelineEntries = [];
    if (activatedLabel) {
        timelineEntries.push({ label: currentStrings.planStarted, value: activatedLabel });
    }
    if (expiryTimestamp) {
        const expiresLabel = expiryTimestamp <= Date.now() ? currentStrings.planEnded : currentStrings.planEnds;
        const formatted = formatPlanExpiry(expiryTimestamp);
        if (formatted) {
            timelineEntries.push({ label: expiresLabel, value: formatted });
        }
    } else if (nextChargeTimestamp) {
        const formatted = formatPlanExpiry(nextChargeTimestamp);
        if (formatted) {
            timelineEntries.push({
                label: state.limits.subscriptionCancelled ? currentStrings.planEnds : currentStrings.planRenews,
                value: formatted
            });
        }
    }
    const timelineBlock = isPro && timelineEntries.length
        ? `
            <div class="plan-timeline" role="presentation">
                ${timelineEntries.map(({ label, value }) => `
                    <span class="timeline-item">
                        <span class="timeline-label">${label}</span>
                        <span class="timeline-value">${value}</span>
                    </span>
                `).join('')}
            </div>
        `
        : '';
    dom.usageSummary.classList.toggle('pro', isPro);
    dom.usageSummary.classList.toggle('collapsed', isCollapsed);
    const toggleLabel = isCollapsed ? currentStrings.showDetails : currentStrings.hideDetails;
    const timeSavedLabel = formatTimeSaved(timeSavedMinutes);
    const dayCounterValue = expiryCountdown || (isPro ? '0d' : '\u2014');
    const showTimeSavedBlock = timeSavedMinutes > 0;
    const insightMutingNeeded = !expiryCountdown && !showTimeSavedBlock;
    const insightBlocks = [
        `
            <div class="insight-block day-counter">
                <span class="insight-label">${currentStrings.daysRemaining}</span>
                <span class="insight-value">${dayCounterValue}</span>
            </div>
        `
    ];
    if (showTimeSavedBlock) {
        insightBlocks.push(`
            <div class="insight-block time-saved-block">
                <span class="insight-label">${currentStrings.timeSaved}</span>
                <span class="insight-value">${timeSavedLabel}</span>
            </div>
        `);
    }
    replaceContent(dom.usageSummary, `
        <div class="usage-summary-header">
            <div class="plan-details">
                <span class="plan-pill">${planLabel}</span>
                <span class="plan-description"${planDescriptionTitle}>${planDescription}${planMeta ? ` &bull; ${planMeta}` : ''}</span>
            </div>
            <button class="info-toggle" data-action="toggle-info">${toggleLabel}</button>
        </div>
        ${timelineBlock}
        <div class="usage-insight ${insightMutingNeeded ? 'muted' : ''}">
            ${insightBlocks.join('')}
        </div>
    `);
}

export function openClipboardEditModal(item, type = TABS.HISTORY) {
    if (!dom.clipboardEditModal) return;
    const wasHidden = dom.clipboardEditModal.style.display === 'none' || !dom.clipboardEditModal.style.display;
    dom.clipboardEditModal.style.display = 'block';
    if (wasHidden) {
        lockBodyScroll();
    }
    dom.editClipboardId.value = item?.id || '';
    dom.editClipboardType.value = type;
    dom.editClipboardText.value = item?.text || '';
    dom.editClipboardEmoji.value = item?.emoji || '';
    dom.editClipboardLanguage.value = item?.language || '';
    updateClipboardEditorCharCount(item?.text?.length || 0);
    autoSizeClipboardEditor();
    const infoParts = [];
    if (item?.timestamp) {
        infoParts.push(`Created ${getTimeAgo(item.timestamp)}`);
    }
    if (item?.updatedAt) {
        infoParts.push(`Updated ${getTimeAgo(item.updatedAt)}`);
    }
    if (dom.editClipboardMeta) {
        dom.editClipboardMeta.textContent = infoParts.join(' • ') || '';
    }
    dom.editClipboardText?.focus();
}

export function closeClipboardEditModal() {
    if (!dom.clipboardEditModal) return;
    const wasVisible = dom.clipboardEditModal.style.display !== 'none' && dom.clipboardEditModal.style.display !== '';
    dom.clipboardEditModal.style.display = 'none';
    if (wasVisible) {
        unlockBodyScroll();
    }
    dom.editClipboardId.value = '';
    dom.editClipboardType.value = TABS.HISTORY;
    dom.editClipboardText.value = '';
    dom.editClipboardEmoji.value = '';
    dom.editClipboardLanguage.value = '';
    updateClipboardEditorCharCount(0);
    resetClipboardEditorHeight();
    if (dom.editClipboardMeta) {
        dom.editClipboardMeta.textContent = '';
    }
}

export function updateClipboardEditorCharCount(length = 0) {
    if (!dom.editClipboardCharCount) return;
    const label =
        typeof currentStrings.charCount === 'function'
            ? currentStrings.charCount(length)
            : `${length} ${currentStrings.charCount || 'chars'}`;
    dom.editClipboardCharCount.textContent = label;
    autoSizeClipboardEditor();
}

function autoSizeClipboardEditor() {
    if (!dom.editClipboardText) return;
    const textarea = dom.editClipboardText;
    textarea.style.height = 'auto';
    const min = 200;
    const max = 400;
    const next = Math.min(Math.max(textarea.scrollHeight, min), max);
    textarea.style.height = `${next}px`;
}

function resetClipboardEditorHeight() {
    if (!dom.editClipboardText) return;
    dom.editClipboardText.style.height = '';
}

function lockBodyScroll() {
    openModalCount += 1;
    if (openModalCount === 1) {
        document.body?.classList.add('modal-open');
    }
}

function unlockBodyScroll() {
    if (openModalCount === 0) return;
    openModalCount -= 1;
    if (openModalCount === 0) {
        document.body?.classList.remove('modal-open');
    }
}

function formatTimeSaved(minutes) {
    if (!minutes || minutes <= 0) {
        return '0m';
    }
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours > 0) {
        return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    }
    return `${minutes}m`;
}

function formatPlanExpiry(timestamp) {
    try {
        const date = new Date(Number(timestamp));
        if (Number.isNaN(date.getTime())) {
            return '';
        }
        return date.toLocaleString();
    } catch (error) {
        return '';
    }
}

function formatRemainingShortLabel(timestamp) {
    if (!timestamp) return '';
    const remaining = Number(timestamp) - Date.now();
    if (remaining <= 0) return 'expired';
    const days = Math.floor(remaining / DAY_IN_MS);
    if (days >= 1) {
        return `${days}d left`;
    }
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    return `${hours}h left`;
}

function formatExpiryCountdownValue(timestamp) {
    if (!timestamp) return '';
    const remaining = Number(timestamp) - Date.now();
    if (remaining <= 0) return 'Expired';
    const days = Math.floor(remaining / DAY_IN_MS);
    if (days >= 1) {
        return `${days}d`;
    }
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    if (hours >= 1) {
        return `${hours}h`;
    }
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    return `${minutes}m`;
}

function sanitizeForDisplay(text = '') {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}

class VirtualList {
    constructor(container, items, renderItem, options = {}) {
        this.container = container;
        this.items = items || [];
        this.renderItem = renderItem;
        this.itemHeight = options.itemHeight || DEFAULT_VIRTUAL_ITEM_HEIGHT;
        this.overscan = options.overscan ?? 3;
        this.visibleCount = this.computeVisibleCount();
        this.scrollTop = 0;
        this.raf = null;
        this.onScroll = this.onScroll.bind(this);
        this.onResize = this.onResize.bind(this);
        this.container.addEventListener('scroll', this.onScroll, { passive: true });
        window.addEventListener('resize', this.onResize);
        this.render();
    }

    setItems(nextItems) {
        this.items = nextItems || [];
        this.visibleCount = this.computeVisibleCount();
        this.render();
    }

    computeVisibleCount() {
        const baseHeight = this.container.clientHeight || this.container.parentElement?.clientHeight || 520;
        return Math.ceil(baseHeight / this.itemHeight) + this.overscan;
    }

    onScroll() {
        if (this.raf) return;
        this.raf = requestAnimationFrame(() => {
            this.raf = null;
            const scrollTop = this.container.scrollTop;
            if (Math.abs(scrollTop - this.scrollTop) > this.itemHeight / 2) {
                this.scrollTop = scrollTop;
                this.render();
            }
        });
    }

    onResize() {
        const nextVisibleCount = this.computeVisibleCount();
        if (nextVisibleCount !== this.visibleCount) {
            this.visibleCount = nextVisibleCount;
            this.render();
        }
    }

    render() {
        const startIndex = Math.max(0, Math.floor(this.scrollTop / this.itemHeight) - this.overscan);
        const endIndex = Math.min(startIndex + this.visibleCount + this.overscan, this.items.length);
        const fragment = document.createDocumentFragment();
        const spacerTop = document.createElement('div');
        spacerTop.style.height = `${startIndex * this.itemHeight}px`;
        fragment.appendChild(spacerTop);
        for (let i = startIndex; i < endIndex; i += 1) {
            const rendered = this.renderItem(this.items[i]);
            if (rendered) {
                fragment.appendChild(rendered);
            }
        }
        const spacerBottom = document.createElement('div');
        spacerBottom.style.height = `${(this.items.length - endIndex) * this.itemHeight}px`;
        fragment.appendChild(spacerBottom);
        this.container.replaceChildren(fragment);
    }

    destroy() {
        if (this.container) {
            this.container.removeEventListener('scroll', this.onScroll);
        }
        window.removeEventListener('resize', this.onResize);
        if (this.raf) {
            cancelAnimationFrame(this.raf);
            this.raf = null;
        }
    }
}

function createHistoryItem(item, pinnedItems = []) {
    const pinned = pinnedItems.some((p) => p.id === item.id || p.text === item.text);
    return `
        <div class="clipboard-item" data-id="${item.id}" data-type="${TABS.HISTORY}">
            <div class="item-content">
                <div class="item-header">
                    ${renderItemBadges(item.type, pinned)}
                    <div class="item-meta">
                        ${renderCopyCount(item.timesCopied)}
                        <span class="item-time">${getTimeAgo(item.timestamp)}</span>
                    </div>
                </div>
                ${renderItemBody(item)}
            </div>
            <div class="item-actions">
                ${renderActionButton({
                    action: 'copy',
                    id: item.id,
                    title: 'Copy',
                    attrs: `data-source="${TABS.HISTORY}"`
                })}
                ${renderActionButton({
                    action: 'edit-item',
                    id: item.id,
                    title: 'Edit text',
                    attrs: `data-type="${TABS.HISTORY}"`
                })}
                ${renderActionButton({
                    action: pinned ? 'unpin' : 'pin',
                    id: item.id,
                    title: pinned ? 'Unpin' : 'Pin'
                })}
                ${renderActionButton({
                    action: 'delete',
                    id: item.id,
                    title: 'Delete',
                    attrs: `data-type="${TABS.HISTORY}"`
                })}
            </div>
        </div>
    `;
}

function createTopItem(item, rank = 1) {
    const rankBadge = `
        <div class="rank-badge" aria-hidden="true">#${rank}</div>
    `;
    const pinned = false;
    return `
        <div class="clipboard-item top-item" data-id="${item.id}" data-type="${TABS.HISTORY}">
            <div class="item-rank">
                ${rankBadge}
                <div class="item-meta">
                    ${renderCopyCount(item.timesCopied)}
                    <span class="item-time">${getTimeAgo(item.timestamp)}</span>
                </div>
            </div>
            <div class="item-content">
                <div class="item-header">
                    ${renderItemBadges(item.type, pinned)}
                    <div class="item-meta">
                        <span class="item-pill item-pill-accent">Top</span>
                    </div>
                </div>
                ${renderItemBody(item)}
            </div>
            <div class="item-actions">
                ${renderActionButton({
                    action: 'copy',
                    id: item.id,
                    title: 'Copy',
                    attrs: `data-source="${TABS.HISTORY}"`
                })}
                ${renderActionButton({
                    action: 'edit-item',
                    id: item.id,
                    title: 'Edit text',
                    attrs: `data-type="${TABS.HISTORY}"`
                })}
                ${renderActionButton({
                    action: 'pin',
                    id: item.id,
                    title: 'Pin'
                })}
                ${renderActionButton({
                    action: 'delete',
                    id: item.id,
                    title: 'Delete',
                    attrs: `data-type="${TABS.HISTORY}"`
                })}
            </div>
        </div>
    `;
}

function createPinnedItem(item) {
    return `
        <div class="clipboard-item" data-id="${item.id}" data-type="${TABS.PINNED}">
            <div class="item-content">
                <div class="item-header">
                    ${renderItemBadges(item.type, true)}
                    <div class="item-meta">
                        ${renderCopyCount(item.timesCopied)}
                        <span class="item-time">${getPinnedTimeLabel(item)}</span>
                    </div>
                </div>
                ${renderItemBody(item)}
            </div>
            <div class="item-actions">
                ${renderActionButton({
                    action: 'copy',
                    id: item.id,
                    title: 'Copy',
                    attrs: `data-source="${TABS.PINNED}"`
                })}
                ${renderActionButton({
                    action: 'edit-item',
                    id: item.id,
                    title: 'Edit text',
                    attrs: `data-type="${TABS.PINNED}"`
                })}
                ${renderActionButton({
                    action: 'unpin',
                    id: item.id,
                    title: 'Unpin'
                })}
                ${renderActionButton({
                    action: 'delete',
                    id: item.id,
                    title: 'Delete',
                    attrs: `data-type="${TABS.PINNED}"`
                })}
            </div>
        </div>
    `;
}
function createSnippetItem(item) {
    const displayShortcut = item.shortcut || (item.keyword ? `:${item.keyword}` : '');
    return `
        <div class="clipboard-item" data-id="${item.id}" data-type="${TABS.SNIPPETS}">
            <div class="item-content">
                <div class="item-header">
                    <span class="item-type">${escapeHtml(displayShortcut)}</span>
                    <span class="item-time">${item.text?.length || 0} chars</span>
                </div>
                <div class="item-text" title="${escapeHtml(item.text)}">${escapeHtml(truncateText(item.text))}</div>
            </div>
            <div class="item-actions">
                ${renderActionButton({
                    action: 'copy-snippet',
                    id: item.id,
                    title: 'Copy snippet'
                })}
                ${renderActionButton({
                    action: 'edit-snippet',
                    id: item.id,
                    title: 'Edit snippet'
                })}
                ${renderActionButton({
                    action: 'delete-snippet',
                    id: item.id,
                    title: 'Delete snippet'
                })}
            </div>
        </div>
    `;
}

function renderActionButton({ action, id, title, icon, attrs = '' }) {
    const extraAttrs = attrs && attrs.trim().length > 0 ? ` ${attrs.trim()}` : '';
    const safeTitle = escapeHtml(title);
    const hasCustomIcon = typeof icon === 'string' && icon.trim().length > 0;
    const iconMarkup = hasCustomIcon ? icon : (ACTION_ICON_MAP[action] || '&#x25CF;');
    return `
        <button class="action-btn icon-btn" data-action="${action}" data-id="${id}"${extraAttrs} title="${safeTitle}">
            <span class="icon" aria-hidden="true">${iconMarkup}</span>
            <span class="sr-only">${safeTitle}</span>
        </button>
    `;
}

function renderItemBadges(type, isPinned) {
    const badges = [];
    const typeLabel = getTypeLabel(type);
    if (typeLabel) {
        badges.push(`<span class="item-pill">${escapeHtml(typeLabel)}</span>`);
    }
    if (isPinned) {
        badges.push('<span class="item-pill item-pill-accent">Pinned</span>');
    }
    const content = badges.join('') || '&nbsp;';
    return `<div class="item-badges">${content}</div>`;
}

function renderCopyCount(count) {
    const value = Number(count || 0);
    if (!Number.isFinite(value) || value <= 0) {
        return '<span class="item-copy-count muted">0×</span>';
    }
    return `<span class="item-copy-count" title="Times copied">${value}×</span>`;
}

function getTypeLabel(type) {
    switch (type) {
        case 'url':
            return 'Link';
        case 'email':
            return 'Email';
        case 'number':
            return 'Number';
        case 'code':
            return 'Code';
        default:
            return '';
    }
}

function updateTabCounters(state) {
    const historyCount = Number.isFinite(state.history.total) ? state.history.total : state.history.items.length;
    const pinnedCount = state.pinned.length;
    const snippetCount = state.snippets.length;
    const topCount = Array.isArray(state.top) ? Math.min(state.top.length, 10) : 0;
    setTabCounter(dom.historyCounter, historyCount, state.limits.maxHistory, state.limits.isPro);
    setTabCounter(dom.pinnedCounter, pinnedCount, state.limits.maxPinned, state.limits.isPro);
    setTabCounter(dom.topCounter, topCount, 10, false);
    setTabCounter(dom.snippetsCounter, snippetCount, state.limits.maxSnippets, state.limits.isPro);
}

function setTabCounter(element, count, max, isPro) {
    if (!element) return;
    const unlimited = isPro || (Number.isFinite(max) && max >= Number.MAX_SAFE_INTEGER / 2) || !max;
    if (unlimited) {
        element.textContent = `${count}/${INFINITY_SYMBOL}`;
        element.classList.add('unlimited');
        return;
    }
    const limit = max || 0;
    if (limit > 0) {
        element.textContent = `${Math.min(count, limit)}/${limit}`;
    } else {
        element.textContent = `${count}`;
    }
    element.classList.remove('unlimited');
}

function getPinnedTimeLabel(item) {
    if (item?.pinnedAt) {
        return `Pinned ${getTimeAgo(item.pinnedAt)}`;
    }
    if (item?.timestamp) {
        return `Saved ${getTimeAgo(item.timestamp)}`;
    }
    return 'Pinned';
}

function getTimeAgo(timestamp) {
    if (!timestamp) return 'just now';
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

function truncateText(text = '', maxLength = 120) {
    if (text.length <= maxLength) return text;
    return `${text.substring(0, maxLength)}\u2026`;
}

const RTL_CHAR_REGEX = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function getTextDirection(text = '') {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    const first = trimmed[0];
    return RTL_CHAR_REGEX.test(first) ? 'rtl' : 'ltr';
}

function escapeHtml(text = '') {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\//g, '&#x2F;');
}

function renderItemBody(item = {}) {
    const baseText = (item.text || '').trim();
    const emoji = (item.emoji || '').trim();
    const language = (item.language || '').trim();
    const hasCodeStyling = language || item.type === 'code';
    const dir = document.documentElement?.dir === 'rtl' ? getTextDirection(baseText) : null;
    const dirAttr = dir ? ` dir="${dir}"` : '';
    const emojiMarkup = emoji ? `<span class="item-emoji-inline">${escapeHtml(emoji)}</span>` : '';
    const textContent = baseText ? escapeHtml(truncateText(baseText)) : '&nbsp;';
    const languageBadge = language ? `<span class="item-lang-pill">${escapeHtml(language)}</span>` : '';
    return `
        <div class="item-text${hasCodeStyling ? ' item-text-code' : ''}" title="${escapeHtml(baseText)}">
            <div class="item-text-main">
                ${emojiMarkup}
                <span class="item-text-body"${dirAttr}>${textContent}</span>
            </div>
            ${languageBadge}
        </div>
    `;
}





