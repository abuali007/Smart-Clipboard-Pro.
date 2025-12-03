// Smart Clipboard Pro Enhanced - Background Script v5.2
// ====================================================

// Constants
const MAX_HISTORY_ITEMS_FREE = 50; // Free users: 50 items
const MAX_HISTORY_ITEMS_PRO = Number.MAX_SAFE_INTEGER; // Pro users: unlimited history
const MAX_PINNED_ITEMS_FREE = 10; // Free users: 10 items
const MAX_PINNED_ITEMS_PRO = 20; // Pro users: 20 items
const MAX_SNIPPETS_FREE = 10; // Free users: 10 snippets
const MAX_SNIPPETS_PRO = 1000; // Effectively unlimited for Pro
const CLIPBOARD_CHECK_INTERVAL = 2000; // 2 seconds
const DEFAULT_PAGE_SIZE = 100;
const AVERAGE_CHARS_PER_MINUTE = 900;
const LICENSE_PATTERN = /^([A-Z0-9]{8}-){3}[A-Z0-9]{8}$/i;
const PRO_FEATURES = ['unlimited_history', 'snippets', 'auto_backup', 'analytics'];
const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
const GUMROAD_PRODUCT_PERMALINK = 'imwysv';
const GUMROAD_PRODUCT_ID = 'Ns8Qs-C4WnNA4Mhsn8SkMA=='; // replace with your product's API ID if different
const LICENSE_API_BASE_URL = ''; // Not used when calling Gumroad directly
const LICENSE_API_VERIFY_PATH = '/api/verify-license';
const LICENSE_API_SYNC_PATH = '/api/license/sync';
const LICENSE_API_ENDPOINTS = Object.freeze({
    verify: LICENSE_API_VERIFY_PATH,
    sync: LICENSE_API_SYNC_PATH
});
const LICENSE_API_ALLOWED_PATHS = new Set(Object.values(LICENSE_API_ENDPOINTS));
const LICENSE_API_TIMEOUT_MS = 10000;
const LICENSE_BACKOFF_RETRIES = 3;
const LICENSE_BACKOFF_BASE_MS = 750;
const LICENSE_REFRESH_INTERVAL_MINUTES = 360; // every 6 hours
const LICENSE_REFRESH_ALARM = 'licenseRefresh';
const LICENSE_SYNC_ALARM = 'licenseSync';
const SUBSCRIPTION_RENEWAL_ALARM = 'subscriptionRenewalCheck';
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const BLACKLIST_TTL_DAYS = 90;
const BLACKLIST_TTL_MS = BLACKLIST_TTL_DAYS * DAY_IN_MS;
const BLACKLIST_MAX_ENTRIES = 2000;
const BLACKLIST_CACHE_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_LICENSE_DURATION_DAYS = 30;
const LICENSE_GRACE_PERIOD_DAYS = 7;
const LICENSE_GRACE_PERIOD_MS = LICENSE_GRACE_PERIOD_DAYS * DAY_IN_MS;
const MAX_LICENSE_ACTIVATIONS = 1;
const ACTIVATION_DURATION_MS = DEFAULT_LICENSE_DURATION_DAYS * DAY_IN_MS;
const ACTION_STATUS_BADGE = {
    ACTIVE: {
        text: 'ON',
        color: '#16a34a',
        title: 'Smart Clipboard Pro: Auto-save enabled'
    },
    INACTIVE: {
        text: 'OFF',
        color: '#dc2626',
        title: 'Smart Clipboard Pro: Auto-save paused'
    }
};

const OFFSCREEN_PING_RETRIES = 5;
const OFFSCREEN_PING_DELAY_MS = 250;
const SUPPORTS_OFFSCREEN_DOCUMENT = Boolean(chrome.offscreen?.createDocument);

// Global variables
let lastClipboardContent = '';
let offscreenDocumentCreated = false;
let clipboardMonitoringActive = false;
let blacklistCache = {
    entries: [],
    set: new Set(),
    legacySet: new Set(),
    loadedAt: 0
};
const operationLocks = new Map();
let cachedLicenseStateSecret = null;

try {
    if (typeof importScripts === 'function') {
        importScripts('db.js');
    }
} catch (error) {
    console.warn('Failed to import db.js:', error);
}

// License/Activation system
const LICENSE_STORAGE_KEY = 'licenseInfo';
const LICENSE_SYNC_CACHE_KEY = 'syncedLicenseSnapshot';
const ACTIVATION_REGISTRY_SYNC_KEY = 'activationRegistryV1';
const ACTIVATION_REGISTRY_CACHE_KEY = 'activationRegistryCache';
const DEVICE_FINGERPRINT_KEY = 'deviceFingerprintV1';
const LICENSE_STATE_SIGNATURE_KEY = 'licenseSignatureV1';
const LICENSE_STATE_SECRET_STORAGE_KEY = `licenseStateSecret_${(chrome?.runtime?.id || 'default')}`;
const ACTIVATION_REGISTRY_LOCK_KEY = 'activationRegistryLock';
const ACTIVATION_LOCK_TIMEOUT_MS = 8000;
const ACTIVATION_LOCK_RETRY_MS = 150;
const DELETED_ITEMS_BLACKLIST_KEY = 'deletedItemsBlacklist';
const OPERATION_LOCK_KEY = 'operationLocks';
const ANALYTICS_SCHEMA_VERSION = 2;

const getDefaultAnalytics = () => ({
    totalCopies: 0,
    totalPins: 0,
    totalSnippets: 0,
    timeSaved: 0,
    charactersPasted: 0,
    schemaVersion: ANALYTICS_SCHEMA_VERSION
});

async function mutateAnalytics(mutator) {
    const data = await chrome.storage.local.get(['analytics']);
    const analytics = { ...getDefaultAnalytics(), ...(data.analytics || {}) };
    await mutator(analytics);
    analytics.timeSaved = analytics.timeSaved || calculateTimeSavedMinutes(analytics.charactersPasted);
    await chrome.storage.local.set({ analytics });
    return analytics;
}

function calculateTimeSavedMinutes(characters = 0) {
    if (!characters) return 0;
    return Math.round(characters / AVERAGE_CHARS_PER_MINUTE);
}

function sendRuntimeMessage(message) {
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

function delay(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary);
}

function base64ToUint8Array(value) {
    const binary = atob(value || '');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function hashString(input, encoding = 'hex') {
    if (!input && input !== 0) return null;
    const data = new TextEncoder().encode(String(input));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    if (encoding === 'base64') {
        return bufferToBase64(hashBuffer);
    }
    return bufferToHex(hashBuffer);
}

async function getLicenseStateSecret() {
    if (cachedLicenseStateSecret) {
        return cachedLicenseStateSecret;
    }
    try {
        const stored = await chrome.storage.local.get([LICENSE_STATE_SECRET_STORAGE_KEY]);
        if (stored[LICENSE_STATE_SECRET_STORAGE_KEY]) {
            cachedLicenseStateSecret = stored[LICENSE_STATE_SECRET_STORAGE_KEY];
            return cachedLicenseStateSecret;
        }
    } catch (error) {
        console.warn('Failed to read license secret from storage:', error);
    }
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = bufferToBase64(randomBytes);
    cachedLicenseStateSecret = secret;
    try {
        await chrome.storage.local.set({ [LICENSE_STATE_SECRET_STORAGE_KEY]: secret });
    } catch (error) {
        console.warn('Failed to persist license secret:', error);
    }
    return secret;
}

async function getLicenseStateKeyMaterial(deviceFingerprint) {
    const secret = await getLicenseStateSecret();
    return new TextEncoder().encode(`${secret}:${deviceFingerprint}`);
}

function legacyTextHash(text) {
    let hash = 0;
    const normalizedText = String(text || '').trim().toLowerCase();
    for (let i = 0; i < normalizedText.length; i++) {
        const char = normalizedText.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

async function computeTextFingerprints(text) {
    if (!text) return null;
    const normalized = String(text).trim();
    if (!normalized) return null;
    const primary = await hashString(normalized, 'hex');
    const legacy = legacyTextHash(normalized);
    return { primary, legacy };
}

function getCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
    if (typeof crypto !== 'undefined') return crypto;
    return null;
}

function generateSecureToken(byteLength = 16) {
    const cryptoObj = getCrypto();
    if (typeof cryptoObj?.randomUUID === 'function') {
        return cryptoObj.randomUUID();
    }
    if (typeof cryptoObj?.getRandomValues === 'function') {
        const bytes = cryptoObj.getRandomValues(new Uint8Array(byteLength));
        return bufferToHex(bytes);
    }
    throw new Error('Secure random generator not available');
}

function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const lenA = a.length;
    const lenB = b.length;
    let mismatch = lenA ^ lenB;
    const maxLen = Math.max(lenA, lenB);
    for (let i = 0; i < maxLen; i++) {
        const codeA = i < lenA ? a.charCodeAt(i) : 0;
        const codeB = i < lenB ? b.charCodeAt(i) : 0;
        mismatch |= codeA ^ codeB;
    }
    return mismatch === 0;
}

function secureRandomFraction() {
    const cryptoObj = getCrypto();
    if (typeof cryptoObj?.getRandomValues !== 'function') {
        throw new Error('Secure random generator not available');
    }
    const bytes = cryptoObj.getRandomValues(new Uint32Array(1));
    return bytes[0] / 0x100000000;
}

function generateStableId() {
    const randomPart = generateSecureToken(12).replace(/-/g, '');
    return `${Date.now().toString(36)}-${randomPart}`;
}

async function ensureClipboardDB() {
    if (!self.clipboardDB) {
        throw new Error('IndexedDB helper not available');
    }
    await self.clipboardDB.init();
    return self.clipboardDB;
}

async function withExponentialBackoff(operation, options = {}) {
    const {
        retries = LICENSE_BACKOFF_RETRIES,
        baseDelay = LICENSE_BACKOFF_BASE_MS,
        maxDelay = 8000
    } = options;
    let attempt = 0;
    let lastError = null;
    while (attempt <= retries) {
        try {
            // eslint-disable-next-line no-await-in-loop
            return await operation(attempt);
        } catch (error) {
            lastError = error;
            if (attempt === retries) break;
            const jitter = secureRandomFraction() * 0.25 + 0.75;
            const delayMs = Math.min(maxDelay, baseDelay * Math.pow(2, attempt)) * jitter;
            // eslint-disable-next-line no-await-in-loop
            await delay(Math.round(delayMs));
        }
        attempt += 1;
    }
    throw lastError || new Error('Operation failed');
}

function getPlatformInfo() {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.getPlatformInfo((info) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(info || {});
            });
        } catch (error) {
            reject(error);
        }
    });
}

async function getDeviceFingerprint() {
    try {
        const cached = await chrome.storage.local.get([DEVICE_FINGERPRINT_KEY]);
        if (cached && cached[DEVICE_FINGERPRINT_KEY]) {
            return cached[DEVICE_FINGERPRINT_KEY];
        }
    } catch (error) {
        console.warn('Unable to read cached fingerprint:', error);
    }
    const platform = await getPlatformInfo().catch(() => ({}));
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    const seed = [
        navigator.userAgent || 'unknown',
        platform.os || 'unknown_os',
        platform.arch || 'unknown_arch',
        platform.nacl_arch || 'unknown_nacl',
        timezone
    ].join('|');
    const fingerprint = await hashString(seed);
    try {
        await chrome.storage.local.set({ [DEVICE_FINGERPRINT_KEY]: fingerprint });
    } catch (error) {
        console.warn('Unable to persist device fingerprint:', error);
    }
    return fingerprint;
}

function buildLicenseSignaturePayload(licenseInfo, deviceFingerprint) {
    const copy = { ...(licenseInfo || {}) };
    delete copy.signature;
    return JSON.stringify({
        license: copy,
        deviceFingerprint
    });
}

async function signLicenseState(licenseInfo, deviceFingerprint) {
    const payload = buildLicenseSignaturePayload(licenseInfo, deviceFingerprint);
    const keyMaterial = await getLicenseStateKeyMaterial(deviceFingerprint);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign', 'verify']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
    return bufferToBase64(signatureBuffer);
}

