import { filterAndRank } from './search.js';
import { TABS, PAGINATION } from './constants.js';

const dom = {};
let openModalCount = 0;
const INFINITY_SYMBOL = '\u221E';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
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
    const label = isLight ? 'Switch to dark mode' : 'Switch to light mode';
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
    const label = enabled ? 'Auto' : 'Paused';
    if (dom.autoSaveToggleIcon) {
        dom.autoSaveToggleIcon.textContent = icon;
    }
    if (dom.autoSaveToggleLabel) {
        dom.autoSaveToggleLabel.textContent = label;
    }
    const actionLabel = enabled ? 'Pause automatic saving' : 'Resume automatic saving';
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

    if (filteredItems.length === 0) {
        dom.historyList.replaceChildren();
        dom.historyEmpty?.classList.remove('hidden');
        return;
    }

    dom.historyEmpty?.classList.add('hidden');
    const limitWarning = buildLimitWarning(state);
    const renderItem = (item) => htmlToFragment(createHistoryItem(item, state.pinned));

    // Use virtual scrolling for large lists
    if (filteredItems.length > 100) {
        const fragment = document.createDocumentFragment();
        if (limitWarning) {
            fragment.appendChild(htmlToFragment(limitWarning));
        }
        const listContainer = document.createElement('div');
        listContainer.className = 'virtual-list-container';
        fragment.appendChild(listContainer);
        dom.historyList.replaceChildren(fragment);
        new VirtualList(listContainer, filteredItems, renderItem);
    } else {
        const fragment = document.createDocumentFragment();
        if (limitWarning) {
            fragment.appendChild(htmlToFragment(limitWarning));
        }
        filteredItems.forEach((item) => {
            fragment.appendChild(renderItem(item));
        });
        const historyActions = createHistoryActions(state);
        if (historyActions) {
            fragment.appendChild(historyActions);
        }
        dom.historyList.replaceChildren(fragment);
    }
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
    const actions = [];
    const loadedCount = state.history.items.length;
    if (state.history.hasMore) {
        const totalItems = state.history.total || loadedCount;
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.id = 'loadMoreHistoryBtn';
        loadMoreBtn.type = 'button';
        loadMoreBtn.className = 'load-more-btn';
        loadMoreBtn.textContent = `Load ${PAGINATION.PAGE_SIZE} more (${Math.min(loadedCount, totalItems)}/${totalItems})`;
        actions.push(loadMoreBtn);
    }
    if (state.limits?.isPro && loadedCount > 0) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'clear-history-btn';
        clearBtn.dataset.action = 'clear-history';
        clearBtn.textContent = 'Clear history';
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
            You're using ${state.history.items.length}/${maxHistory} history items.
            <button class="upgrade-inline-btn" data-action="open-upgrade">Upgrade</button>
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
        ? 'Pro tier: Unlimited history, pins, snippets.'
        : 'Free tier: Limited history and pin slots.';
    const planLabel = state.limits.planLabel || (isPro ? 'Pro plan' : 'Free plan');
    const activatedLabel = isPro && state.limits.activatedAt ? formatPlanExpiry(state.limits.activatedAt) : '';
    const futureEndLabel = (() => {
        if (!isPro) return '';
        if (expiryTimestamp) {
            const text = formatPlanExpiry(expiryTimestamp);
            if (!text) return '';
            return `${expiryTimestamp <= Date.now() ? 'Ended' : 'Ends'} ${text}`;
        }
        if (nextChargeTimestamp) {
            const text = formatPlanExpiry(nextChargeTimestamp);
            if (!text) return '';
            const cancelled = state.limits.subscriptionCancelled;
            return `${cancelled ? 'Ends' : 'Renews'} ${text}`;
        }
        return '';
    })();
    let planMeta = '';
    if (isPro && shortRemaining) {
        if (expiryTimestamp || state.limits.subscriptionCancelled) {
            planMeta = shortRemaining;
        } else {
            const trimmed = shortRemaining.replace(/\sleft$/, '');
            planMeta = `Renews in ${trimmed}`;
        }
    }
    const planDescriptionTitle = futureEndLabel ? ` title="${futureEndLabel}"` : '';
    const timelineEntries = [];
    if (activatedLabel) {
        timelineEntries.push({ label: 'Started', value: activatedLabel });
    }
    if (expiryTimestamp) {
        const expiresLabel = expiryTimestamp <= Date.now() ? 'Ended' : 'Ends';
        const formatted = formatPlanExpiry(expiryTimestamp);
        if (formatted) {
            timelineEntries.push({ label: expiresLabel, value: formatted });
        }
    } else if (nextChargeTimestamp) {
        const formatted = formatPlanExpiry(nextChargeTimestamp);
        if (formatted) {
            timelineEntries.push({
                label: state.limits.subscriptionCancelled ? 'Ends' : 'Renews',
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
    const toggleLabel = isCollapsed ? 'Show details' : 'Hide details';
    const timeSavedLabel = formatTimeSaved(timeSavedMinutes);
    const dayCounterValue = expiryCountdown || (isPro ? '0d' : '\u2014');
    const showTimeSavedBlock = timeSavedMinutes > 0;
    const insightMutingNeeded = !expiryCountdown && !showTimeSavedBlock;
    const insightBlocks = [
        `
            <div class="insight-block day-counter">
                <span class="insight-label">Days remaining</span>
                <span class="insight-value">${dayCounterValue}</span>
            </div>
        `
    ];
    if (showTimeSavedBlock) {
        insightBlocks.push(`
            <div class="insight-block time-saved-block">
                <span class="insight-label">Time saved</span>
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
    dom.editClipboardCharCount.textContent = `${length} chars`;
    autoSizeClipboardEditor();
}

function autoSizeClipboardEditor() {
    if (!dom.editClipboardText) return;
    const textarea = dom.editClipboardText;
    textarea.style.height = 'auto';
    const min = 70;
    const max = 140;
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
    constructor(container, items, renderItem) {
        this.container = container;
        this.items = items || [];
        this.renderItem = renderItem;
        this.itemHeight = 80;
        this.visibleCount = Math.ceil(container.clientHeight / this.itemHeight) + 2;
        this.scrollTop = 0;
        this.onScroll = this.onScroll.bind(this);
        this.container.addEventListener('scroll', this.onScroll);
        this.render();
    }

    onScroll() {
        const scrollTop = this.container.scrollTop;
        if (Math.abs(scrollTop - this.scrollTop) > this.itemHeight) {
            this.scrollTop = scrollTop;
            this.render();
        }
    }

    render() {
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const endIndex = Math.min(startIndex + this.visibleCount, this.items.length);
        const fragment = document.createDocumentFragment();
        const spacerTop = document.createElement('div');
        spacerTop.style.height = `${startIndex * this.itemHeight}px`;
        fragment.appendChild(spacerTop);
        for (let i = startIndex; i < endIndex; i += 1) {
            fragment.appendChild(this.renderItem(this.items[i]));
        }
        const spacerBottom = document.createElement('div');
        spacerBottom.style.height = `${(this.items.length - endIndex) * this.itemHeight}px`;
        fragment.appendChild(spacerBottom);
        this.container.replaceChildren(fragment);
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
    if (isPro) {
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
    const emojiMarkup = emoji ? `<span class="item-emoji-inline">${escapeHtml(emoji)}</span>` : '';
    const textContent = baseText ? escapeHtml(truncateText(baseText)) : '&nbsp;';
    const languageBadge = language ? `<span class="item-lang-pill">${escapeHtml(language)}</span>` : '';
    return `
        <div class="item-text${hasCodeStyling ? ' item-text-code' : ''}" title="${escapeHtml(baseText)}">
            <div class="item-text-main">
                ${emojiMarkup}
                <span class="item-text-body">${textContent}</span>
            </div>
            ${languageBadge}
        </div>
    `;
}






