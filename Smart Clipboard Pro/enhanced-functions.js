// --- Enhanced Helper Functions for Smart Clipboard Pro ---
// =========================================================

// Generate unique ID
export function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

// Detect text category
export function detectTextCategory(text) {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
    const phoneRegex = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    const codeRegex = /^\s*(function|class|const|let|var|if|for|while|\{|\})/m;
    
    if (emailRegex.test(text)) return 'email';
    if (urlRegex.test(text)) return 'url';
    if (phoneRegex.test(text)) return 'phone';
    if (codeRegex.test(text)) return 'code';
    if (text.length > 200) return 'document';
    if (text.split('\n').length > 3) return 'multiline';
    
    return 'text';
}

// Get clipboard items
export async function getClipboardItems() {
    try {
        const data = await chrome.storage.local.get(['clipboardHistory']);
        return data.clipboardHistory || [];
    } catch (error) {
        console.error('Error getting clipboard items:', error);
        return [];
    }
}

// Get pinned items
export async function getPinnedItems() {
    try {
        const data = await chrome.storage.local.get(['pinnedItems']);
        return data.pinnedItems || [];
    } catch (error) {
        console.error('Error getting pinned items:', error);
        return [];
    }
}

// Get snippets
export async function getSnippets() {
    try {
        const data = await chrome.storage.local.get(['snippets']);
        return data.snippets || [];
    } catch (error) {
        console.error('Error getting snippets:', error);
        return [];
    }
}

// Save snippets
export async function saveSnippets(snippets) {
    try {
        await chrome.storage.local.set({ snippets });
        return true;
    } catch (error) {
        console.error('Error saving snippets:', error);
        return false;
    }
}

// Get settings
export async function getSettings() {
    try {
        const data = await chrome.storage.local.get(['settings']);
        return data.settings || {
            autoSync: true,
            autoBackup: true,
            maxHistoryItems: 50,
            theme: 'light',
            notifications: true,
            shortcuts: true,
            autoClean: false,
            syncInterval: 24
        };
    } catch (error) {
        console.error('Error getting settings:', error);
        return {};
    }
}

// Save settings
export async function saveSettings(settings) {
    try {
        await chrome.storage.local.set({ settings });
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
}

// Get analytics
export async function getAnalytics() {
    try {
        const data = await chrome.storage.local.get(['analytics']);
        return data.analytics || {
            totalCopies: 0,
            totalPastes: 0,
            snippetsUsed: 0,
            lastUsed: Date.now()
        };
    } catch (error) {
        console.error('Error getting analytics:', error);
        return {};
    }
}

// Update analytics
export async function updateAnalytics(action) {
    try {
        const data = await chrome.storage.local.get(['analytics']);
        const analytics = data.analytics || {
            totalCopies: 0,
            totalPastes: 0,
            snippetsUsed: 0,
            lastUsed: Date.now()
        };
        
        switch (action) {
            case 'totalCopies':
                analytics.totalCopies++;
                break;
            case 'totalPastes':
                analytics.totalPastes++;
                break;
            case 'snippetsUsed':
                analytics.snippetsUsed++;
                break;
        }
        
        analytics.lastUsed = Date.now();
        await chrome.storage.local.set({ analytics });
        return true;
    } catch (error) {
        console.error('Error updating analytics:', error);
        return false;
    }
}

// Export all data
export async function exportAllData() {
    try {
        const data = await chrome.storage.local.get([
            'clipboardHistory',
            'pinnedItems', 
            'snippets',
            'settings',
            'analytics'
        ]);
        
        return {
            version: '4.1.0',
            exportDate: new Date().toISOString(),
            data: data
        };
    } catch (error) {
        console.error('Error exporting data:', error);
        throw error;
    }
}

// Create backup
export async function createManualBackup() {
    try {
        const backupData = await exportAllData();
        const backups = await chrome.storage.local.get('backups') || { backups: {} };
        const backupId = generateId();
        
        backups.backups = backups.backups || {};
        backups.backups[backupId] = {
            ...backupData,
            id: backupId,
            type: 'manual'
        };
        
        await chrome.storage.local.set({
            backups: backups.backups,
            lastBackupTime: Date.now()
        });
        
        return backupData;
    } catch (error) {
        console.error('Error creating backup:', error);
        throw error;
    }
}

// Import all data
export async function importAllData(importData) {
    try {
        if (!importData || !importData.data) {
            throw new Error('Invalid import data');
        }
        
        await chrome.storage.local.set(importData.data);
        return true;
    } catch (error) {
        console.error('Error importing data:', error);
        throw error;
    }
}

// Clean old history items
export async function cleanOldHistoryItems() {
    try {
        const data = await chrome.storage.local.get(['clipboardHistory']);
        const history = data.clipboardHistory || [];
        
        const maxItems = 500;
        
        if (history.length > maxItems) {
            const cleanedHistory = history.slice(-maxItems);
            await chrome.storage.local.set({ clipboardHistory: cleanedHistory });
        }
        
        return true;
    } catch (error) {
        console.error('Error cleaning old items:', error);
        return false;
    }
}