async function verifyLicenseSignature(licenseInfo) {
    if (!licenseInfo) {
        return { valid: false, reason: 'missing_license' };
    }
    const deviceFingerprint = await getDeviceFingerprint();
    const signature = licenseInfo.signature || null;
    if (!signature) {
        return { valid: false, reason: 'missing_signature', deviceFingerprint };
    }
    const payload = buildLicenseSignaturePayload(licenseInfo, deviceFingerprint);
    const keyMaterial = await getLicenseStateKeyMaterial(deviceFingerprint);
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyMaterial,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
    );
    const isValid = await crypto.subtle.verify(
        'HMAC',
        cryptoKey,
        base64ToUint8Array(signature),
        new TextEncoder().encode(payload)
    );
    return { valid: isValid, deviceFingerprint };
}

async function applyLicenseSignature(licenseInfo) {
    const deviceFingerprint = await getDeviceFingerprint();
    const signature = await signLicenseState(licenseInfo, deviceFingerprint);
    return { ...licenseInfo, deviceFingerprint, signature };
}

async function getLicenseCryptoKey(deviceFingerprint) {
    const material = await getLicenseStateKeyMaterial(deviceFingerprint);
    return crypto.subtle.importKey(
        'raw',
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptLicenseKey(key, deviceFingerprint) {
    const cryptoKey = await getLicenseCryptoKey(deviceFingerprint);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(key);
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);
    return {
        cipher: bufferToBase64(cipherBuffer),
        iv: bufferToBase64(iv)
    };
}

async function decryptLicenseKey(cipher, iv, deviceFingerprint) {
    if (!cipher || !iv) return null;
    const cryptoKey = await getLicenseCryptoKey(deviceFingerprint);
    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToUint8Array(iv) },
        cryptoKey,
        base64ToUint8Array(cipher)
    );
    return new TextDecoder().decode(plainBuffer);
}

