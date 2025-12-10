import translations from '../popup/translations/index.js';

// Settings Page JavaScript
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LEMON_SQUEEZY_CHECKOUT_URL = 'https://litextools.lemonsqueezy.com/buy/23c20cab-5892-478e-b693-7364ec7b7b45';
const LICENSE_FORMAT_HELP = 'XXXX-XXXX-XXXX-XXXX';

class SettingsManager {
    constructor() {
        this.settings = {
            theme: 'light',
            notifications: true,
            language: 'auto',
            keyboardShortcuts: true,
            autoSave: true
        };
        this.analytics = {
            totalCopies: 0,
            totalPins: 0,
            totalSnippets: 0,
            timeSaved: 0,
            charactersPasted: 0
        };
        this.storageUsage = {
            historyBytes: 0,
            pinnedBytes: 0,
            snippetsBytes: 0,
            totalBytes: 0
        };
        this.licenseInfo = null;
        this.licenseStatusLoaded = false;
        this.licenseLoadError = null;
        this.premiumFeaturesInitialized = false;
        this.deletedItemsVisible = false;
        this.deletedItems = [];
        this.strings = null;
        
        this.init();
    }

    get defaultSettings() {
        return {
            theme: 'light',
            notifications: true,
            language: 'auto',
            keyboardShortcuts: true,
            autoSave: true
        };
    }

    async init() {
        try {
            await this.loadSettings();
            await this.loadAnalytics();
            await this.loadStorageUsage();
            await this.loadLicenseInfo();
        } catch (error) {
            console.error('Settings initialization error:', error);
        }

        try {
            this.setupEventListeners();
        } catch (error) {
            console.error('Error wiring settings events:', error);
        }

        this.applyLanguage();
        this.updateTheme();
        this.updateUI();
        this.tryAutoActivateFromUrl();
    }

    setSafeContent(target, html = '') {
        if (!target) return;
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
        const container = doc.body.firstChild;
        const fragment = document.createDocumentFragment();
        while (container && container.firstChild) {
            fragment.appendChild(container.firstChild);
        }
        target.replaceChildren(fragment);
    }

    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    detectDefaultLanguage() {
        try {
            const raw = navigator?.language || 'en';
            const normalized = raw.toLowerCase();
            if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hant')) return 'zh-TW';
            if (normalized.startsWith('zh')) return 'zh-CN';
            const short = normalized.split('-')[0];
            return ['en', 'ar', 'hi', 'pt', 'es', 'ru', 'ja', 'de', 'fr', 'id'].includes(short) ? short : 'en';
        } catch (error) {
            return 'en';
        }
    }

