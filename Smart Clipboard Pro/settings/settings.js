// Settings Page JavaScript
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const LEMON_SQUEEZY_CHECKOUT_URL = 'https://litextools.lemonsqueezy.com/buy/6455567f-8d64-461c-866c-c7661e0aba0e';
const LICENSE_FORMAT_HELP = 'XXXX-XXXX-XXXX-XXXX';

class SettingsManager {
    constructor() {
        this.settings = {
            theme: 'light',
            notifications: true,
            autoSync: false,
            autoBackup: false,
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
        this.premiumFeatureElements = [];
        this.deletedItemsVisible = false;
        
        this.init();
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

        this.updateUI();
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
        // Close button
        document.getElementById('closeBtn').addEventListener('click', () => {
            window.close();
        });
        
        // License activation
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
                    this.activateLicense();
                }
            });
            
            // Format license key as user types
            licenseInput.addEventListener('input', (e) => {
                let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                if (value.length > 16) {
                    value = value.substring(0, 16);
                }
                const formatted = value.match(/.{1,4}/g)?.join('-') || value;
                e.target.value = formatted;
            });
        }

        // Theme toggle
        const themeToggle = document.getElementById('darkTheme');
        themeToggle.checked = this.settings.theme === 'dark';
        themeToggle.addEventListener('change', (e) => {
            this.settings.theme = e.target.checked ? 'dark' : 'light';
            this.updateTheme();
            this.saveSettings();
        });

        // Notifications toggle
        const notificationsToggle = document.getElementById('notifications');
        notificationsToggle.checked = this.settings.notifications;
        notificationsToggle.addEventListener('change', (e) => {
            this.settings.notifications = e.target.checked;
            this.saveSettings();
        });





        // Data management
        document.getElementById('exportDataBtn').addEventListener('click', () => {
            this.exportData();
        });

        this.setPremiumControlsEnabled(false);

        document.getElementById('importDataBtn').addEventListener('click', () => {
            this.importData();
        });

        document.getElementById('clearAllBtn').addEventListener('click', () => {
            this.clearAllData();
        });

        document.getElementById('createBackupBtn').addEventListener('click', () => {
            this.createBackup();
        });

        const clearHistoryBtn = document.getElementById('clearHistoryBtn');
        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                this.clearHistory();
            });
        }

        // Footer actions
        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetToDefaults();
        });

        document.getElementById('saveBtn').addEventListener('click', () => {
            this.saveSettings();
        });

        // Import file input
        document.getElementById('importFileInput').addEventListener('change', (e) => {
            this.handleFileImport(e);
        });
        
        // Deleted items recovery
        const showDeletedBtn = document.getElementById('showDeletedBtn');
        const closeDeletedBtn = document.getElementById('closeDeletedBtn');
        const deletedItemsList = document.getElementById('deletedItemsList');
        
        if (showDeletedBtn) {
            showDeletedBtn.addEventListener('click', () => {
                this.deletedItemsVisible = !this.deletedItemsVisible;
                if (this.deletedItemsVisible) {
                    this.loadDeletedItems();
                    if (deletedItemsList) deletedItemsList.style.display = 'block';
                    showDeletedBtn.textContent = 'Hide Deleted Items';
                } else {
                    this.hideDeletedItemsList(showDeletedBtn, deletedItemsList);
                }
            });
        }
        
        if (closeDeletedBtn) {
            closeDeletedBtn.addEventListener('click', () => {
                this.hideDeletedItemsList(showDeletedBtn, deletedItemsList);
            });
        }
    }
    
    async loadDeletedItems() {
        const contentDiv = document.getElementById('deletedItemsContent');
        if (!contentDiv) return;
        
        this.setSafeContent(contentDiv, '<div class="loading">Loading deleted items...</div>');
        
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getDeletedItemsHistory'
            });
            
            const history = response?.history || [];
            
            if (history.length === 0) {
                this.setSafeContent(contentDiv, '<div class="empty-message">No deleted items found</div>');
                return;
            }
            
            this.setSafeContent(contentDiv, history.map(item => `
                <div class="deleted-item">
                    <div class="deleted-item-text">${this.escapeHtml(item.text.substring(0, 120))}${item.text.length > 120 ? '...' : ''}</div>
                    <div class="deleted-item-meta">
                        <span>Deleted: ${new Date(item.deletedAt).toLocaleString()}</span>
                        <div class="deleted-item-actions">
                            <button class="deleted-action-btn restore" data-action="restore" data-hash="${item.textHash}">Restore</button>
                            <button class="deleted-action-btn danger" data-action="purge" data-hash="${item.textHash}">Delete Forever</button>
                        </div>
                    </div>
                </div>
            `).join(''));
            
            contentDiv.querySelectorAll('.deleted-action-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const { action, hash } = e.target.dataset;
                    if (action === 'restore') {
                        await this.restoreDeletedItem(hash);
                    } else if (action === 'purge') {
                        await this.deleteDeletedItem(hash);
                    }
                });
            });
        } catch (error) {
            console.error('Error loading deleted items:', error);
            this.setSafeContent(contentDiv, '<div class="error-message">Error loading deleted items</div>');
        }
    }

    hideDeletedItemsList(triggerBtn, listElement) {
        this.deletedItemsVisible = false;
        if (listElement) {
            listElement.style.display = 'none';
        }
        if (triggerBtn) {
            triggerBtn.textContent = 'View Deleted Items';
        }
    }

    toggleHistoryClearButton(visible) {
        const btn = document.getElementById('clearHistoryBtn');
        if (!btn) return;
        btn.style.display = visible ? 'flex' : 'none';
        btn.disabled = !visible;
        btn.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    
    async restoreDeletedItem(textHash) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'restoreDeletedItem',
                textHash
            });
            
            if (response && response.success) {
                this.showNotification('Item restored successfully!', 'success');
                await this.loadDeletedItems();
            } else {
                this.showNotification('Failed to restore item', 'error');
            }
        } catch (error) {
            console.error('Error restoring item:', error);
            this.showNotification('Error restoring item', 'error');
        }
    }

    async deleteDeletedItem(textHash) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'purgeDeletedItem',
                textHash
            });
            
            if (response && response.success) {
                this.showNotification('Item removed permanently', 'success');
                await this.loadDeletedItems();
            } else {
                this.showNotification('Failed to delete item', 'error');
            }
        } catch (error) {
            console.error('Error deleting item permanently:', error);
            this.showNotification('Error deleting item', 'error');
        }
    }
    
    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }



    setupPremiumFeatures() {
        const autoSyncToggle = document.getElementById('autoSync');
        const autoBackupToggle = document.getElementById('autoBackup');
        const shortcutsToggle = document.getElementById('keyboardShortcuts');

        if (!this.premiumFeaturesInitialized) {
            if (autoSyncToggle) {
                autoSyncToggle.checked = this.settings.autoSync;
                autoSyncToggle.addEventListener('change', (e) => {
                    this.settings.autoSync = e.target.checked;
                    this.saveSettings();
                });
            }

            if (autoBackupToggle) {
                autoBackupToggle.checked = this.settings.autoBackup;
                autoBackupToggle.addEventListener('change', (e) => {
                    this.settings.autoBackup = e.target.checked;
                    this.saveSettings();
                });
            }

            if (shortcutsToggle) {
                shortcutsToggle.checked = this.settings.keyboardShortcuts;
                shortcutsToggle.addEventListener('change', (e) => {
                    this.settings.keyboardShortcuts = e.target.checked;
                    this.saveSettings();
                });
            }

            this.premiumFeaturesInitialized = true;
        } else {
            if (autoSyncToggle) autoSyncToggle.checked = this.settings.autoSync;
            if (autoBackupToggle) autoBackupToggle.checked = this.settings.autoBackup;
            if (shortcutsToggle) shortcutsToggle.checked = this.settings.keyboardShortcuts;
        }

        this.setPremiumControlsEnabled(true);
    }

    ensurePremiumFeatureElements() {
        if (this.premiumFeatureElements.length === 0) {
            this.premiumFeatureElements = Array.from(document.querySelectorAll('.premium-feature'));
            this.premiumFeatureElements.forEach(element => {
                element.dataset.premiumFeature = 'true';
            });
        }
    }

    setPremiumControlsEnabled(enabled) {
        const premiumControls = ['autoSync', 'autoBackup', 'keyboardShortcuts'];
        premiumControls.forEach(id => {
            const control = document.getElementById(id);
            if (control) {
                control.disabled = !enabled;
            }
        });

        const backupBtn = document.getElementById('createBackupBtn');
        if (backupBtn) {
            backupBtn.disabled = !enabled;
        }

        this.ensurePremiumFeatureElements();
        this.premiumFeatureElements.forEach(element => {
            if (element.dataset.premiumFeature === 'true') {
                element.classList.toggle('premium-feature', !enabled);
            }
        });
    }

    getPlanLabel(info) {
        if (!info) return 'Pro Access';
        if (info.planLabel) return info.planLabel;
        const type = (info.subscriptionType || '').toLowerCase();
        if (type.includes('30')) return '30-Day Pro Pass';
        if (type.includes('month')) return 'Monthly Subscription';
        if (type.includes('year')) return 'Yearly Subscription';
        if (type.includes('lifetime')) return 'Lifetime Access';
        return info.subscriptionId ? 'Subscription' : 'Pro Pass';
    }

    isLicenseActive() {
        if (!this.licenseInfo || !this.licenseInfo.activated) {
            return false;
        }
        if (this.licenseInfo.expiresAt && Date.now() > this.licenseInfo.expiresAt) {
            return false;
        }
        return true;
    }

    formatDate(timestamp, fallback = '\u2014') {
        if (!timestamp) return fallback;
        const date = new Date(timestamp);
        return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
    }

    formatDateTime(timestamp, fallback = '?') {
        if (!timestamp) return fallback;
        const date = new Date(timestamp);
        return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
    }

    getRemainingDaysLabel(expiresAt, enforceCountdown = true) {
        if (!expiresAt || !enforceCountdown) return '';
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            return 'expired';
        }
        const days = Math.floor(remainingMs / DAY_IN_MS);
        if (days >= 1) {
            return `${days} day${days === 1 ? '' : 's'} left`;
        }
        const hours = Math.ceil(remainingMs / (60 * 60 * 1000));
        return `${hours}h left`;
    }

    updateUI() {
        this.updateAnalyticsUI();
        this.updateStorageUsageUI();
        this.updateTheme();
        this.updateLicenseUI();
    }
    
    updateLicenseUI() {
        const statusDiv = document.getElementById('licenseStatus');
        const messageDiv = document.getElementById('licenseMessage');
        
        if (!statusDiv) return;
        this.toggleHistoryClearButton(false);

        if (!this.licenseStatusLoaded) {
            this.setSafeContent(statusDiv, `
                <div class="status-loading" role="status">
                    <span class="loading-spinner" aria-hidden="true"></span>
                    <span>Checking license status...</span>
                </div>
            `);
            if (messageDiv) {
                messageDiv.textContent = 'Checking license status...';
                messageDiv.className = 'license-message info';
            }
            this.toggleHistoryClearButton(false);
            return;
        }

        if (this.licenseLoadError) {
            this.setSafeContent(statusDiv, `
                <div class="license-inactive">
                    <div class="status-icon" aria-hidden="true">&#9888;</div>
                    <div class="status-details">
                        <strong>Unable to verify license</strong>
                        <p>${this.licenseLoadError}</p>
                        <p>You can still enter your Lemon Squeezy license key below.</p>
                    </div>
                </div>
            `);
            if (messageDiv) {
                messageDiv.textContent = this.licenseLoadError;
                messageDiv.className = 'license-message warning';
            }
            this.updateSubscriptionExpiry('Not available');
            this.updateExpiryIndicator('');
            this.setPremiumControlsEnabled(false);
            this.toggleHistoryClearButton(false);
            return;
        }

        const hasLicense = Boolean(this.licenseInfo);
        const isActive = this.isLicenseActive();
        
        if (isActive) {
            const planLabel = this.escapeHtml(this.getPlanLabel(this.licenseInfo));
            const productName = this.escapeHtml(this.licenseInfo.productName || 'Smart Clipboard Pro');
            const activatedOn = this.formatDateTime(this.licenseInfo.activatedAt, 'recently');
            const lastVerified = this.formatDateTime(this.licenseInfo.lastVerifiedAt, 'recently');
            const subscriptionType = String(this.licenseInfo.subscriptionType || '').toLowerCase();
            const isSubscriptionPlan = Boolean(
                this.licenseInfo.subscriptionId ||
                subscriptionType.includes('subscription') ||
                subscriptionType.includes('month')
            );
            const remainingLabel = this.getRemainingDaysLabel(this.licenseInfo.expiresAt, isSubscriptionPlan);
            const renewalText = isSubscriptionPlan
                ? (this.licenseInfo.subscriptionCancelled
                    ? `Access until: ${this.formatDateTime(this.licenseInfo.expiresAt, 'end of current period')}${remainingLabel ? ` (${remainingLabel})` : ''}`
                    : `Next renewal: ${this.formatDateTime(this.licenseInfo.nextChargeAt, 'scheduled by Lemon Squeezy')}`)
                : `Expires on: ${this.formatDateTime(this.licenseInfo.expiresAt, '30 days from activation')}${remainingLabel ? ` (${remainingLabel})` : ''}`;
            const emailLine = this.licenseInfo.purchaser?.email
                ? `<p>Billing email: ${this.escapeHtml(this.licenseInfo.purchaser.email)}</p>`
                : '';
            const featureCount = this.licenseInfo.features?.length || 0;
            const showCountdown = isSubscriptionPlan && remainingLabel;
            const expiryLine = showCountdown
                ? `<p class="license-expiry">Access: <span class="remaining">${remainingLabel}</span></p>`
                : '';
            const expirySummary = this.licenseInfo.expiresAt
                ? `${this.formatDateTime(this.licenseInfo.expiresAt)}${remainingLabel ? ` (${remainingLabel})` : ''}`
                : (isSubscriptionPlan && this.licenseInfo.nextChargeAt
                    ? `Renews ${this.formatDateTime(this.licenseInfo.nextChargeAt)}`
                    : 'Active access');

            this.setSafeContent(statusDiv, `
                <div class="license-active">
                    <div class="status-icon" aria-hidden="true">&#x2705;</div>
                    <div class="status-details">
                        <strong>${planLabel} &mdash; ${productName}</strong>
                        <p>Activated on: ${activatedOn}</p>
                        <p>${renewalText}</p>
                        ${expiryLine}
                        <p>Features unlocked: ${featureCount}</p>
                        ${emailLine}
                    </div>
                </div>
            `);
            this.updateExpiryIndicator(showCountdown ? `Access: ${remainingLabel}` : '');
            this.updateSubscriptionExpiry(expirySummary);
            if (messageDiv) {
                const expiresNote = this.licenseInfo.expiresAt
                    ? `Access ends ${this.formatDateTime(this.licenseInfo.expiresAt)}${remainingLabel ? ` (${remainingLabel})` : ''}. `
                    : '';
                if (this.licenseInfo.subscriptionCancelled) {
                    messageDiv.textContent = `${expiresNote}Subscription will end after the current billing cycle.`;
                    messageDiv.className = 'license-message warning';
                } else {
                    messageDiv.textContent = `${expiresNote}Last verified on ${lastVerified}.`;
                    messageDiv.className = 'license-message success';
                }
            }
            this.setupPremiumFeatures();
            this.toggleHistoryClearButton(true);
            return;
        }

        if (hasLicense) {
            const expiredOn = this.formatDateTime(this.licenseInfo.expiresAt, 'recently');
            this.setSafeContent(statusDiv, `
                <div class="license-inactive">
                    <div class="status-icon" aria-hidden="true">&#9888;</div>
                    <div class="status-details">
                        <strong>License Inactive</strong>
                        <p>Your previous ${this.escapeHtml(this.getPlanLabel(this.licenseInfo))} expired on ${expiredOn}.</p>
                        <p>Please renew your Lemon Squeezy subscription or purchase a new 30-day pass.</p>
                    </div>
                </div>
            `);
            this.updateExpiryIndicator(this.licenseInfo.expiresAt
                ? `Expired on ${this.formatDateTime(this.licenseInfo.expiresAt)}`
                : '');
            const expiredSummary = this.licenseInfo.expiresAt
                ? `${this.formatDateTime(this.licenseInfo.expiresAt)} (expired)`
                : 'Expired';
            this.updateSubscriptionExpiry(expiredSummary);
            if (messageDiv) {
                messageDiv.textContent = 'License expired or deactivated. Enter a new key to regain Pro access.';
                messageDiv.className = 'license-message error';
            }
            this.setPremiumControlsEnabled(false);
            this.toggleHistoryClearButton(false);
            return;
        }

        this.setSafeContent(statusDiv, `
            <div class="license-inactive">
                <div class="status-icon" aria-hidden="true">&#128274;</div>
                <div class="status-details">
                    <strong>License Not Activated</strong>
                    <p>Activate your license to access all Pro features</p>
                    <p><a href="${LEMON_SQUEEZY_CHECKOUT_URL}" target="_blank">Purchase subscription &#128722;</a></p>
                </div>
            </div>
        `);
        this.updateSubscriptionExpiry('Not activated');
        this.updateExpiryIndicator('');
        if (messageDiv) {
            messageDiv.textContent = `Enter the license key from your Lemon Squeezy receipt (format: ${LICENSE_FORMAT_HELP}).`;
            messageDiv.className = 'license-message info';
        }
        this.setPremiumControlsEnabled(false);
        this.toggleHistoryClearButton(false);
    }

    updateExpiryIndicator(text = '') {
        const indicator = document.getElementById('licenseExpiryIndicator');
        if (!indicator) return;
        indicator.textContent = text;
        indicator.style.display = text ? 'block' : 'none';
    }

    updateSubscriptionExpiry(text = '') {
        const target = document.getElementById('subscriptionExpiryValue');
        if (!target) return;
        target.textContent = text || 'Not available';
    }
    async activateLicense() {
        const licenseInput = document.getElementById('licenseKeyInput');
        const activateBtn = document.getElementById('activateLicenseBtn');
        const messageDiv = document.getElementById('licenseMessage');
        
        if (!licenseInput || !activateBtn) return;
        
        const cleanedKey = licenseInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        
        if (!cleanedKey || cleanedKey.length !== 16) {
            if (messageDiv) {
                messageDiv.textContent = 'Please enter a valid 16-character license key';
                messageDiv.className = 'license-message error';
            }
            return;
        }
        
        // Format back for display
        const formattedKey = cleanedKey.match(/.{1,4}/g)?.join('-') || cleanedKey;
        licenseInput.value = formattedKey;
        
        activateBtn.disabled = true;
        activateBtn.textContent = 'Activating...';
        
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'verifyLicense',
                licenseKey: formattedKey
            });
            
            if (response && response.valid) {
                this.licenseInfo = response.licenseInfo;
                this.licenseLoadError = null;
                this.licenseStatusLoaded = true;
                this.updateLicenseUI();
                if (messageDiv) {
                    messageDiv.textContent = 'License activated successfully!';
                    messageDiv.className = 'license-message success';
                }
                licenseInput.value = '';
                this.showNotification('License activated successfully!', 'success');
            } else {
                if (messageDiv) {
                    messageDiv.textContent = response?.error || 'Invalid license key';
                    messageDiv.className = 'license-message error';
                }
                this.showNotification('Activation failed: ' + (response?.error || 'Invalid key'), 'error');
            }
        } catch (error) {
            console.error('Error activating license:', error);
            if (messageDiv) {
                messageDiv.textContent = 'Error during activation';
                messageDiv.className = 'license-message error';
            }
            this.showNotification('Error during activation', 'error');
        } finally {
            activateBtn.disabled = false;
            activateBtn.textContent = 'Activate License';
        }
    }

    updateAnalyticsUI() {
        // Analytics are now available for all users
        document.getElementById('totalCopies').textContent = this.analytics.totalCopies.toLocaleString();
        document.getElementById('totalPins').textContent = this.analytics.totalPins.toLocaleString();
        document.getElementById('totalSnippets').textContent = this.analytics.totalSnippets.toLocaleString();
        const timeSavedMinutes = Math.round(this.analytics.timeSaved || 0);
        const hours = Math.floor(timeSavedMinutes / 60);
        const minutes = timeSavedMinutes % 60;
        const formatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        document.getElementById('timeSaved').textContent = formatted;
        
        // Hide upgrade prompts
        const analyticsUpgrade = document.getElementById('analyticsUpgrade');
        if (analyticsUpgrade) {
            analyticsUpgrade.style.display = 'none';
        }
    }

    updateStorageUsageUI() {
        const { historyBytes, pinnedBytes, snippetsBytes, totalBytes } = this.storageUsage;
        const historyEl = document.getElementById('storageHistory');
        const pinnedEl = document.getElementById('storagePinned');
        const snippetsEl = document.getElementById('storageSnippets');
        const totalEl = document.getElementById('storageTotal');
        const footnoteEl = document.getElementById('storageFootnote');

        if (historyEl) historyEl.textContent = this.formatBytes(historyBytes);
        if (pinnedEl) pinnedEl.textContent = this.formatBytes(pinnedBytes);
        if (snippetsEl) snippetsEl.textContent = this.formatBytes(snippetsBytes);
        if (totalEl) totalEl.textContent = this.formatBytes(totalBytes);
        if (footnoteEl) {
            const kb = Math.max(1, Math.round(totalBytes / 1024));
            footnoteEl.textContent = `~${kb} KB used inside the extension`;
        }
    }

    formatBytes(bytes = 0) {
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(1)} KB`;
        const mb = kb / 1024;
        return `${mb.toFixed(2)} MB`;
    }

    updateTheme() {
        document.body.className = `theme-${this.settings.theme}`;
    }




    async exportData() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'exportData'
            });

            if (response && response.data) {
                const dataStr = JSON.stringify(response.data, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                
                const a = document.createElement('a');
                a.href = url;
                a.download = `smart-clipboard-backup-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                this.showNotification('Data exported successfully!', 'success');
            }
        } catch (error) {
            console.error('Error exporting data:', error);
            this.showNotification('Error exporting data', 'error');
        }
    }

    importData() {
        document.getElementById('importFileInput').click();
    }

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            const response = await chrome.runtime.sendMessage({
                action: 'importData',
                data: data
            });

            if (response && response.success) {
                this.showNotification('Data imported successfully!', 'success');
                await this.loadAnalytics();
                await this.loadStorageUsage();
                this.updateAnalyticsUI();
                this.updateStorageUsageUI();
            } else {
                this.showNotification('Error importing data', 'error');
            }
        } catch (error) {
            console.error('Error importing data:', error);
            this.showNotification('Invalid file format', 'error');
        }

        // Reset file input
        event.target.value = '';
    }

    async clearAllData() {
        if (!confirm('Are you sure you want to clear all data? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await chrome.runtime.sendMessage({
                action: 'clearAllData'
            });

            if (response && response.success) {
                this.showNotification('All data cleared successfully!', 'success');
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
                this.updateAnalyticsUI();
                this.updateStorageUsageUI();
            }
        } catch (error) {
            console.error('Error clearing data:', error);
            this.showNotification('Error clearing data', 'error');
        }
    }

    async clearHistory() {
        if (!this.isLicenseActive()) {
            this.showNotification('This feature requires an active Pro plan.', 'error');
            return;
        }
        if (!confirm('Clear all clipboard history items? This action cannot be undone.')) {
            return;
        }
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'clearClipboardHistory'
            });

            if (response && response.success) {
                this.showNotification('Clipboard history cleared!', 'success');
            } else {
                this.showNotification('Unable to clear history', 'error');
            }
        } catch (error) {
            console.error('Error clearing history:', error);
            this.showNotification('Error clearing history', 'error');
        }
    }

    async createBackup() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'createBackup'
            });

            if (response && response.success) {
                this.showNotification('Backup created successfully!', 'success');
            } else {
                this.showNotification('Error creating backup', 'error');
            }
        } catch (error) {
            console.error('Error creating backup:', error);
            this.showNotification('Error creating backup', 'error');
        }
    }

    resetToDefaults() {
        if (!confirm('Reset all settings to default values?')) {
            return;
        }

        this.settings = {
            theme: 'light',
            notifications: true,
            autoSync: false,
            autoBackup: false,
            keyboardShortcuts: true,
            autoSave: true
        };

        // Update UI
        document.getElementById('darkTheme').checked = false;
        document.getElementById('notifications').checked = true;
        document.getElementById('autoSync').checked = false;
        document.getElementById('autoBackup').checked = false;
        document.getElementById('keyboardShortcuts').checked = false;

        this.updateTheme();
        this.saveSettings();
        this.showNotification('Settings reset to defaults', 'success');
    }

    async saveSettings() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: this.settings
            });

            if (response && response.success) {
                this.showNotification('Settings saved!', 'success');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showNotification('Error saving settings', 'error');
        }
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
}

// Initialize settings manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
});

// Handle keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Escape key to close
    if (e.key === 'Escape') {
        window.close();
    }
    
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        document.getElementById('saveBtn').click();
    }
});