async function acquireOperationLock(key, timeoutMs = 5000) {
    const start = Date.now();
    while (operationLocks.has(key)) {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Operation lock timeout: ${key}`);
        }
        // eslint-disable-next-line no-await-in-loop
        await delay(10);
    }
    operationLocks.set(key, Date.now());
}

function releaseOperationLock(key) {
    operationLocks.delete(key);
}

async function getAutoSavePreference() {
    try {
        const data = await chrome.storage.local.get(['settings']);
        const settings = data.settings || {};
        return settings.autoSave !== false;
    } catch (error) {
        console.error('Failed to read auto-save preference:', error);
        return true;
    }
}

async function updateActionStatusBadge(forceState = null) {
    try {
        const isActive = typeof forceState === 'boolean' ? forceState : await getAutoSavePreference();
        const badgeConfig = isActive ? ACTION_STATUS_BADGE.ACTIVE : ACTION_STATUS_BADGE.INACTIVE;
        await chrome.action.setBadgeText({ text: badgeConfig.text });
        await chrome.action.setBadgeBackgroundColor({ color: badgeConfig.color });
        await chrome.action.setTitle({ title: badgeConfig.title });
    } catch (error) {
        console.error('Failed to update toolbar status badge:', error);
    }
}

// Initialize extension
chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('Smart Clipboard Pro Enhanced v5.0 - Installed/Updated');
    
    if (details.reason === 'install') {
        try {
            chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
        } catch (error) {
            console.warn('Failed to open onboarding page:', error);
        }
    }
    
    // Initialize storage
    const data = await chrome.storage.local.get([
        'clipboardHistory', 'pinnedItems', 'settings'
    ]);
    
    const updates = {};
    if (!data.clipboardHistory) updates.clipboardHistory = [];
    if (!data.pinnedItems) updates.pinnedItems = [];
    if (!data.settings) updates.settings = {
        autoSave: true,
        notifications: true,
        maxItems: MAX_HISTORY_ITEMS_FREE
    };
    
    if (Object.keys(updates).length > 0) {
        await chrome.storage.local.set(updates);
    }
    
    // Create context menus
    createContextMenus();
    
    // Start clipboard monitoring
    startClipboardMonitoring();

    await bootstrapLicenseFromSync();
    scheduleLicenseRefreshAlarm();
    scheduleLicenseSyncAlarm();
    scheduleSubscriptionRenewalAlarm();
    scheduleEngagementAlarm();
    cleanupBlacklistEntries().catch(() => {});
    await refreshLicenseStatus(true);
    await updateActionStatusBadge();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('Smart Clipboard Pro Enhanced v5.0 - Startup');
    createContextMenus();
    startClipboardMonitoring();
    await bootstrapLicenseFromSync();
    scheduleLicenseRefreshAlarm();
    scheduleLicenseSyncAlarm();
    scheduleSubscriptionRenewalAlarm();
    scheduleEngagementAlarm();
    cleanupBlacklistEntries().catch(() => {});
    await refreshLicenseStatus();
    await updateActionStatusBadge();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.settings) return;
    const nextSettings = changes.settings.newValue || {};
    const isActive = nextSettings.autoSave !== false;
    updateActionStatusBadge(isActive);
});

// Create context menus
function createContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "copyToClipboard",
            title: "Save selection to Smart Clipboard",
            contexts: ["selection"]
        });
        
        chrome.contextMenus.create({
            id: "pasteFromClipboard",
            title: "Paste from Smart Clipboard 📄",
            contexts: ["editable"]
        });
        
        chrome.contextMenus.create({
            id: "openClipboard",
            title: "Open Clipboard Manager 🔧",
            contexts: ["all"]
        });
    });
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    switch (info.menuItemId) {
        case "copyToClipboard":
            if (info.selectionText) {
                await addToClipboardHistory(info.selectionText.trim());
                showNotification('Copied', 'Text saved to Smart Clipboard');
            }
            break;
            
        case "pasteFromClipboard":
            await showQuickPasteMenu(tab);
            break;
            
        case "openClipboard":
            chrome.action.openPopup();
            break;
    }
});

// Show quick paste menu
async function showQuickPasteMenu(tab) {
    try {
        const data = await chrome.storage.local.get(['clipboardHistory']);
        const history = data.clipboardHistory || [];
        
        if (history.length === 0) {
            showNotification('Clipboard Empty', 'No items saved in clipboard');
            return;
        }
        
        // Inject quick paste script
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: createQuickPasteMenu,
            args: [history.slice(0, 5)] // Show only first 5 items
        });
    } catch (error) {
        console.error('Error showing quick paste menu:', error);
    }
}

// Function to inject into page for quick paste
function createQuickPasteMenu(items) {
    // Remove existing menu
    const existing = document.getElementById('smart-clipboard-menu');
    if (existing) existing.remove();
    
    // Create menu
    const menu = document.createElement('div');
    menu.id = 'smart-clipboard-menu';
    menu.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        border: 2px solid #667eea;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 400px;
        max-height: 300px;
        overflow-y: auto;
        font-family: Arial, sans-serif;
    `;
    
    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        background: #667eea;
        color: white;
        padding: 10px;
        font-weight: bold;
        text-align: center;
        position: relative;
    `;
    header.textContent = 'Smart Clipboard';
    
    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = `
        position: absolute;
        right: 10px;
        top: 50%;
        transform: translateY(-50%);
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
    `;
    closeBtn.onclick = () => menu.remove();
    header.appendChild(closeBtn);
    
    menu.appendChild(header);
    
    // Items
    items.forEach((item, index) => {
        const itemDiv = document.createElement('div');
        itemDiv.style.cssText = `
            padding: 10px;
            border-bottom: 1px solid #eee;
            cursor: pointer;
            transition: background 0.2s;
        `;
        itemDiv.onmouseover = () => itemDiv.style.background = '#f0f0f0';
        itemDiv.onmouseout = () => itemDiv.style.background = 'white';
        
        const text = item.text.length > 50 ? item.text.substring(0, 50) + '...' : item.text;
        itemDiv.textContent = text;
        
        itemDiv.onclick = async () => {
            // Copy to clipboard and paste
            await navigator.clipboard.writeText(item.text);
            
            // Find active element and paste
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                activeElement.value = item.text;
                activeElement.dispatchEvent(new Event('input', { bubbles: true }));
            }
            
            menu.remove();
        };
        
        menu.appendChild(itemDiv);
    });
    
    document.body.appendChild(menu);
    
    // Auto-remove after 10 seconds
    setTimeout(() => {
        if (menu.parentNode) menu.remove();
    }, 10000);
}

// Start clipboard monitoring
async function startClipboardMonitoring() {
    if (clipboardMonitoringActive) return;

    if (!SUPPORTS_OFFSCREEN_DOCUMENT) {
        console.warn('Offscreen documents are not supported in this browser; clipboard monitoring is disabled.');
        return;
    }
    
    try {
        await createOffscreenDocument();
        clipboardMonitoringActive = true;
        
        // Set up periodic checking
        chrome.alarms.create('clipboardCheck', {
            delayInMinutes: 0,
            periodInMinutes: 0.033 // ~2 seconds
        });
        
        console.log('Clipboard monitoring started');
    } catch (error) {
        console.error('Failed to start clipboard monitoring:', error);
    }
}

function scheduleLicenseRefreshAlarm() {
    chrome.alarms.create(LICENSE_REFRESH_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: LICENSE_REFRESH_INTERVAL_MINUTES
    });
}

function scheduleLicenseSyncAlarm() {
    if (!isLicenseApiConfigured()) return;
    chrome.alarms.create(LICENSE_SYNC_ALARM, {
        delayInMinutes: 10,
        periodInMinutes: LICENSE_REFRESH_INTERVAL_MINUTES
    });
}

function scheduleSubscriptionRenewalAlarm() {
    if (!isLicenseApiConfigured()) return;
    chrome.alarms.create(SUBSCRIPTION_RENEWAL_ALARM, {
        delayInMinutes: 15,
        periodInMinutes: 24 * 60
    });
}

function scheduleEngagementAlarm() {
    chrome.alarms.create('engagementCheck', {
        delayInMinutes: 10,
        periodInMinutes: 24 * 60
    });
}

// Create offscreen document
async function createOffscreenDocument() {
    if (!SUPPORTS_OFFSCREEN_DOCUMENT) {
        throw new Error('Offscreen documents are not supported in this browser');
    }
    if (offscreenDocumentCreated) return;
    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Access clipboard for Smart Clipboard Pro'
        });
    } catch (error) {
        if (!error.message.includes('Only a single offscreen')) {
            throw error;
        }
    }
}

async function ensureOffscreenDocumentReady() {
    if (!SUPPORTS_OFFSCREEN_DOCUMENT) {
        offscreenDocumentCreated = false;
        throw new Error('Offscreen documents are not supported in this browser');
    }
    if (!offscreenDocumentCreated) {
        await createOffscreenDocument();
    }
    for (let attempt = 0; attempt < OFFSCREEN_PING_RETRIES; attempt += 1) {
        try {
            const response = await sendRuntimeMessage({ action: 'offscreenPing' });
            if (response?.ready) {
                offscreenDocumentCreated = true;
                return;
            }
        } catch (error) {
            const message = error?.message || '';
            const receivingEndMissing = message.includes('Receiving end does not exist');
            if (!receivingEndMissing && !message.includes('Disconnected port')) {
                throw error;
            }
        }
        await delay(OFFSCREEN_PING_DELAY_MS);
    }
    offscreenDocumentCreated = false;
    throw new Error('Offscreen document not responding');
}

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'clipboardCheck') {
        await checkClipboard();
    } else if (alarm.name === LICENSE_REFRESH_ALARM) {
        await refreshLicenseStatus();
    } else if (alarm.name === LICENSE_SYNC_ALARM) {
        await syncLicenseWithServer();
    } else if (alarm.name === SUBSCRIPTION_RENEWAL_ALARM) {
        await enforceSubscriptionRenewal();
    } else if (alarm.name === 'engagementCheck') {
        await checkUserEngagement();
    }
});

// Check clipboard content
async function checkClipboard() {
    if (!SUPPORTS_OFFSCREEN_DOCUMENT) return;
    try {
        const settings = await chrome.storage.local.get(['settings']);
        if (!settings.settings?.autoSave) return;
        try {
            await ensureOffscreenDocumentReady();
        } catch (readyError) {
            console.warn('Offscreen document not ready, will retry:', readyError?.message || readyError);
            return;
        }
        
        // Send message to offscreen document to get clipboard content
        const response = await sendRuntimeMessage({ action: 'getClipboardContent' });
        
        if (response?.success && response.text && response.text.trim()) {
            const normalizedText = response.text.trim();
            const normalizedLast = lastClipboardContent.trim();
            
            if (normalizedText !== normalizedLast && normalizedText.length > 0) {
                lastClipboardContent = normalizedText;
                await addToClipboardHistory(normalizedText);
                
                // Show notification if enabled
                const notificationSettings = settings.settings?.notifications;
                if (notificationSettings) {
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon48.png',
                        title: 'Smart Clipboard Pro',
                        message: `New item saved: ${normalizedText.substring(0, 50)}${normalizedText.length > 50 ? '...' : ''}`
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error checking clipboard:', error);
        const message = error?.message || '';
        // Try to recreate offscreen document if it failed or isn't reachable yet
        if (message.includes('offscreen') || message.includes('Receiving end does not exist')) {
            offscreenDocumentCreated = false;
        }
    }
}

function normalizeBlacklistEntry(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') {
        return { hash: entry, addedAt: Date.now() - BLACKLIST_TTL_MS / 2, legacyHash: entry };
    }
    const hash = entry.hash || entry.textHash || entry.id || null;
    const legacyHash = entry.legacyHash || entry.textHash || null;
    if (!hash && !legacyHash) return null;
    const addedAt = normalizeTimestamp(entry.addedAt || entry.deletedAt || entry.timestamp || Date.now());
    return {
        hash: hash || legacyHash,
        legacyHash,
        addedAt: Number.isFinite(addedAt) ? addedAt : Date.now()
    };
}

function updateBlacklistCache(entries) {
    blacklistCache = {
        entries: entries.slice(),
        set: new Set(entries.map((item) => item.hash).filter(Boolean)),
        legacySet: new Set(entries.map((item) => item.legacyHash).filter(Boolean)),
        loadedAt: Date.now()
    };
}

function pruneBlacklistEntries(entries) {
    const now = Date.now();
    const filtered = [];
    for (const entry of entries) {
        if (!entry || (!entry.hash && !entry.legacyHash)) continue;
        const added = Number.isFinite(entry.addedAt) ? entry.addedAt : now;
        if (added + BLACKLIST_TTL_MS < now) continue;
        filtered.push({
            hash: entry.hash,
            legacyHash: entry.legacyHash || null,
            addedAt: added
        });
    }
    filtered.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (filtered.length > BLACKLIST_MAX_ENTRIES) {
        return filtered.slice(0, BLACKLIST_MAX_ENTRIES);
    }
    return filtered;
}

async function loadBlacklistEntries(force = false) {
    const cacheFresh = Date.now() - blacklistCache.loadedAt < BLACKLIST_CACHE_REFRESH_MS && blacklistCache.entries.length > 0;
    if (!force && cacheFresh) {
        return blacklistCache.entries;
    }
    try {
        const data = await chrome.storage.local.get([DELETED_ITEMS_BLACKLIST_KEY]);
        const rawList = data[DELETED_ITEMS_BLACKLIST_KEY] || [];
        const normalized = rawList
            .map(normalizeBlacklistEntry)
            .filter(Boolean);
        const pruned = pruneBlacklistEntries(normalized);
        if (pruned.length !== rawList.length) {
            await chrome.storage.local.set({ [DELETED_ITEMS_BLACKLIST_KEY]: pruned });
        }
        updateBlacklistCache(pruned);
        return pruned;
    } catch (error) {
        console.error('Error loading blacklist:', error);
        return blacklistCache.entries;
    }
}

async function persistBlacklistEntries(entries) {
    const pruned = pruneBlacklistEntries(entries);
    updateBlacklistCache(pruned);
    await chrome.storage.local.set({ [DELETED_ITEMS_BLACKLIST_KEY]: pruned });
    return pruned;
}

async function cleanupBlacklistEntries() {
    const entries = await loadBlacklistEntries(true);
    return persistBlacklistEntries(entries);
}

// Check if text is in blacklist (cached O(1) lookup)
async function isTextBlacklisted(text) {
    try {
        const fingerprints = await computeTextFingerprints(text);
        if (!fingerprints) return false;
        await loadBlacklistEntries();
        return blacklistCache.set.has(fingerprints.primary) || blacklistCache.legacySet.has(fingerprints.legacy);
    } catch (error) {
        console.error('Error checking blacklist:', error);
        return false;
    }
}

// Store deleted items for recovery
const DELETED_ITEMS_HISTORY_KEY = 'deletedItemsHistory';

// Add text hash to blacklist and save for recovery
async function addToBlacklist(text, itemId = null) {
    try {
        const data = await chrome.storage.local.get([DELETED_ITEMS_BLACKLIST_KEY, DELETED_ITEMS_HISTORY_KEY]);
        const blacklist = data[DELETED_ITEMS_BLACKLIST_KEY] || [];
        const deletedHistory = data[DELETED_ITEMS_HISTORY_KEY] || [];
        const fingerprints = await computeTextFingerprints(text);
        if (!fingerprints) return false;
        const textHash = fingerprints.primary;
        
        // Add to blacklist
        const normalizedBlacklist = blacklist.map(normalizeBlacklistEntry).filter(Boolean);
        const exists = normalizedBlacklist.find((entry) => entry.hash === textHash || entry.legacyHash === fingerprints.legacy);
        if (!exists) {
            normalizedBlacklist.unshift({
                hash: textHash,
                legacyHash: fingerprints.legacy,
                addedAt: Date.now()
            });
        }
        const prunedBlacklist = pruneBlacklistEntries(normalizedBlacklist);
        
        // Save deleted item for recovery
        const deletedItem = {
            id: itemId || Date.now().toString(),
            text: text,
            textHash: textHash,
            deletedAt: Date.now()
        };

        const existingIndex = deletedHistory.findIndex(entry => entry.textHash === textHash);
        if (existingIndex !== -1) {
            deletedHistory.splice(existingIndex, 1);
        }
        deletedHistory.unshift(deletedItem);
        // Keep last 100 deleted items for recovery
        if (deletedHistory.length > 100) {
            deletedHistory.splice(100);
        }
        
        await chrome.storage.local.set({ 
            [DELETED_ITEMS_BLACKLIST_KEY]: prunedBlacklist,
            [DELETED_ITEMS_HISTORY_KEY]: deletedHistory
        });
        updateBlacklistCache(prunedBlacklist);
        
        return true;
    } catch (error) {
        console.error('Error adding to blacklist:', error);
        return false;
    }
}

// Remove from blacklist (for recovery)
async function removeFromBlacklist(textHash) {
    try {
        const entries = await loadBlacklistEntries(true);
        const filtered = entries.filter((entry) => entry.hash !== textHash && entry.legacyHash !== textHash);
        await persistBlacklistEntries(filtered);
        return true;
    } catch (error) {
        console.error('Error removing from blacklist:', error);
        return false;
    }
}

// Get deleted items history
async function getDeletedItemsHistory() {
    try {
        const data = await chrome.storage.local.get([DELETED_ITEMS_HISTORY_KEY]);
        return data[DELETED_ITEMS_HISTORY_KEY] || [];
    } catch (error) {
        console.error('Error getting deleted items history:', error);
        return [];
    }
}

// Restore deleted item
async function restoreDeletedItem(textHash) {
    try {
        const deletedHistory = await getDeletedItemsHistory();
        const item = deletedHistory.find(i => i.textHash === textHash);
        
        if (!item) {
            return { success: false, error: 'Item not found in deleted history' };
        }
        
        // Remove from blacklist
        await removeFromBlacklist(textHash);
        
        // Add back to history
        await addToClipboardHistory(item.text);
        
        const remainingItems = deletedHistory.filter(entry => entry.textHash !== textHash);
        await chrome.storage.local.set({ [DELETED_ITEMS_HISTORY_KEY]: remainingItems });
        
        return { success: true, item };
    } catch (error) {
        console.error('Error restoring deleted item:', error);
        return { success: false, error: error.message };
    }
}

// Check if user has Pro license
async function isProUser() {
    try {
        const licenseInfo = await getLicenseInfo();
        if (!licenseInfo || licenseInfo.activated !== true) {
            return false;
        }
        if (licenseInfo.expiresAt && licenseInfo.expiresAt <= Date.now()) {
            return false;
        }
        return true;
    } catch (error) {
        return false;
    }
}

// Get max items based on license
async function getMaxHistoryItems() {
    const isPro = await isProUser();
    return isPro ? MAX_HISTORY_ITEMS_PRO : MAX_HISTORY_ITEMS_FREE;
}

async function getHistoryCount() {
    const data = await chrome.storage.local.get(['historyCount', 'clipboardHistory']);
    if (Number.isInteger(data.historyCount)) {
        return data.historyCount;
    }
    const history = Array.isArray(data.clipboardHistory) ? data.clipboardHistory : [];
    const count = history.length;
    await chrome.storage.local.set({ historyCount: count });
    return count;
}

async function incrementHistoryCount(delta = 1) {
    const current = await getHistoryCount();
    const next = Math.max(0, current + delta);
    await chrome.storage.local.set({ historyCount: next });
    return next;
}

async function shouldUseIndexedDB() {
    const count = await getHistoryCount();
    return count >= 1000;
}

async function getMaxPinnedItems() {
    const isPro = await isProUser();
    return isPro ? MAX_PINNED_ITEMS_PRO : MAX_PINNED_ITEMS_FREE;
}

async function getMaxSnippets() {
    const isPro = await isProUser();
    return isPro ? MAX_SNIPPETS_PRO : MAX_SNIPPETS_FREE;
}

// Add to clipboard history
async function addToClipboardHistory(text) {
    if (!text || text.trim().length === 0) return false;
    const normalizedText = text.trim();
    const fingerprints = await computeTextFingerprints(text);
    const lockKey = `add_${fingerprints?.primary || text}`;
    try {
        await acquireOperationLock(lockKey);
        await trackActivity();
        // Check if text is blacklisted (was previously deleted by user)
        const isBlacklisted = await isTextBlacklisted(text);
        if (isBlacklisted) {
            console.log('Text is blacklisted, skipping:', text.substring(0, 50));
            return false; // Don't add blacklisted items
        }
        
        const data = await chrome.storage.local.get(['clipboardHistory', 'settings']);
        const settings = data.settings || {};
        const useIndexedDB = await shouldUseIndexedDB();
        let historyLength = 0;
        let existingCopyCount = 0;
        if (useIndexedDB) {
            try {
                const db = await ensureClipboardDB();
                existingCopyCount = await db.getMaxTimesCopiedByText(normalizedText);
            } catch (error) {
                console.warn('Failed to read timesCopied from IndexedDB:', error);
                existingCopyCount = 0;
            }
        } else {
            const history = Array.isArray(data.clipboardHistory) ? data.clipboardHistory : [];
            existingCopyCount = history.reduce((max, item) => {
                const itemText = (item.text || '').trim();
                if (itemText === normalizedText) {
                    const count = Number(item.timesCopied) || 0;
                    return Math.max(max, count);
                }
                return max;
            }, 0);
        }
        const newItem = {
            id: generateStableId(),
            text: text,
            timestamp: Date.now(),
            type: detectTextType(text),
            timesCopied: existingCopyCount
        };

        if (useIndexedDB) {
            const db = await ensureClipboardDB();
            await db.addHistory(newItem);
            historyLength = await incrementHistoryCount(1);
        } else {
            let history = data.clipboardHistory || [];
            // Remove duplicates (check by text content, not just ID)
            history = history.filter(item => (item.text || '').trim() !== normalizedText);
            
            // Check limits before adding
            const maxItems = await getMaxHistoryItems();
            if (Number.isFinite(maxItems) && history.length >= maxItems) {
                // Remove oldest item for free users once they hit their cap
                history.pop();
            }

            history.unshift(newItem);
            await chrome.storage.local.set({ clipboardHistory: history, historyCount: history.length });
            historyLength = history.length;
        }
        
        // Check if limit reached and show upgrade prompt
        const isPro = await isProUser();
        if (!isPro && historyLength >= MAX_HISTORY_ITEMS_FREE) {
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'History Limit Reached',
                message: `You've reached the free limit (${MAX_HISTORY_ITEMS_FREE} items). Upgrade to Pro for unlimited history!`
            });
        }
        
        // Show notification if enabled
        if (settings.notifications) {
            showNotification('Saved', 'Text automatically saved to clipboard');
        }
        
        return true;
    } catch (error) {
        console.error('Error adding to clipboard history:', error);
        return false;
    } finally {
        releaseOperationLock(lockKey);
    }
}