    async loadSettings() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getSettings'
            });
            if (response && response.settings) {
                this.settings = { ...this.settings, ...response.settings };
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    async loadAnalytics() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getAnalytics'
            });
            if (response && response.analytics) {
                this.analytics = { ...this.analytics, ...response.analytics };
            }
        } catch (error) {
            console.error('Error loading analytics:', error);
        }
    }

    async loadStorageUsage() {
        try {
            const data = await chrome.storage.local.get([
                'clipboardHistory',
                'pinnedItems',
                'snippets'
            ]);
            const history = Array.isArray(data.clipboardHistory) ? data.clipboardHistory : [];
            const pinned = Array.isArray(data.pinnedItems) ? data.pinnedItems : [];
            const snippets = Array.isArray(data.snippets) ? data.snippets : [];

            const estimateList = (list = []) => list.reduce((sum, item) => {
                const parts = [
                    item?.text,
                    item?.title,
                    item?.emoji,
                    item?.language,
                    item?.type
                ];
                return sum + parts.reduce((p, v) => p + this.getByteLength(v), 0);
            }, 0);

            const historyBytes = estimateList(history);
            const pinnedBytes = estimateList(pinned);
            const snippetsBytes = snippets.reduce((sum, item) => {
                const parts = [item?.text, item?.shortcut, item?.keyword, item?.emoji];
                return sum + parts.reduce((p, v) => p + this.getByteLength(v), 0);
            }, 0);

            const totalBytes = historyBytes + pinnedBytes + snippetsBytes;
            this.storageUsage = { historyBytes, pinnedBytes, snippetsBytes, totalBytes };
        } catch (error) {
            console.error('Error calculating storage usage:', error);
        }
    }

    getByteLength(value) {
        if (!value) return 0;
        try {
            return new TextEncoder().encode(String(value)).length;
        } catch (error) {
            return String(value).length;
        }
    }

    openExternal(url) {
        if (!url) return;
        try {
            if (chrome?.tabs?.create) {
                chrome.tabs.create({ url });
                return;
            }
        } catch (error) {
            // ignore and fallback
        }
        try {
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (error) {
            console.error('Failed to open external link:', error);
        }
    }

    async loadLicenseInfo() {
        this.licenseLoadError = null;
        this.licenseStatusLoaded = false;
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getLicenseInfo'
            });
            this.licenseInfo = response?.licenseInfo || null;
        } catch (error) {
            console.error('Error loading license info:', error);
            this.licenseInfo = null;
            this.licenseLoadError = 'Unable to reach the license server. Please check your internet connection and try again.';
        } finally {
            this.licenseStatusLoaded = true;
            this.updateLicenseUI();
        }
    }

    setupEventListeners() {
        const closeBtn = document.getElementById('closeBtn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => window.close());
        }
        
        const activateBtn = document.getElementById('activateLicenseBtn');
        const licenseInput = document.getElementById('licenseKeyInput');
        
        if (activateBtn) {
            activateBtn.addEventListener('click', () => {
                this.activateLicense();
            });
        }
        
        if (licenseInput) {
            licenseInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.activateLicense();
                }
            });
            
            // Format license key as XXXX-XXXX-XXXX-XXXX (or UUID 8-4-4-4-12)
            licenseInput.addEventListener('input', (e) => {
                const raw = (e.target.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                let trimmed = raw.length > 32 ? raw.slice(0, 32) : raw;
                let formatted = trimmed;
                if (trimmed.length <= 16) {
                    const groups = trimmed.match(/.{1,4}/g);
                    formatted = groups ? groups.join('-') : trimmed;
                } else {
                    const parts = [];
                    if (trimmed.length > 0) parts.push(trimmed.slice(0, 8));
                    if (trimmed.length > 8) parts.push(trimmed.slice(8, 12));
                    if (trimmed.length > 12) parts.push(trimmed.slice(12, 16));
                    if (trimmed.length > 16) parts.push(trimmed.slice(16, 20));
                    if (trimmed.length > 20) parts.push(trimmed.slice(20));
                    formatted = parts.join('-');
                }
                e.target.value = formatted;
            });
        }

        const themeToggle = document.getElementById('darkTheme');
        if (themeToggle) {
            themeToggle.checked = this.settings.theme === 'dark';
            themeToggle.addEventListener('change', (e) => {
                this.settings.theme = e.target.checked ? 'dark' : 'light';
                this.updateTheme();
                this.saveSettings(false);
            });
        }

        const notificationsToggle = document.getElementById('notifications');
        if (notificationsToggle) {
            notificationsToggle.checked = this.settings.notifications;
            notificationsToggle.addEventListener('change', (e) => {
                this.settings.notifications = e.target.checked;
                this.saveSettings(false);
            });
        }

        const shortcutsToggle = document.getElementById('keyboardShortcuts');
        if (shortcutsToggle) {
            shortcutsToggle.checked = this.settings.keyboardShortcuts;
            shortcutsToggle.addEventListener('change', (e) => {
                this.settings.keyboardShortcuts = e.target.checked;
                this.saveSettings(false);
            });
        }

        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            if (!this.settings.language || this.settings.language === 'auto') {
                this.settings.language = this.detectDefaultLanguage();
            }
            languageSelect.value = this.settings.language;
            languageSelect.addEventListener('change', (e) => {
                this.settings.language = e.target.value || 'auto';
                this.applyLanguage();
                this.saveSettings(false);
            });
        }

        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveSettings());
        }

        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetSettings());
        }

        const exportBtn = document.getElementById('exportDataBtn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportData());
        }

        const importBtn = document.getElementById('importDataBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                const input = document.getElementById('importFileInput');
                if (input) input.click();
            });
        }

        const importFileInput = document.getElementById('importFileInput');
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    this.importData(file);
                }
                e.target.value = '';
            });
        }

        const clearAllBtn = document.getElementById('clearAllBtn');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', () => this.clearAllData());
        }

        const backupBtn = document.getElementById('createBackupBtn');
        if (backupBtn) {
            backupBtn.addEventListener('click', () => this.createBackup());
        }

        const showDeletedBtn = document.getElementById('showDeletedBtn');
        if (showDeletedBtn) {
            showDeletedBtn.addEventListener('click', () => {
                if (this.deletedItemsVisible) {
                    this.hideDeletedItems();
                } else {
                    this.showDeletedItems();
                }
            });
        }

        const closeDeletedBtn = document.getElementById('closeDeletedBtn');
        if (closeDeletedBtn) {
            closeDeletedBtn.addEventListener('click', () => {
                this.hideDeletedItems();
            });
        }
    }

    updateUI() {
        this.updateSettingsUI();
        this.updateAnalyticsUI();
        this.updateStorageUI();
        this.updateLicenseUI();
    }

    updateSettingsUI() {
        const themeToggle = document.getElementById('darkTheme');
        if (themeToggle) {
            themeToggle.checked = this.settings.theme === 'dark';
        }

        const notificationsToggle = document.getElementById('notifications');
        if (notificationsToggle) {
            notificationsToggle.checked = !!this.settings.notifications;
        }

        const shortcutsToggle = document.getElementById('keyboardShortcuts');
        if (shortcutsToggle) {
            shortcutsToggle.checked = !!this.settings.keyboardShortcuts;
        }

        const languageSelect = document.getElementById('languageSelect');
        if (languageSelect) {
            languageSelect.value = this.settings.language;
        }

        this.applyLanguage();
        this.updateTheme();
    }

    applyLanguage() {
        const lang = this.settings.language && this.settings.language !== 'auto'
            ? this.settings.language
            : this.detectDefaultLanguage();
        const strings = translations;
        const dict = strings[lang] || strings.en;
        this.strings = dict;
        document.documentElement.lang = lang;
        const setText = (id, key) => {
            const el = document.getElementById(id);
            if (el && dict[key]) el.textContent = dict[key];
        };
        setText('titleSettings', 'titleSettings');
        setText('generalSettingsTitle', 'generalTitle');
        setText('darkThemeLabel', 'darkTheme');
        setText('darkThemeDesc', 'darkThemeDesc');
        setText('notificationsLabel', 'notifications');
        setText('notificationsDesc', 'notificationsDesc');
        setText('languageLabel', 'language');
        setText('languageDesc', 'languageDesc');
        setText('shortcutsLabel', 'shortcuts');
        setText('shortcutsDesc', 'shortcutsDesc');
        setText('dataSectionTitle', 'dataTitle');
        setText('exportText', 'export');
        setText('importText', 'import');
        setText('clearAllText', 'clearAll');
        setText('backupText', 'backup');
        setText('storageTitle', 'storageTitle');
        setText('storageHistoryLabel', 'storageHistory');
        setText('storagePinnedLabel', 'storagePinned');
        setText('storageSnippetsLabel', 'storageSnippets');
        setText('storageTotalLabel', 'storageTotal');
        setText('analyticsTitle', 'analyticsTitle');
        setText('totalCopiesLabel', 'analyticsCopiesLabel');
        setText('totalPinsLabel', 'analyticsPinsLabel');
        setText('totalSnippetsLabel', 'analyticsSnippetsLabel');
        setText('timeSavedLabel', 'analyticsTimeSavedLabel');
        setText('licenseTitle', 'licenseTitle');
        setText('licenseStatusLoading', 'licenseStatusChecking');
        setText('subscriptionLabel', 'subscriptionLabel');
        setText('licenseKeyLabel', 'licenseKeyLabel');
        const showDeletedBtn = document.getElementById('showDeletedBtn');
        if (showDeletedBtn && dict.viewDeleted) {
            showDeletedBtn.textContent = this.deletedItemsVisible && dict.hideDeleted
                ? dict.hideDeleted
                : dict.viewDeleted;
        }
        const activateBtn = document.getElementById('activateLicenseBtn');
        if (activateBtn && dict.licenseActivateBtn) {
            activateBtn.textContent = dict.licenseActivateBtn;
        }
        const licenseInput = document.getElementById('licenseKeyInput');
        if (licenseInput && dict.licensePlaceholder) {
            licenseInput.placeholder = dict.licensePlaceholder;
        }
        const howTo = document.getElementById('licenseHowTo');
        if (howTo && dict.licenseHowTo) {
            this.setSafeContent(howTo, dict.licenseHowTo);
        }
        setText('deletedSectionTitle', 'deletedTitle');
        setText('deletedInfo', 'deletedInfo');
        const showDeleted = document.getElementById('showDeletedBtn');
        if (showDeleted && dict.viewDeleted) {
            showDeleted.textContent = dict.viewDeleted;
        }
        setText('deletedListTitle', 'deletedListTitle');
        const loadingText = document.getElementById('deletedLoadingText');
        if (loadingText && dict.deletedLoading) {
            loadingText.textContent = dict.deletedLoading;
        }
        document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
        document.body.classList.toggle('rtl', lang === 'ar');
    }

    updateTheme() {
        const body = document.body;
        if (!body) return;
        body.classList.toggle('theme-dark', this.settings.theme === 'dark');
        body.classList.toggle('theme-light', this.settings.theme !== 'dark');
    }

    updateAnalyticsUI() {
        const formatNumber = (n) => new Intl.NumberFormat().format(Number(n || 0));
        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };

        setValue('totalCopies', formatNumber(this.analytics.totalCopies));
        setValue('totalPins', formatNumber(this.analytics.totalPins));
        setValue('totalSnippets', formatNumber(this.analytics.totalSnippets));
        setValue('timeSaved', this.formatTimeSaved(this.analytics.timeSaved));
    }

    formatTimeSaved(minutes) {
        const totalMinutes = Number(minutes || 0);
        if (!totalMinutes) return '0h';
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        if (!hours) return `${mins}m`;
        if (!mins) return `${hours}h`;
        return `${hours}h ${mins}m`;
    }

    updateStorageUI() {
        const setValue = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        setValue('storageHistory', this.formatBytes(this.storageUsage.historyBytes));
        setValue('storagePinned', this.formatBytes(this.storageUsage.pinnedBytes));
        setValue('storageSnippets', this.formatBytes(this.storageUsage.snippetsBytes));
        setValue('storageTotal', this.formatBytes(this.storageUsage.totalBytes));
        const footnote = document.getElementById('storageFootnote');
        if (footnote) {
            footnote.textContent = `Approx ${this.formatBytes(this.storageUsage.totalBytes)} of ~5 MB browser storage used`;
        }
    }

    formatBytes(bytes = 0) {
        const value = Number(bytes || 0);
        if (!value) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
        const converted = value / Math.pow(1024, index);
        return `${converted.toFixed(converted >= 10 ? 0 : 1)} ${units[index]}`;
    }

    updateLicenseUI() {
        const statusEl = document.getElementById('licenseStatus');
        const expiryValueEl = document.getElementById('subscriptionExpiryValue');
        const expiryIndicatorEl = document.getElementById('licenseExpiryIndicator');
        const t = this.strings || {};

        if (!statusEl) return;
        statusEl.className = 'license-status';

        const setStatus = (html) => this.setSafeContent(statusEl, html);

        if (!this.licenseStatusLoaded) {
            setStatus(`
                <div class="status-loading" role="status">
                    <span class="loading-spinner" aria-hidden="true"></span>
                    <span>${this.escapeHtml(t.licenseStatusChecking || 'Checking license status...')}</span>
                </div>
            `);
            return;
        }

        if (this.licenseLoadError) {
            setStatus(`
                <div class="license-inactive">
                    <div class="status-icon">⚠️</div>
                    <div class="status-details">
                        <strong>${this.escapeHtml(t.licenseInactiveTitle || 'Could not verify license')}</strong>
                        <p>${this.escapeHtml(this.licenseLoadError)}</p>
                    </div>
                </div>
            `);
            this.setLicenseMessage('error', this.licenseLoadError);
            if (expiryIndicatorEl) expiryIndicatorEl.style.display = 'none';
            if (expiryValueEl) expiryValueEl.textContent = t.licenseExpiryNotAvailable || 'Not available';
            return;
        }

        if (this.licenseInfo && this.licenseInfo.activated) {
            const expiresAt = this.licenseInfo.expiresAt || null;
            const plan = this.licenseInfo.planLabel || 'Pro Access';
            const nextCharge = this.licenseInfo.nextChargeAt || null;
            const expiresText = expiresAt ? new Date(expiresAt).toLocaleString() : 'Not available';
            const remaining = expiresAt ? Math.max(Math.ceil((expiresAt - Date.now()) / DAY_IN_MS), 0) : null;

            setStatus(`
                <div class="license-active">
                    <div class="status-icon">✅</div>
                    <div class="status-details">
                        <strong>${this.escapeHtml(t.licenseActiveTitle || 'License Active')}</strong>
                        <p>${this.escapeHtml(plan)}</p>
                        <p>${expiresAt ? `${this.escapeHtml(t.expiresOn || 'Expires on')} ${this.escapeHtml(expiresText)}` : (t.licenseExpiryNotAvailable || 'Expiry not available')}</p>
                        ${nextCharge ? `<p>${this.escapeHtml(t.nextCharge || 'Next charge')}: ${this.escapeHtml(new Date(nextCharge).toLocaleString())}</p>` : ''}
                    </div>
                </div>
            `);

            if (expiryValueEl) expiryValueEl.textContent = expiresText;
            if (expiryIndicatorEl) {
                expiryIndicatorEl.style.display = expiresAt ? 'block' : 'none';
                expiryIndicatorEl.textContent = remaining !== null ? `Expires in ${remaining} day${remaining === 1 ? '' : 's'}` : '';
            }
            this.setLicenseMessage('success', 'License verified. Pro features unlocked.');
            return;
        }

        setStatus(`
            <div class="license-inactive">
                <div class="status-icon">🔑</div>
                <div class="status-details">
                    <strong>${this.escapeHtml(t.licenseInactiveTitle || 'No active license')}</strong>
                    <p>${this.escapeHtml(t.licenseInactiveDesc || 'Enter your Lemon Squeezy license key to unlock Pro features.')}</p>
                    <p><a id="licenseBuyLink" href="${LEMON_SQUEEZY_CHECKOUT_URL}" target="_blank" rel="noopener">${this.escapeHtml(t.licenseBuyLink || 'Buy a license')}</a></p>
                </div>
            </div>
        `);
        const buyLink = document.getElementById('licenseBuyLink');
        if (buyLink) {
            buyLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.openExternal(LEMON_SQUEEZY_CHECKOUT_URL);
            });
        }
        if (expiryIndicatorEl) expiryIndicatorEl.style.display = 'none';
        if (expiryValueEl) expiryValueEl.textContent = t.licenseExpiryNotAvailable || 'Not available';
        this.setLicenseMessage('info', `License format: ${LICENSE_FORMAT_HELP}`);
    }

    showDeletedItems() {
        this.deletedItemsVisible = true;
        const list = document.getElementById('deletedItemsList');
        if (list) list.style.display = 'block';
        this.loadDeletedItems();
        const showBtn = document.getElementById('showDeletedBtn');
        if (showBtn && this.strings?.hideDeleted) {
            showBtn.textContent = this.strings.hideDeleted;
        }
    }

    hideDeletedItems() {
        this.deletedItemsVisible = false;
        const list = document.getElementById('deletedItemsList');
        if (list) list.style.display = 'none';
        const showBtn = document.getElementById('showDeletedBtn');
        if (showBtn && this.strings?.viewDeleted) {
            showBtn.textContent = this.strings.viewDeleted;
        }
    }

    setLicenseMessage(type, message) {
        const messageEl = document.getElementById('licenseMessage');
        if (!messageEl) return;
        messageEl.className = `license-message ${type}`;
        messageEl.textContent = message || '';
    }

    async activateLicense() {
        const input = document.getElementById('licenseKeyInput');
        const button = document.getElementById('activateLicenseBtn');
        if (!input) return;

        const raw = (input.value || '').trim();
        if (!raw) {
            this.setLicenseMessage('warning', 'Please enter your license key.');
            return;
        }

        const normalized = raw.toUpperCase();
        this.setLicenseMessage('info', 'Verifying license...');
        if (button) button.disabled = true;

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'verifyLicense',
                licenseKey: normalized
            });

            if (response?.valid && response.licenseInfo) {
                this.licenseInfo = response.licenseInfo;
                this.licenseLoadError = null;
                this.licenseStatusLoaded = true;
                this.updateLicenseUI();
                this.showNotification('License activated successfully!', 'success');
            } else {
                const error = response?.error || 'License could not be verified. Please check the key and try again.';
                this.setLicenseMessage('error', error);
            }
        } catch (error) {
            console.error('License activation failed:', error);
            const message = (error?.message || '').includes('Could not establish connection')
                ? 'Activation service is unavailable. Please reopen the extension or reload it, then try again.'
                : 'Activation failed. Please try again.';
            this.setLicenseMessage('error', message);
        } finally {
            if (button) button.disabled = false;
        }
    }

    async saveSettings(showToast = true) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: this.settings
            });

            if (response && response.success && showToast) {
                this.showNotification('Settings saved!', 'success');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Error saving settings', 'error');
        }
    }

    resetSettings() {
        this.settings = { ...this.defaultSettings };
        this.updateSettingsUI();
        this.saveSettings();
    }

    showNotification(message, type = 'info') {
        let container = document.getElementById('settingsNotificationContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'settingsNotificationContainer';
            container.className = 'notification-container';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        container.appendChild(notification);

        const removeNow = () => {
            notification.classList.remove('visible');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
                if (!container.children.length) {
                    container.remove();
                }
            }, 220);
        };

        notification.addEventListener('click', removeNow);

        requestAnimationFrame(() => {
            notification.classList.add('visible');
        });

        setTimeout(removeNow, 3200);
    }

    async exportData() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'exportData' });
            if (!response?.data) {
                this.showNotification('Failed to export data', 'error');
                return;
            }

            const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `smart-clipboard-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
            this.showNotification('Data exported successfully', 'success');
        } catch (error) {
            console.error('Export failed:', error);
            this.showNotification('Failed to export data', 'error');
        }
    }

    async importData(file) {
        try {
            const text = await file.text();
            const json = JSON.parse(text);
            const response = await chrome.runtime.sendMessage({
                action: 'importData',
                data: json
            });

            if (response?.success) {
                await this.loadStorageUsage();
                await this.loadAnalytics();
                this.updateUI();
                this.showNotification('Data imported successfully', 'success');
            } else {
                this.showNotification('Import failed', 'error');
            }
        } catch (error) {
            console.error('Import failed:', error);
            this.showNotification('Invalid import file', 'error');
        }
    }

    async clearAllData() {
        if (!confirm('Clear all clipboard history, pinned items, snippets, and analytics?')) return;
        try {
            const response = await chrome.runtime.sendMessage({ action: 'clearAllData' });
            if (response?.success) {
                await this.loadAnalytics();
                await this.loadStorageUsage();
                this.updateUI();
                this.showNotification('All data cleared', 'success');
            } else {
                this.showNotification('Unable to clear data', 'error');
            }
        } catch (error) {
            console.error('Clear all data failed:', error);
            this.showNotification('Unable to clear data', 'error');
        }
    }

    async createBackup() {
        try {
            const response = await chrome.runtime.sendMessage({ action: 'createBackup' });
            if (response?.success) {
                this.showNotification('Backup created successfully', 'success');
            } else {
                this.showNotification('Failed to create backup', 'error');
            }
        } catch (error) {
            console.error('Backup failed:', error);
            this.showNotification('Failed to create backup', 'error');
        }
    }

    async loadDeletedItems() {
        const content = document.getElementById('deletedItemsContent');
        if (!content) return;
        const loadingText = this.strings?.deletedLoading || 'Loading deleted items...';
        this.setSafeContent(content, `<div class="loading">${this.escapeHtml(loadingText)}</div>`);

        try {
            const response = await chrome.runtime.sendMessage({ action: 'getDeletedItemsHistory' });
            const items = Array.isArray(response?.history) ? response.history : [];
            this.deletedItems = items;
            this.renderDeletedItems(items);
        } catch (error) {
            console.error('Failed to load deleted items:', error);
            const errText = this.strings?.deletedError || 'Unable to load deleted items.';
            this.setSafeContent(content, `<div class="error">${this.escapeHtml(errText)}</div>`);
        }
    }

    renderDeletedItems(items) {
        const content = document.getElementById('deletedItemsContent');
        if (!content) return;

        if (!items.length) {
            const emptyText = this.strings?.deletedEmpty || 'No deleted items found.';
            this.setSafeContent(content, `<div class="empty">${this.escapeHtml(emptyText)}</div>`);
            return;
        }
        const restoreText = this.strings?.deletedRestore || 'Restore';
        const removeText = this.strings?.deletedRemove || 'Remove';

        const html = items.map((item) => `
            <div class="deleted-item" data-hash="${this.escapeHtml(item.textHash)}">
                <div class="deleted-meta">
                    <div class="deleted-text">${this.escapeHtml((item.text || '').slice(0, 160))}${item.text && item.text.length > 160 ? '...' : ''}</div>
                    <div class="deleted-date">${this.formatRelativeTime(item.deletedAt)}</div>
                </div>
                <div class="deleted-actions">
                    <button class="btn-secondary restore-deleted" data-hash="${this.escapeHtml(item.textHash)}">${this.escapeHtml(restoreText)}</button>
                    <button class="btn-secondary purge-deleted" data-hash="${this.escapeHtml(item.textHash)}">${this.escapeHtml(removeText)}</button>
                </div>
            </div>
        `).join('');

        this.setSafeContent(content, html);

        content.querySelectorAll('.restore-deleted').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const hash = e.currentTarget.getAttribute('data-hash');
                this.restoreDeletedItem(hash);
            });
        });

        content.querySelectorAll('.purge-deleted').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const hash = e.currentTarget.getAttribute('data-hash');
                this.purgeDeletedItem(hash);
            });
        });
    }

    formatRelativeTime(timestamp) {
        if (!timestamp) return 'Unknown date';
        const diffMs = Date.now() - timestamp;
        const diffDays = Math.floor(diffMs / DAY_IN_MS);
        if (diffDays <= 0) return 'Today';
        if (diffDays === 1) return '1 day ago';
        if (diffDays < 7) return `${diffDays} days ago`;
        const diffWeeks = Math.floor(diffDays / 7);
        if (diffWeeks === 1) return '1 week ago';
        if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
        const diffMonths = Math.floor(diffDays / 30);
        if (diffMonths <= 1) return '1 month ago';
        return `${diffMonths} months ago`;
    }

    async restoreDeletedItem(textHash) {
        if (!textHash) return;
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'restoreDeletedItem',
                textHash
            });
            if (response?.success) {
                this.showNotification('Item restored to history', 'success');
                await this.loadDeletedItems();
                await this.loadStorageUsage();
                this.updateStorageUI();
            } else {
                this.showNotification(response?.error || 'Unable to restore item', 'error');
            }
        } catch (error) {
            console.error('Restore failed:', error);
            this.showNotification('Unable to restore item', 'error');
        }
    }

    async purgeDeletedItem(textHash) {
        if (!textHash) return;
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'purgeDeletedItem',
                textHash
            });
            if (response?.success) {
                this.showNotification('Item removed permanently', 'success');
                await this.loadDeletedItems();
            } else {
                this.showNotification(response?.error || 'Unable to remove item', 'error');
            }
        } catch (error) {
            console.error('Purge failed:', error);
            this.showNotification('Unable to remove item', 'error');
        }
    }

    tryAutoActivateFromUrl() {
        try {
            const query = window.location.search || window.location.hash.replace(/^#/, '?');
            const params = new URLSearchParams(query);
            const key = params.get('license') || params.get('key');
            if (!key) return;
            const input = document.getElementById('licenseKeyInput');
            if (input) {
                input.value = key;
                this.activateLicense();
            }
        } catch (error) {
            console.warn('Auto-activation from URL failed:', error);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        window.close();
    }
    
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.click();
    }
});