// Detect text type
function detectTextType(text) {
    if (/^https?:\/\/.+/.test(text)) return 'url';
    if (/^[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}$/.test(text)) return 'email';
    if (/^\d+$/.test(text)) return 'number';
    if (text.includes('function') || text.includes('class') || text.includes('const') || text.includes('let')) return 'code';
    return 'text';
}

// Show notification
function showNotification(title, message) {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: title,
        message: message
    });
}

function isLicenseApiConfigured() {
    return Boolean(LICENSE_API_BASE_URL && LICENSE_API_BASE_URL.startsWith('https://'));
}

function buildLicenseApiUrl(path) {
    if (!LICENSE_API_ALLOWED_PATHS.has(path)) {
        throw new Error('License API path is not allowed');
    }
    if (!isLicenseApiConfigured()) {
        throw new Error('License API base URL is not configured');
    }
    const apiUrl = new URL(path, LICENSE_API_BASE_URL).toString();
    if (!apiUrl.startsWith(LICENSE_API_BASE_URL)) {
        throw new Error('License API URL not allowed');
    }
    return apiUrl;
}

async function callLicenseApi(path, payload = {}, options = {}) {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || LICENSE_API_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
        response = await fetch(buildLicenseApiUrl(path), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timeoutId);
    }

    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (error) {
        json = null;
    }

    if (!response.ok) {
        const message = json?.error || json?.message || text || `HTTP ${response.status}`;
        const error = new Error(`License API error (${response.status}): ${String(message).slice(0, 140)}`);
        error.status = response.status;
        throw error;
    }
    return json || {};
}

function derivePlanLabelFromResponse(response = {}) {
    if (!response) return `${DEFAULT_LICENSE_DURATION_DAYS}-Day Pro Pass`;
    if (response.planLabel) return response.planLabel;
    if (response.subscriptionStatus || response.subscriptionType || response.subscriptionId) {
        const label = response.subscriptionType || response.subscriptionStatus || '';
        if (label.toLowerCase().includes('year')) return 'Yearly Subscription';
        if (label.toLowerCase().includes('month')) return 'Monthly Subscription';
        return 'Subscription';
    }
    return `${DEFAULT_LICENSE_DURATION_DAYS}-Day Pro Pass`;
}

async function verifyLicenseWithBackend(licenseKey, deviceFingerprint, options = {}) {
    const payload = {
        licenseKey,
        deviceId: deviceFingerprint,
        productPermalink: GUMROAD_PRODUCT_PERMALINK,
        productId: GUMROAD_PRODUCT_ID,
        incrementUseCount: options.incrementUseCount === true
    };
    try {
        const response = await callLicenseApi(LICENSE_API_ENDPOINTS.verify, payload, options);
        if (!response || response.valid === false) {
            return {
                success: false,
                message: response?.error || response?.message || 'License rejected by server',
                definitive: true
            };
        }
        const licenseInfo = sanitizeLicenseInfo({
            key: licenseKey,
            activated: true,
            status: response.subscriptionStatus || response.status || 'active',
            source: 'backend',
            productId: response.productId || GUMROAD_PRODUCT_ID || null,
            productName: response.productName || 'Smart Clipboard Pro',
            purchaser: {
                email: response.email || response.purchaser?.email || '',
                name: response.name || response.purchaser?.name || ''
            },
            activatedAt: normalizeTimestamp(response.activatedAt) || Date.now(),
            lastVerifiedAt: Date.now(),
            nextChargeAt: normalizeTimestamp(response.nextChargeAt),
            expiresAt: normalizeTimestamp(response.expiresAt),
            subscriptionType: response.subscriptionType || response.plan || null,
            planLabel: derivePlanLabelFromResponse(response),
            usageCount: Number(response.usageCount || response.activations || 0),
            maxActivations: Number(response.maxActivations || response.activationLimit || MAX_LICENSE_ACTIVATIONS),
            subscriptionCancelled: Boolean(
                response.subscriptionStatus === 'canceled' ||
                response.subscriptionStatus === 'cancelled' ||
                response.subscriptionCancelled
            ),
            subscriptionFailedAt: normalizeTimestamp(response.subscriptionFailedAt),
            subscriptionId: response.subscriptionId || null,
            saleId: response.saleId || null,
            features: Array.isArray(response.features) && response.features.length > 0 ? response.features : PRO_FEATURES,
            deviceFingerprint
        });
        if (response.graceUntil) {
            licenseInfo.graceUntil = normalizeTimestamp(response.graceUntil);
        }
        return { success: true, licenseInfo, serverPayload: response };
    } catch (error) {
        if (error?.status && [400, 401, 403, 404, 429].includes(error.status)) {
            return { success: false, message: error.message, definitive: true };
        }
        throw error;
    }
}

async function verifyLicenseViaGumroad(licenseKey, options = {}) {
    try {
        const gumroad = await requestGumroadVerification(licenseKey, options);
        return gumroad;
    } catch (error) {
        const friendly = error?.message || 'Gumroad verification failed';
        return { success: false, message: friendly };
    }
}

async function verifyLicenseRemotely(licenseKey, deviceFingerprint, options = {}) {
    if (isLicenseApiConfigured()) {
        try {
            const backendResult = await verifyLicenseWithBackend(licenseKey, deviceFingerprint, options);
            if (backendResult?.success || backendResult?.definitive) {
                return { ...backendResult, source: 'backend' };
            }
        } catch (error) {
            console.warn('Backend verification unreachable, attempting fallback:', error.message || error);
        }
    }
    const gumroadResult = await verifyLicenseViaGumroad(licenseKey, options);
    return { ...gumroadResult, source: 'gumroad' };
}

// License verification functions
async function verifyLicense(licenseKey, options = {}) {
    const {
        skipValidation = false,
        silent = false,
        clearOnFailure = false,
        incrementUseCount = false,
        enforceUsageLimit = true
    } = options;

    try {
        let normalizedKey = licenseKey;
        const existingLicense = await getLicenseInfo();
        if (!skipValidation) {
            const validation = validateLicenseKey(licenseKey);
            if (!validation.valid) {
                return validation;
            }
            normalizedKey = validation.normalized;
        }
        
        if (!normalizedKey || !LICENSE_PATTERN.test(normalizedKey)) {
            return { valid: false, error: 'Invalid license key format. Use XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX' };
        }
        const deviceFingerprint = await getDeviceFingerprint();

        // Always fetch status first without incrementing usage to evaluate limits
        let result = await requestGumroadVerification(normalizedKey, { incrementUseCount: false });
        if (!result.success || !result.purchase) {
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            return { valid: false, error: result.message || 'License not recognized for this product' };
        }

        const usageCount = getUsageCountFromPurchase(result.purchase);
        const activationLimit = getActivationLimit(result.purchase);
        const evaluation = evaluatePurchaseStatus(result.purchase);
        if (!evaluation.active) {
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            const message = evaluation.reason || 'Subscription inactive';
            return { valid: false, error: message };
        }

        let licenseInfo = await buildLicenseInfoFromPurchase(result.purchase, normalizedKey, existingLicense);
        licenseInfo.expiresAt = normalizeTimestamp(licenseInfo.expiresAt);
        const purchaseIsSubscription = isSubscriptionPurchase(result.purchase);
        const activationEnforcement = await applyActivationRegistryRules({ ...licenseInfo, deviceFingerprint });
        if (!activationEnforcement.allowed) {
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            return { valid: false, error: activationEnforcement.error };
        }
        licenseInfo = activationEnforcement.licenseInfo;
        const isNewActivation = activationEnforcement.newActivation === true;
        if (enforceUsageLimit && isNewActivation && usageCount >= activationLimit) {
            const message = `License already activated ${usageCount} times (limit ${activationLimit}). Contact support to reset activations.`;
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            return { valid: false, error: message };
        }
        if (!purchaseIsSubscription && licenseInfo.expiresAt && licenseInfo.expiresAt <= Date.now()) {
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            const endDate = new Date(licenseInfo.expiresAt).toLocaleString();
            return { valid: false, error: `License expired on ${endDate}` };
        }
        if (!purchaseIsSubscription && (!licenseInfo.expiresAt || Number.isNaN(new Date(licenseInfo.expiresAt).getTime()))) {
            if (clearOnFailure) {
                await clearPersistedLicenseInfo();
            }
            return { valid: false, error: 'License data is missing an expiry date. Please contact support.' };
        }
        if (incrementUseCount && isNewActivation) {
            // Register this activation so Gumroad tracks the device count
            const incrementResult = await requestGumroadVerification(normalizedKey, { incrementUseCount: true });
            if (incrementResult.success && incrementResult.purchase) {
                licenseInfo.usageCount = getUsageCountFromPurchase(incrementResult.purchase);
            } else {
                console.warn('Failed to increment Gumroad usage count, continuing with previous verification data.');
                licenseInfo.usageCount = usageCount;
            }
        } else {
            licenseInfo.usageCount = usageCount;
        }

        const persisted = await persistLicenseInfo(licenseInfo);
        
        if (!silent) {
            console.log('License verified successfully at', new Date(persisted.lastVerifiedAt).toISOString());
        }
        
        return { valid: true, licenseInfo: persisted };
    } catch (error) {
        console.error('License verification error:', error);
        if (clearOnFailure) {
            await clearPersistedLicenseInfo();
        }
        const friendlyMessage = /Gumroad verification request failed/.test(error.message || '')
            ? 'Gumroad servers are temporarily unavailable. Please try again shortly.'
            : (error.message || 'Verification failed');
        return { valid: false, error: friendlyMessage };
    }
}

async function handleGracePeriod(licenseInfo, error = null) {
    try {
        if (!licenseInfo || !licenseInfo.lastVerifiedAt) {
            return { allowed: false, error: 'No cached license available for grace mode' };
        }
        const graceUntil = (licenseInfo.lastVerifiedAt || 0) + LICENSE_GRACE_PERIOD_MS;
        if (graceUntil <= Date.now()) {
            return { allowed: false, error: 'Offline grace period expired' };
        }
        const shouldNotify = licenseInfo.graceNotified !== true;
        const updated = {
            ...licenseInfo,
            status: 'grace',
            graceUntil,
            graceNotified: true
        };
        const persisted = await persistLicenseInfo(updated);
        if (shouldNotify) {
            try {
                showNotification(
                    'Working offline',
                    'License server unreachable. Running in offline grace period for up to 7 days.'
                );
            } catch (notifyError) {
                console.warn('Grace period notification failed:', notifyError);
            }
        }
        return { allowed: true, licenseInfo: persisted, error };
    } catch (graceError) {
        console.warn('Grace period handling failed:', graceError);
        return { allowed: false, error: graceError?.message || 'Grace period unavailable' };
    }
}

async function cleanupExpiredLicenses() {
    try {
        const licenseInfo = await getLicenseInfo();
        if (!licenseInfo) return;
        const now = Date.now();
        const expired = licenseInfo.expiresAt && licenseInfo.expiresAt < now;
        const grace = licenseInfo.graceUntil && licenseInfo.graceUntil > now;
        if (expired && !grace) {
            await clearPersistedLicenseInfo();
            console.log('Expired license removed from storage');
        }
    } catch (error) {
        console.warn('cleanupExpiredLicenses failed:', error);
    }
}

async function syncLicenseWithServer(currentLicenseInfo = null, forceSubscriptionCheck = false) {
    if (!isLicenseApiConfigured()) return currentLicenseInfo || null;
    const licenseInfo = currentLicenseInfo || await getLicenseInfo();
    if (!licenseInfo?.key) return licenseInfo;
    try {
        const deviceFingerprint = await getDeviceFingerprint();
        const response = await callLicenseApi(LICENSE_API_ENDPOINTS.sync, {
            licenseKey: licenseInfo.key,
            deviceId: deviceFingerprint,
            signature: licenseInfo.signature,
            subscriptionCheck: forceSubscriptionCheck
        }, { timeoutMs: LICENSE_API_TIMEOUT_MS });
        if (!response) {
            return licenseInfo;
        }
        if (response.valid === false) {
            await clearPersistedLicenseInfo();
            return null;
        }
        const merged = sanitizeLicenseInfo({
            ...licenseInfo,
            ...(response.license || {}),
            deviceFingerprint,
            lastVerifiedAt: Date.now(),
            lastSyncedAt: Date.now()
        });
        const persisted = await persistLicenseInfo(merged);
        return persisted;
    } catch (error) {
        console.warn('License sync failed:', error.message || error);
        return licenseInfo;
    }
}

async function enforceSubscriptionRenewal() {
    if (!isLicenseApiConfigured()) {
        return null;
    }
    try {
        const synced = await syncLicenseWithServer(null, true);
        if (!synced || !synced.subscriptionId) {
            return synced;
        }
        const now = Date.now();
        if (synced.subscriptionFailedAt && synced.subscriptionFailedAt <= now) {
            const downgraded = await persistLicenseInfo({
                ...synced,
                status: 'past_due'
            });
            showNotification('Subscription issue', 'Payment failed or subscription ended. Please renew to keep Pro features.');
            return downgraded;
        }
        if (synced.nextChargeAt && synced.nextChargeAt + (2 * DAY_IN_MS) < now && !synced.subscriptionCancelled) {
            showNotification('Renewal reminder', 'We could not confirm your latest subscription charge. Please verify your payment method.');
        }
        return synced;
    } catch (error) {
        console.error('Failed to enforce subscription renewal:', error);
        return null;
    }
}

async function checkUserEngagement() {
    try {
        const data = await chrome.storage.local.get(['lastUsed', 'clipboardHistory']);
        const lastUsed = data.lastUsed || Date.now();
        const daysSinceUse = (Date.now() - lastUsed) / DAY_IN_MS;
        if (daysSinceUse > 3 && daysSinceUse < 30) {
            const historyCount = Array.isArray(data.clipboardHistory) ? data.clipboardHistory.length : 0;
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: '📋 Smart Clipboard Pro misses you!',
                message: `You have ${historyCount} saved items waiting. Click to view.`,
                buttons: [{ title: 'Open Clipboard' }],
                requireInteraction: true
            });
        }
    } catch (error) {
        console.warn('checkUserEngagement failed:', error);
    }
}

async function trackActivity() {
    try {
        await chrome.storage.local.set({ lastUsed: Date.now() });
    } catch (error) {
        console.warn('trackActivity failed:', error);
    }
}

async function refreshLicenseStatus(force = false) {
    try {
        let licenseInfo = await getLicenseInfo();
        if (!licenseInfo?.key) {
            return null;
        }

        if (isLicenseApiConfigured()) {
            const synced = await syncLicenseWithServer(licenseInfo);
            if (synced) {
                licenseInfo = synced;
            }
        }
        
        const lastCheck = licenseInfo.lastVerifiedAt || 0;
        const intervalMs = LICENSE_REFRESH_INTERVAL_MINUTES * 60 * 1000;
        if (!force && Date.now() - lastCheck < intervalMs) {
            return licenseInfo;
        }
        
        const result = await verifyLicense(licenseInfo.key, {
            skipValidation: true,
            silent: true,
            clearOnFailure: true,
            enforceUsageLimit: false,
            incrementUseCount: false
        });
        
        if (!result.valid) {
            console.warn('Stored license failed verification:', result.error);
            await clearPersistedLicenseInfo();
            return null;
        }
        
        if (result.licenseInfo) {
            await persistLicenseInfo(result.licenseInfo);
        }
        await cleanupExpiredLicenses();
        return result.licenseInfo;
    } catch (error) {
        console.error('Error refreshing license status:', error);
        return null;
    }
}

async function getLicenseInfo() {
    try {
        const data = await chrome.storage.local.get([LICENSE_STORAGE_KEY]);
        let stored = data[LICENSE_STORAGE_KEY] || null;
        if (!stored) {
            stored = await bootstrapLicenseFromSync();
            if (!stored) {
                return null;
            }
        }
        const licenseInfo = sanitizeLicenseInfo(stored);
        if (!licenseInfo.key && licenseInfo.keyCipher && licenseInfo.keyIv) {
            try {
                const deviceFingerprint = licenseInfo.deviceFingerprint || await getDeviceFingerprint();
                licenseInfo.key = await decryptLicenseKey(licenseInfo.keyCipher, licenseInfo.keyIv, deviceFingerprint);
            } catch (decryptError) {
                console.warn('Failed to decrypt stored license key:', decryptError);
            }
        }
        const signatureCheck = await verifyLicenseSignature(licenseInfo);
        if (!signatureCheck.valid) {
            const lastVerifiedAt = licenseInfo.lastVerifiedAt || 0;
            const recentlyVerified = Date.now() - lastVerifiedAt <= LICENSE_GRACE_PERIOD_MS;
            if (recentlyVerified) {
                const reSigned = await persistLicenseInfo({ ...licenseInfo });
                return reSigned;
            }
            console.warn('License signature invalid or missing; clearing cached license.', signatureCheck.reason);
            await clearPersistedLicenseInfo();
            return null;
        }
        let needsPersist = false;
        if (!licenseInfo.subscriptionId) {
            const durationMs = DEFAULT_LICENSE_DURATION_DAYS * DAY_IN_MS;
            if (!licenseInfo.expiresAt) {
                const base = licenseInfo.activatedAt || Date.now();
                licenseInfo.expiresAt = base + durationMs;
                needsPersist = true;
            }
            if (!licenseInfo.activatedAt) {
                licenseInfo.activatedAt = Math.max(licenseInfo.expiresAt - durationMs, 0);
                needsPersist = true;
            }
            if (licenseInfo.expiresAt <= Date.now()) {
                licenseInfo.status = 'expired';
            }
        }
        if (needsPersist) {
            await persistLicenseInfo(licenseInfo);
        }
        return licenseInfo;
    } catch (error) {
        console.error('Error getting license info:', error);
        return null;
    }
}

async function isPremiumFeatureEnabled(feature) {
    try {
        const licenseInfo = await getLicenseInfo();
        if (!licenseInfo || !licenseInfo.activated) {
            return false;
        }
        
        return licenseInfo.features && licenseInfo.features.includes(feature);
    } catch (error) {
        console.error('Error checking premium feature:', error);
        return false;
    }
}

async function requestGumroadVerification(licenseKey, options = {}) {
    const { incrementUseCount = false } = options;
    const params = {
        license_key: licenseKey,
        increment_uses_count: incrementUseCount ? 'true' : 'false'
    };
    if (GUMROAD_PRODUCT_PERMALINK) {
        params.product_permalink = GUMROAD_PRODUCT_PERMALINK;
    }
    if (GUMROAD_PRODUCT_ID) {
        params.product_id = GUMROAD_PRODUCT_ID;
    }
    const body = new URLSearchParams(params);
    
    const response = await fetch(GUMROAD_VERIFY_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });
    
    const raw = await response.text();
    let payload = null;
    try {
        payload = raw ? JSON.parse(raw) : null;
    } catch (error) {
        payload = null;
    }
    
    if (!response.ok) {
        const message = payload?.message || raw || `HTTP ${response.status}`;
        throw new Error(`Gumroad verification request failed (${response.status}): ${String(message).slice(0, 140)}`);
    }
    
    return payload;
}

function getUsageCountFromPurchase(purchase) {
    if (!purchase) return 0;
    const candidates = [purchase.uses, purchase.uses_count, purchase.license_uses];
    for (const value of candidates) {
        const numeric = Number(value);
        if (Number.isFinite(numeric) && numeric >= 0) {
            return numeric;
        }
    }
    return 0;
}

function getActivationLimit(purchase) {
    const candidate = Number(purchase?.max_uses);
    if (Number.isFinite(candidate) && candidate > 0) {
        return candidate;
    }
    return MAX_LICENSE_ACTIVATIONS;
}

function isSubscriptionPurchase(purchase) {
    if (!purchase) return false;
    return Boolean(
        purchase.subscription_id ||
        purchase.subscription_interval ||
        purchase.subscription_period ||
        purchase.is_subscription ||
        purchase.is_recurring_billing
    );
}

function getCustomDurationDays(purchase) {
    if (!purchase) return null;
    const candidates = [
        purchase.subscription_duration,
        purchase.custom_fields?.license_duration_days,
        purchase.license_duration_days
    ];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const numeric = Number(candidate);
        if (Number.isFinite(numeric) && numeric > 0) {
            return numeric;
        }
        const parsedInt = parseInt(String(candidate).replace(/\D/g, ''), 10);
        if (Number.isFinite(parsedInt) && parsedInt > 0) {
            return parsedInt;
        }
    }
    return null;
}

function calculatePurchaseExpiry(purchase) {
    if (!purchase) return null;
    const cancellationAt = parseTimestamp(
        purchase.subscription_ended_at ||
        purchase.subscription_cancelled_at ||
        purchase.subscription_cancelled_on
    );
    if (cancellationAt) {
        return cancellationAt;
    }
    if (isSubscriptionPurchase(purchase)) {
        return null;
    }
    const saleTimestamp = parseTimestamp(purchase.sale_timestamp) || Date.now();
    const durationDays = getCustomDurationDays(purchase) || DEFAULT_LICENSE_DURATION_DAYS;
    return saleTimestamp + (durationDays * DAY_IN_MS);
}

function getPurchaseActivationTimestamp(purchase) {
    if (!purchase) return null;
    const customFields = purchase.custom_fields || purchase.customFields || {};
    const licenseKeyData = purchase.license_key || purchase.licenseKey || {};
    const candidates = [
        customFields.initial_activation_at,
        customFields.activation_started_at,
        customFields.activation_start,
        customFields.activation_date,
        customFields.activated_at,
        customFields.first_activation,
        customFields.activationTimestamp,
        purchase.first_charge_date,
        purchase.first_charge_at,
        purchase.subscription_started_at,
        purchase.subscription_start,
        purchase.subscription_begin_at,
        purchase.subscription_billed_at,
        purchase.subscription_charge_date,
        licenseKeyData.first_redeemed_at,
        licenseKeyData.created_at,
        licenseKeyData.updated_at,
        purchase.sale_timestamp,
        purchase.purchase_timestamp,
        purchase.purchased_at,
        purchase.created_at
    ];
    for (const value of candidates) {
        const timestamp = normalizeTimestamp(value);
        if (Number.isFinite(timestamp) && timestamp > 0) {
            return timestamp;
        }
    }
    return null;
}

function deriveSubscriptionType(purchase) {
    if (!purchase) return `${DEFAULT_LICENSE_DURATION_DAYS}-day pass`;
    const interval = String(
        purchase.subscription_interval ||
        purchase.subscription_period ||
        ''
    ).toLowerCase();
    if (interval) {
        return interval;
    }
    if (isSubscriptionPurchase(purchase)) {
        return 'subscription';
    }
    return `${DEFAULT_LICENSE_DURATION_DAYS}-day pass`;
}

function derivePlanLabel(purchase) {
    if (isSubscriptionPurchase(purchase)) {
        const type = deriveSubscriptionType(purchase);
        if (type.includes('year')) return 'Yearly Subscription';
        if (type.includes('month')) return 'Monthly Subscription';
        return 'Subscription';
    }
    return `${DEFAULT_LICENSE_DURATION_DAYS}-Day Pro Pass`;
}

function evaluatePurchaseStatus(purchase) {
    if (!purchase) {
        return { active: false, reason: 'Missing purchase data' };
    }
    
    if (purchase.refunded) {
        return { active: false, reason: 'Purchase refunded' };
    }
    
    if (purchase.chargebacked || purchase.disputed && !purchase.dispute_won) {
        return { active: false, reason: 'Purchase disputed or chargebacked' };
    }
    
    const endedAt = parseTimestamp(purchase.subscription_ended_at || purchase.subscription_cancelled_at);
    if (endedAt && endedAt <= Date.now()) {
        return { active: false, reason: 'Subscription ended' };
    }
    
    const failedAt = parseTimestamp(purchase.subscription_failed_at);
    if (failedAt && failedAt <= Date.now()) {
        return { active: false, reason: 'Subscription payment failed' };
    }
    
    return { active: true };
}

async function buildLicenseInfoFromPurchase(purchase, licenseKey, previousInfo = null) {
    const now = Date.now();
    const previousForKey = previousInfo && previousInfo.key === licenseKey ? previousInfo : null;
    const previousActivated = normalizeTimestamp(previousForKey?.activatedAt);
    const previousExpires = normalizeTimestamp(previousForKey?.expiresAt);
    const durationDays = getCustomDurationDays(purchase) || DEFAULT_LICENSE_DURATION_DAYS;
    const durationMs = durationDays * DAY_IN_MS;
    const reconstructedActivated = Number.isFinite(previousExpires)
        ? previousExpires - durationMs
        : null;
    const purchaseActivated = getPurchaseActivationTimestamp(purchase);
    const candidateActivations = [previousActivated, reconstructedActivated, purchaseActivated]
        .filter((value) => Number.isFinite(value) && value > 0);
    let baseActivatedAt = candidateActivations.length > 0 ? Math.min(...candidateActivations) : now;
    if (!Number.isFinite(baseActivatedAt) || baseActivatedAt <= 0) {
        baseActivatedAt = now;
    }
    if (baseActivatedAt > now) {
        baseActivatedAt = now;
    }
    const nextChargeAt = parseTimestamp(
        purchase.subscription_charge_date ||
        purchase.next_charge_date ||
        purchase.subscription_billed_at
    );
    const subscription = isSubscriptionPurchase(purchase);
    let expiresAt = null;
    if (subscription) {
        expiresAt = calculatePurchaseExpiry(purchase);
        if (!Number.isFinite(expiresAt) && Number.isFinite(previousExpires)) {
            expiresAt = previousExpires;
        }
    } else {
        const purchaseExpiry = calculatePurchaseExpiry(purchase);
        if (Number.isFinite(purchaseExpiry)) {
            expiresAt = purchaseExpiry;
        } else if (Number.isFinite(previousExpires)) {
            expiresAt = previousExpires;
        } else {
            expiresAt = baseActivatedAt + durationMs;
        }
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= baseActivatedAt) {
        expiresAt = baseActivatedAt + durationMs;
    }
    const subscriptionType = deriveSubscriptionType(purchase);
    const planLabel = derivePlanLabel(purchase);
    const usageCount = getUsageCountFromPurchase(purchase);
    const maxActivations = getActivationLimit(purchase);
    
    return {
        key: licenseKey,
        activated: true,
        status: 'active',
        source: 'gumroad',
        productId: purchase.product_id || null,
        productName: purchase.product_name || 'Smart Clipboard Pro',
        purchaser: {
            email: purchase.email || '',
            name: purchase.full_name || ''
        },
        activatedAt: baseActivatedAt,
        lastVerifiedAt: now,
        nextChargeAt,
        expiresAt: normalizeTimestamp(expiresAt),
        subscriptionType,
        planLabel,
        usageCount,
        maxActivations,
        subscriptionCancelled: Boolean(purchase.subscription_cancelled || purchase.subscription_cancelled_at),
        subscriptionFailedAt: parseTimestamp(purchase.subscription_failed_at),
        subscriptionId: purchase.subscription_id || null,
        saleId: purchase.sale_id || purchase.id || null,
        features: PRO_FEATURES
    };
}

function parseTimestamp(value) {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
}

function normalizeTimestamp(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        return numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
}

function sanitizeLicenseInfo(info = {}) {
    const copy = { ...info };
    copy.activatedAt = normalizeTimestamp(copy.activatedAt);
    copy.expiresAt = normalizeTimestamp(copy.expiresAt);
    copy.nextChargeAt = normalizeTimestamp(copy.nextChargeAt);
    copy.lastVerifiedAt = normalizeTimestamp(copy.lastVerifiedAt) || Date.now();
    copy.graceUntil = normalizeTimestamp(copy.graceUntil);
    if (!Number.isFinite(copy.usageCount)) {
        copy.usageCount = Number(copy.usageCount) || 0;
    }
    if (!Number.isFinite(copy.maxActivations)) {
        copy.maxActivations = Number(copy.maxActivations) || MAX_LICENSE_ACTIVATIONS;
    }
    return copy;
}

async function persistLicenseInfo(licenseInfo) {
    const sanitized = sanitizeLicenseInfo(licenseInfo);
    const deviceFingerprint = sanitized.deviceFingerprint || await getDeviceFingerprint();
    let keyCipher = sanitized.keyCipher || null;
    let keyIv = sanitized.keyIv || null;
    if (sanitized.key && (!keyCipher || !keyIv)) {
        try {
            const encrypted = await encryptLicenseKey(sanitized.key, deviceFingerprint);
            keyCipher = encrypted.cipher;
            keyIv = encrypted.iv;
        } catch (error) {
            console.warn('Failed to encrypt license key, storing plaintext for now:', error);
        }
    }
    const persistedPayload = {
        ...sanitized,
        deviceFingerprint,
        keyHash: sanitized.keyHash || (sanitized.key ? await hashLicenseKey(sanitized.key) : null),
        keyCipher,
        keyIv
    };
    delete persistedPayload.key;
    const signed = await applyLicenseSignature(persistedPayload);
    await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: signed });
    await saveLicenseSnapshotToSync(signed);
    return { ...signed, key: sanitized.key };
}

async function saveLicenseSnapshotToSync(licenseInfo) {
    if (!chrome.storage?.sync) return;
    try {
        await chrome.storage.sync.set({ [LICENSE_SYNC_CACHE_KEY]: licenseInfo });
    } catch (error) {
        console.warn('Failed to sync license snapshot:', error);
    }
}

async function readLicenseSnapshotFromSync() {
    if (!chrome.storage?.sync) return null;
    try {
        const result = await chrome.storage.sync.get([LICENSE_SYNC_CACHE_KEY]);
        return result[LICENSE_SYNC_CACHE_KEY] || null;
    } catch (error) {
        console.warn('Failed to read license snapshot from sync:', error);
        return null;
    }
}

async function clearPersistedLicenseInfo() {
    await chrome.storage.local.remove([LICENSE_STORAGE_KEY]);
    if (!chrome.storage?.sync) return;
    try {
        await chrome.storage.sync.remove([LICENSE_SYNC_CACHE_KEY]);
    } catch (error) {
        console.warn('Failed to clear synced license snapshot:', error);
    }
}

async function bootstrapLicenseFromSync() {
    try {
        const localData = await chrome.storage.local.get([LICENSE_STORAGE_KEY]);
        if (localData[LICENSE_STORAGE_KEY]) {
            return sanitizeLicenseInfo(localData[LICENSE_STORAGE_KEY]);
        }
        const snapshot = await readLicenseSnapshotFromSync();
        if (!snapshot) {
            return null;
        }
        const sanitized = sanitizeLicenseInfo(snapshot);
        if (sanitized.expiresAt && sanitized.expiresAt <= Date.now()) {
            return null;
        }
        const signed = await applyLicenseSignature(sanitized);
        await chrome.storage.local.set({ [LICENSE_STORAGE_KEY]: signed });
        return signed;
    } catch (error) {
        console.warn('Failed to bootstrap license from sync:', error);
        return null;
    }
}

function getNormalizedEmail(value = '') {
    return String(value || '').trim().toLowerCase();
}

function sanitizeActivationRegistry(raw) {
    const sanitized = { byEmail: {}, byKey: {} };
    if (!raw || typeof raw !== 'object') {
        return sanitized;
    }
    const normalizeRecord = (record) => {
        if (!record || typeof record !== 'object') return null;
        const normalized = {
            email: getNormalizedEmail(record.email),
            licenseKeyHash: record.licenseKeyHash || null,
            activatedAt: normalizeTimestamp(record.activatedAt),
            expiresAt: normalizeTimestamp(record.expiresAt),
            lastUpdated: normalizeTimestamp(record.lastUpdated),
            deviceFingerprintHash: record.deviceFingerprintHash || null
        };
        if (!normalized.email || !normalized.licenseKeyHash) {
            return null;
        }
        if (!Number.isFinite(normalized.activatedAt) || !Number.isFinite(normalized.expiresAt)) {
            return null;
        }
        return normalized;
    };
    for (const [email, record] of Object.entries(raw.byEmail || {})) {
        const normalized = normalizeRecord(record);
        if (normalized) {
            sanitized.byEmail[getNormalizedEmail(email)] = { ...normalized };
        }
    }
    for (const [hash, record] of Object.entries(raw.byKey || {})) {
        const normalized = normalizeRecord(record);
        if (normalized) {
            sanitized.byKey[hash] = { ...normalized };
        }
    }
    return sanitized;
}

async function readActivationRegistryFromSync() {
    if (!chrome.storage?.sync) return null;
    try {
        const syncResult = await chrome.storage.sync.get([ACTIVATION_REGISTRY_SYNC_KEY]);
        return syncResult[ACTIVATION_REGISTRY_SYNC_KEY] || null;
    } catch (error) {
        console.warn('Failed to read activation registry from sync:', error);
        return null;
    }
}

async function readActivationRegistryFromLocal() {
    const fallback = await chrome.storage.local.get([ACTIVATION_REGISTRY_CACHE_KEY]);
    return fallback[ACTIVATION_REGISTRY_CACHE_KEY] || null;
}

function mergeActivationRegistries(primary = null, secondary = null) {
    const merged = { byEmail: {}, byKey: {} };
    const pushRecord = (record, emailKey, keyHash) => {
        if (!record) return;
        const normalized = {
            ...record,
            lastUpdated: normalizeTimestamp(record.lastUpdated) || 0,
            activatedAt: normalizeTimestamp(record.activatedAt),
            expiresAt: normalizeTimestamp(record.expiresAt)
        };
        const email = getNormalizedEmail(emailKey || record.email);
        const licenseKeyHash = keyHash || record.licenseKeyHash;
        if (!email || !licenseKeyHash) return;
        const existingEmail = merged.byEmail[email];
        if (!existingEmail || (normalized.lastUpdated || 0) >= (existingEmail.lastUpdated || 0)) {
            merged.byEmail[email] = normalized;
        }
        const existingKey = merged.byKey[licenseKeyHash];
        if (!existingKey || (normalized.lastUpdated || 0) >= (existingKey.lastUpdated || 0)) {
            merged.byKey[licenseKeyHash] = normalized;
        }
    };
    for (const [email, record] of Object.entries((primary && primary.byEmail) || {})) {
        pushRecord(record, email, record.licenseKeyHash);
    }
    for (const [key, record] of Object.entries((primary && primary.byKey) || {})) {
        pushRecord(record, record.email, key);
    }
    for (const [email, record] of Object.entries((secondary && secondary.byEmail) || {})) {
        pushRecord(record, email, record.licenseKeyHash);
    }
    for (const [key, record] of Object.entries((secondary && secondary.byKey) || {})) {
        pushRecord(record, record.email, key);
    }
    return merged;
}

async function readActivationRegistry() {
    const syncRegistry = await readActivationRegistryFromSync();
    const localRegistry = await readActivationRegistryFromLocal();
    const merged = mergeActivationRegistries(syncRegistry, localRegistry);
    return sanitizeActivationRegistry(merged);
}

async function persistActivationRegistry(registry) {
    const sanitized = sanitizeActivationRegistry(registry);
    if (chrome.storage?.sync) {
        try {
            await chrome.storage.sync.set({ [ACTIVATION_REGISTRY_SYNC_KEY]: sanitized });
        } catch (error) {
            console.warn('Failed to sync activation registry:', error);
        }
    }
    await chrome.storage.local.set({ [ACTIVATION_REGISTRY_CACHE_KEY]: sanitized });
    return sanitized;
}

async function acquireActivationLock(timeoutMs = ACTIVATION_LOCK_TIMEOUT_MS) {
    const token = generateSecureToken();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const existing = await chrome.storage.local.get([ACTIVATION_REGISTRY_LOCK_KEY]);
        const lock = existing[ACTIVATION_REGISTRY_LOCK_KEY] || null;
        const expired = !lock || !lock.expiresAt || lock.expiresAt <= Date.now();
        if (expired) {
            const newLock = { token, expiresAt: Date.now() + timeoutMs };
            await chrome.storage.local.set({ [ACTIVATION_REGISTRY_LOCK_KEY]: newLock });
            const verify = await chrome.storage.local.get([ACTIVATION_REGISTRY_LOCK_KEY]);
            const storedToken = verify[ACTIVATION_REGISTRY_LOCK_KEY]?.token;
            const expectedToken = typeof token === 'string' ? token : '';
            if (timingSafeEqual(typeof storedToken === 'string' ? storedToken : '', expectedToken)) {
                return token;
            }
        }
        await delay(ACTIVATION_LOCK_RETRY_MS);
    }
    throw new Error('Unable to acquire activation registry lock');
}

async function releaseActivationLock(token) {
    if (!token) return;
    try {
        const current = await chrome.storage.local.get([ACTIVATION_REGISTRY_LOCK_KEY]);
        const storedToken = current[ACTIVATION_REGISTRY_LOCK_KEY]?.token;
        const expectedToken = typeof token === 'string' ? token : '';
        if (timingSafeEqual(typeof storedToken === 'string' ? storedToken : '', expectedToken)) {
            await chrome.storage.local.remove([ACTIVATION_REGISTRY_LOCK_KEY]);
        }
    } catch (error) {
        console.warn('Failed to release activation lock:', error);
    }
}

async function withActivationRegistry(mutator) {
    const token = await acquireActivationLock();
    let registry = await readActivationRegistry();
    try {
        const result = await mutator(registry);
        if (result && result.registry) {
            registry = result.registry;
        }
        if (result && result.changed) {
            registry = await persistActivationRegistry(registry);
        }
        return result || { registry };
    } finally {
        await releaseActivationLock(token);
    }
}

async function hashLicenseKey(licenseKey) {
    if (!licenseKey) return null;
    try {
        if (crypto?.subtle && typeof TextEncoder !== 'undefined') {
            const encoder = new TextEncoder();
            const data = encoder.encode(licenseKey);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }
    } catch (error) {
        console.warn('hashLicenseKey fallback triggered:', error);
    }
    return licenseKey;
}

async function applyActivationRegistryRules(licenseInfo) {
    const emailKey = getNormalizedEmail(licenseInfo?.purchaser?.email);
    if (!emailKey) {
        return { allowed: false, error: 'Unable to determine purchaser email for this code. Please contact support.' };
    }
    const licenseHash = await hashLicenseKey(licenseInfo.key);
    const deviceFingerprint = licenseInfo.deviceFingerprint || await getDeviceFingerprint();
    const deviceFingerprintHash = deviceFingerprint ? await hashString(deviceFingerprint) : null;
    const now = Date.now();

    return withActivationRegistry(async (registry) => {
        const emailRecord = registry.byEmail[emailKey];
        const keyRecord = registry.byKey[licenseHash];
        let changed = false;

        if (keyRecord) {
            if (keyRecord.email !== emailKey) {
                const transferable = keyRecord.expiresAt && keyRecord.expiresAt <= now;
                if (!transferable) {
                    return { allowed: false, error: 'This code has already been used by another email address.', registry, changed: false };
                }
            }
            if (keyRecord.expiresAt && keyRecord.expiresAt <= now) {
                return { allowed: false, error: 'This code has already been used and expired. Please purchase a new code.', registry, changed: false };
            }
            if (deviceFingerprintHash && keyRecord.deviceFingerprintHash && keyRecord.deviceFingerprintHash !== deviceFingerprintHash) {
                const stale = (keyRecord.lastUpdated || 0) + LICENSE_GRACE_PERIOD_MS < now || (keyRecord.expiresAt && keyRecord.expiresAt <= now);
                if (!stale) {
                    return { allowed: false, error: 'This license is already activated on another device.', registry, changed: false };
                }
                // Replace stale device binding (e.g., OS reinstall)
                keyRecord.deviceFingerprintHash = deviceFingerprintHash;
                keyRecord.lastUpdated = now;
                registry.byEmail[emailKey] = keyRecord;
                registry.byKey[licenseHash] = keyRecord;
                changed = true;
            }
            return {
                allowed: true,
                licenseInfo: {
                    ...licenseInfo,
                    activatedAt: keyRecord.activatedAt,
                    expiresAt: keyRecord.expiresAt,
                    deviceFingerprint
                },
                newActivation: false,
                registry,
                changed
            };
        }

        if (emailRecord && emailRecord.licenseKeyHash !== licenseHash) {
            const active = !emailRecord.expiresAt || emailRecord.expiresAt > now;
            if (active) {
                const label = emailRecord.expiresAt
                    ? new Date(emailRecord.expiresAt).toLocaleString()
                    : 'the previous code expires';
                return { allowed: false, error: `This email already has an active code until ${label}.`, registry, changed: false };
            }
        }

        const activatedAt = Number.isFinite(licenseInfo.activatedAt) ? licenseInfo.activatedAt : now;
        let expiresAt = Number.isFinite(licenseInfo.expiresAt)
            ? licenseInfo.expiresAt
            : activatedAt + ACTIVATION_DURATION_MS;
        if (!Number.isFinite(expiresAt) || expiresAt <= activatedAt) {
            expiresAt = activatedAt + ACTIVATION_DURATION_MS;
        }

        const record = {
            email: emailKey,
            licenseKeyHash: licenseHash,
            activatedAt,
            expiresAt,
            lastUpdated: now,
            deviceFingerprintHash
        };

        registry.byEmail[emailKey] = record;
        registry.byKey[licenseHash] = record;
        changed = true;

        return {
            allowed: true,
            licenseInfo: {
                ...licenseInfo,
                activatedAt,
                expiresAt,
                deviceFingerprint
            },
            newActivation: true,
            registry,
            changed
        };
    });
}

function normalizeLicenseKeyInput(value) {
    if (!value) return null;
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length !== 32) return null;
    const groups = cleaned.match(/.{1,8}/g);
    return groups ? groups.join('-') : null;
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'getClipboardHistory': {
            (async () => {
                const page = Number.isInteger(message.page) && message.page >= 0 ? message.page : 0;
                const pageSize = Number.isInteger(message.pageSize) && message.pageSize > 0
                    ? message.pageSize
                    : DEFAULT_PAGE_SIZE;
                const useIndexedDB = await shouldUseIndexedDB();
                if (useIndexedDB) {
                    try {
                        const db = await ensureClipboardDB();
                        const offset = page * pageSize;
                        const items = await db.getHistory(pageSize, offset);
                        const total = await getHistoryCount();
                        sendResponse({
                            items,
                            hasMore: offset + items.length < total,
                            total
                        });
                        return;
                    } catch (error) {
                        console.warn('Failed to read history from IndexedDB, falling back to storage:', error);
                    }
                }
                const data = await chrome.storage.local.get(['clipboardHistory']);
                const items = data.clipboardHistory || [];
                const start = page * pageSize;
                const slice = items.slice(start, start + pageSize);
                sendResponse({
                    items: slice,
                    hasMore: start + pageSize < items.length,
                    total: items.length
                });
            })();
            return true;
        }
        case 'getTopHistory': {
            chrome.storage.local.get(['clipboardHistory']).then((data) => {
                const items = Array.isArray(data.clipboardHistory) ? data.clipboardHistory.slice() : [];
                const limit = Number.isInteger(message.limit) && message.limit > 0 ? message.limit : 10;
                const sorted = items
                    .slice()
                    .sort((a, b) => {
                        const aCount = Number(a?.timesCopied || 0);
                        const bCount = Number(b?.timesCopied || 0);
                        if (bCount !== aCount) return bCount - aCount;
                        return (b?.timestamp || 0) - (a?.timestamp || 0);
                    })
                    .filter((item) => (item?.text || '').trim().length > 0)
                    .slice(0, limit);
                sendResponse({ items: sorted });
            });
            return true;
        }
            
        case 'getPinnedItems':
            chrome.storage.local.get(['pinnedItems']).then(data => {
                sendResponse({ items: data.pinnedItems || [] });
            });
            return true;
            
        case 'addToClipboard':
            addToClipboardHistory(message.text).then(success => {
                sendResponse({ success });
            });
            return true;
            
        case 'deleteItem':
            deleteItem(message.itemId, message.type).then(success => {
                sendResponse({ success });
            });
            return true;

        case 'updateClipboardItem':
            updateClipboardItem(
                message.itemId,
                message.payload || {},
                message.type || 'history'
            ).then(result => {
                sendResponse(result);
            });
            return true;
            
        case 'pinItem':
            pinItem(message.itemId).then(result => {
                sendResponse(result);
            });
            return true;
            
        case 'checkLicenseStatus':
            isProUser().then(isPro => {
                sendResponse({ isPro });
            });
            return true;
            
        case 'getLimits':
            Promise.all([getMaxHistoryItems(), getMaxPinnedItems(), getMaxSnippets(), isProUser(), getLicenseInfo()]).then(([maxHistory, maxPinned, maxSnippets, isPro, licenseInfo]) => {
                sendResponse({ 
                    maxHistory, 
                    maxPinned, 
                    maxSnippets,
                    isPro,
                    freeHistoryLimit: MAX_HISTORY_ITEMS_FREE,
                    freePinnedLimit: MAX_PINNED_ITEMS_FREE,
                    freeSnippetsLimit: MAX_SNIPPETS_FREE,
                    expiresAt: licenseInfo?.expiresAt || null,
                    activatedAt: licenseInfo?.activatedAt || null,
                    planLabel: licenseInfo?.planLabel || null,
                    nextChargeAt: licenseInfo?.nextChargeAt || null,
                    subscriptionCancelled: Boolean(licenseInfo?.subscriptionCancelled),
                    status: licenseInfo?.status || null
                });
            });
            return true;
            
        case 'unpinItem':
            unpinItem(message.itemId, message.text).then(success => {
                sendResponse({ success });
            });
            return true;
            
        case 'verifyLicense':
            verifyLicense(message.licenseKey, {
                incrementUseCount: true,
                enforceUsageLimit: true
            }).then(result => {
                sendResponse(result);
            });
            return true;
            
        case 'getLicenseInfo':
            getLicenseInfo().then(licenseInfo => {
                sendResponse({ licenseInfo });
            });
            return true;

        case 'setContextText': {
            const text = typeof message.text === 'string' ? message.text.trim() : '';
            if (!text) {
                sendResponse({ success: false, error: 'invalid_text' });
                return false;
            }
            const payload = {
                text,
                source: message.source || 'context_menu',
                timestamp: Date.now()
            };
            chrome.storage.local.set({ contextMenuSelection: payload })
                .then(() => sendResponse({ success: true }))
                .catch(error => {
                    console.error('Failed to cache context menu text:', error);
                    sendResponse({ success: false, error: 'storage_error' });
                });
            return true;
        }
            
        case 'checkPremiumFeature':
            isPremiumFeatureEnabled(message.feature).then(enabled => {
                sendResponse({ enabled });
            });
            return true;
            
        case 'saveSettings':
            chrome.storage.local.get(['settings']).then((data) => {
                const existing = data.settings || {};
                const merged = { keyboardShortcuts: true, ...existing, ...(message.settings || {}) };
                return chrome.storage.local.set({ settings: merged }).then(() => merged);
            }).then((merged) => {
                const autoSaveEnabled = merged?.autoSave !== false;
                updateActionStatusBadge(autoSaveEnabled);
                sendResponse({ success: true, settings: merged });
            });
            return true;
            
        case 'getSettings':
            chrome.storage.local.get(['settings']).then(data => {
                const merged = { keyboardShortcuts: true, ...(data.settings || {}) };
                sendResponse({ settings: merged });
            });
            return true;
            
        case 'saveSnippets':
            getMaxSnippets().then(maxSnippets => {
                const incoming = Array.isArray(message.snippets) ? message.snippets : [];
                const limited = incoming.slice(0, maxSnippets);
                chrome.storage.local.set({ snippets: limited }).then(() => {
                    sendResponse({ success: true, count: limited.length });
                });
            });
            return true;
            
        case 'getSnippets':
            chrome.storage.local.get(['snippets']).then(data => {
                const items = data.snippets || [];
                sendResponse({ items, snippets: items });
            });
            return true;
            
        case 'deleteSnippet':
            chrome.storage.local.get(['snippets']).then(data => {
                const snippets = data.snippets || [];
                const filtered = snippets.filter(s => s.shortcut !== message.shortcut);
                chrome.storage.local.set({ snippets: filtered }).then(() => {
                    sendResponse({ success: true });
                });
            });
            return true;
            
        case 'exportData':
            chrome.storage.local.get([
                'clipboardHistory', 'pinnedItems', 'snippets', 'settings', 'analytics'
            ]).then(data => {
                sendResponse({ 
                    data: {
                        version: '5.0.0',
                        exportDate: new Date().toISOString(),
                        ...data
                    }
                });
            });
            return true;
            
        case 'importData':
            chrome.storage.local.set(message.data).then(() => {
                sendResponse({ success: true });
            });
            return true;
            
        case 'clearAllData':
            chrome.storage.local.set({
                clipboardHistory: [],
                pinnedItems: [],
                snippets: [],
                analytics: getDefaultAnalytics()
            }).then(() => {
                sendResponse({ success: true });
            });
            return true;

        case 'clearClipboardHistory':
            clearClipboardHistory().then(success => {
                sendResponse({ success });
            });
            return true;
            
        case 'createBackup':
            chrome.storage.local.get([
                'clipboardHistory', 'pinnedItems', 'snippets', 'settings', 'analytics'
            ]).then(data => {
                const backupId = Date.now().toString();
                const backup = {
                    id: backupId,
                    timestamp: Date.now(),
                    data: data
                };
                chrome.storage.local.get(['backups']).then(backupData => {
                    const backups = backupData.backups || {};
                    backups[backupId] = backup;
                    chrome.storage.local.set({ backups }).then(() => {
                        sendResponse({ success: true, backupId });
                    });
                });
            });
            return true;
            
        case 'getAnalytics':
            chrome.storage.local.get(['analytics', 'snippets', 'pinnedItems']).then(data => {
                const analytics = { ...getDefaultAnalytics(), ...(data.analytics || {}) };
                const pinnedCount = (data.pinnedItems || []).length;
                const snippetCount = (data.snippets || []).length;
                if (analytics.schemaVersion !== ANALYTICS_SCHEMA_VERSION) {
                    analytics.totalPins = pinnedCount;
                    analytics.totalSnippets = snippetCount;
                    analytics.schemaVersion = ANALYTICS_SCHEMA_VERSION;
                    chrome.storage.local.set({ analytics }).catch(() => {});
                }
                analytics.timeSaved = analytics.timeSaved || calculateTimeSavedMinutes(analytics.charactersPasted);
                sendResponse({ analytics });
            });
            return true;
            
        case 'saveToHistory':
            addToClipboardHistory(message.text).then(success => {
                sendResponse({ success });
            });
            return true;
            
        case 'getDeletedItemsHistory':
            getDeletedItemsHistory().then(history => {
                sendResponse({ history });
            });
            return true;
            
        case 'restoreDeletedItem':
            restoreDeletedItem(message.textHash).then(result => {
                sendResponse(result);
            });
            return true;
            
        case 'removeFromBlacklist':
            removeFromBlacklist(message.textHash).then(success => {
                sendResponse({ success });
            });
            return true;

        case 'purgeDeletedItem':
            purgeDeletedItem(message.textHash).then(result => {
                sendResponse(result);
            });
            return true;

        case 'recordUsage':
            recordUsageMetrics(message.payload || {}).then(result => {
                sendResponse(result);
            });
            return true;
    }
    
    return false;
});

// Delete item
async function deleteItem(itemId, type = 'history') {
    try {
        const storageKey = type === 'pinned' ? 'pinnedItems' : 'clipboardHistory';
        const data = await chrome.storage.local.get([storageKey]);
        const items = data[storageKey] || [];
        
        // Find the item to get its text before deleting
        const itemToDelete = items.find(item => item.id === itemId);
        
        // Remove from storage
        const filteredItems = items.filter(item => item.id !== itemId);
        await chrome.storage.local.set({ [storageKey]: filteredItems });
        
        // Add to blacklist and save for recovery
        if (itemToDelete && itemToDelete.text) {
            await addToBlacklist(itemToDelete.text, itemToDelete.id);
            console.log('Item deleted and added to blacklist:', itemToDelete.text.substring(0, 50));
        }
        
        return true;
    } catch (error) {
        console.error('Error deleting item:', error);
        return false;
    }
}

async function clearClipboardHistory() {
    try {
        await chrome.storage.local.set({ clipboardHistory: [] });
        lastClipboardContent = '';
        return true;
    } catch (error) {
        console.error('Error clearing clipboard history:', error);
        return false;
    }
}

async function updateClipboardItem(itemId, payload = {}, type = 'history') {
    try {
        const useIndexedDB = await shouldUseIndexedDB();
        const data = await chrome.storage.local.get(['clipboardHistory', 'pinnedItems']);
        let history = data.clipboardHistory || [];
        let pinned = data.pinnedItems || [];

        const primaryList = type === 'pinned' ? pinned : history;
        const secondaryList = type === 'pinned' ? history : pinned;

        let primaryIndex = primaryList.findIndex((item) => item.id === itemId);
        let secondaryIndex = secondaryList.findIndex((item) => item.id === itemId);

        let current =
            primaryIndex !== -1
                ? primaryList[primaryIndex]
                : secondaryIndex !== -1
                    ? secondaryList[secondaryIndex]
                    : null;

        let currentSource = primaryIndex !== -1 ? type : (secondaryIndex !== -1 ? (type === 'pinned' ? 'history' : 'pinned') : null);

        // Fallback to IndexedDB if we are using it and the item isn't in storage
        let dbInstance = null;
        if (!current && useIndexedDB && type === 'history') {
            try {
                dbInstance = await ensureClipboardDB();
                current = await dbInstance.getHistoryItem(itemId);
                currentSource = 'history';
            } catch (error) {
                console.warn('Failed to read item from IndexedDB:', error);
            }
        }

        if (!current) {
            return { success: false, error: 'not_found' };
        }

        const nextText = typeof payload.text === 'string' ? payload.text : current.text;
        const originalText = current.text;
        if (!nextText || !nextText.trim()) {
            return { success: false, error: 'invalid_text' };
        }

        const normalized = { ...payload };
        if (Object.prototype.hasOwnProperty.call(normalized, 'title')) {
            normalized.title = (normalized.title || '').trim().substring(0, 120);
            if (!normalized.title) {
                delete normalized.title;
            }
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'emoji')) {
            const trimmed = (normalized.emoji || '').trim().substring(0, 4);
            normalized.emoji = trimmed; // allow empty string to clear emoji
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'language')) {
            normalized.language = (normalized.language || '').trim().substring(0, 20);
            if (!normalized.language) {
                delete normalized.language;
            }
        }
        if (Object.prototype.hasOwnProperty.call(normalized, 'timesCopied')) {
            const value = Number(normalized.timesCopied);
            normalized.timesCopied = Number.isFinite(value) && value >= 0 ? Math.floor(value) : current.timesCopied || 0;
        }

        const updatedItem = {
            ...current,
            ...normalized,
            text: nextText,
            type: detectTextType(nextText),
            updatedAt: Date.now()
        };

        if (useIndexedDB && currentSource === 'history') {
            try {
                const db = dbInstance || await ensureClipboardDB();
                await db.updateHistoryItem(itemId, updatedItem);
            } catch (error) {
                console.warn('Failed to update history item in IndexedDB:', error);
            }
        }

        const replaceItem = (list = []) =>
            list.map((item) => {
                const matchesId = item.id === itemId;
                const matchesText = item.text === originalText;
                return matchesId || matchesText ? updatedItem : item;
            });

        history = replaceItem(history);
        pinned = replaceItem(pinned);

        await chrome.storage.local.set({ clipboardHistory: history, pinnedItems: pinned });

        return { success: true, item: updatedItem };
    } catch (error) {
        console.error('Error updating clipboard item:', error);
        return { success: false, error: 'update_failed' };
    }
}

// Pin item
async function pinItem(itemId) {
    try {
        const data = await chrome.storage.local.get(['clipboardHistory', 'pinnedItems']);
        const history = data.clipboardHistory || [];
        const pinned = data.pinnedItems || [];
        
        // Check limits
        const maxPinned = await getMaxPinnedItems();
        const isPro = await isProUser();
        
        if (!isPro && pinned.length >= maxPinned) {
            // Show upgrade notification
            chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: 'Pinned Items Limit Reached',
                message: `Free users can pin up to ${MAX_PINNED_ITEMS_FREE} items. Upgrade to Pro for ${MAX_PINNED_ITEMS_PRO} pinned items!`
            });
            return { success: false, limitReached: true, isPro: false };
        }
        
        // Try to find in history first
        let item = history.find(h => h.id === itemId);
        
        // If not found in history, try pinned items
        if (!item) {
            item = pinned.find(p => p.id === itemId);
        }
        
        if (!item) {
            console.error('Item not found for pinning:', itemId);
            return { success: false, error: 'Item not found' };
        }
        
        // Check if already pinned (by text content)
        if (pinned.find(p => p.text === item.text)) {
            console.log('Item already pinned');
            return { success: false, error: 'Already pinned' };
        }
        
        // Add to pinned with new ID if needed
        const pinnedItem = {
            ...item,
            id: item.id || generateStableId(),
            pinnedAt: Date.now()
        };
        pinned.unshift(pinnedItem);
        
        // Limit pinned items
        if (pinned.length > maxPinned) {
            pinned.splice(maxPinned);
        }
        
        await chrome.storage.local.set({ pinnedItems: pinned });
        console.log('Item pinned successfully:', itemId);
        await recordUsageMetrics({ event: 'item_pinned' });
        return { success: true };
    } catch (error) {
        console.error('Error pinning item:', error);
        return { success: false, error: error.message };
    }
}

// Unpin item
async function unpinItem(itemId, itemText = '') {
    try {
        const data = await chrome.storage.local.get(['pinnedItems']);
        const pinned = data.pinnedItems || [];
        const normalizedText = (itemText || '').trim();
        
        const filteredPinned = pinned.filter((item) => {
            const matchesId = item.id === itemId;
            const matchesText = normalizedText && (item.text || '').trim() === normalizedText;
            return !matchesId && !matchesText;
        });
        await chrome.storage.local.set({ pinnedItems: filteredPinned });
        
        return true;
    } catch (error) {
        console.error('Error unpinning item:', error);
        return false;
    }
}

async function recordUsageMetrics(payload = {}) {
    try {
        const { source = 'history', charCount = 0, event = null } = payload;
        const analytics = await mutateAnalytics((data) => {
            if (event === 'snippet_created') {
                data.totalSnippets = (data.totalSnippets || 0) + 1;
                return;
            }
            if (event === 'item_pinned') {
                data.totalPins = (data.totalPins || 0) + 1;
                return;
            }
            if (source === 'pin') {
                data.totalPins = (data.totalPins || 0) + 1;
            } else {
                data.totalCopies = (data.totalCopies || 0) + 1;
            }
            if (charCount > 0) {
                data.charactersPasted = (data.charactersPasted || 0) + charCount;
                data.timeSaved = calculateTimeSavedMinutes(data.charactersPasted);
            }
        });
        return { success: true, analytics };
    } catch (error) {
        console.error('Error recording usage metrics:', error);
        return { success: false, error: error.message };
    }
}

async function purgeDeletedItem(textHash) {
    try {
        const data = await chrome.storage.local.get([DELETED_ITEMS_HISTORY_KEY]);
        const history = data[DELETED_ITEMS_HISTORY_KEY] || [];
        const filtered = history.filter(item => item.textHash !== textHash);
        await chrome.storage.local.set({ [DELETED_ITEMS_HISTORY_KEY]: filtered });
        await removeFromBlacklist(textHash);
        return { success: true };
    } catch (error) {
        console.error('Error purging deleted item:', error);
        return { success: false, error: error.message };
    }
}

console.log('Smart Clipboard Pro Enhanced v5.0 - Background script loaded');
function validateLicenseKey(licenseKey) {
    const normalized = normalizeLicenseKeyInput(licenseKey);
    if (!normalized || !LICENSE_PATTERN.test(normalized)) {
        return { valid: false, error: 'Invalid license format. Use XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX' };
    }
    return { valid: true, normalized };
}
