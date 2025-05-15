// ======================================================
// --- background.js (Final - English Only & Core Fixes) ---
// ======================================================

const MAX_HISTORY_ITEMS_PREMIUM = 100;
const MAX_HISTORY_ITEMS_FREE = 10;
const MAX_PINS_FREE = 2;

// --- Initialization ---
chrome.runtime.onInstalled.addListener((details) => {
    console.log('Smart Clipboard Pro Installed/Updated. Reason:', details.reason);
    chrome.storage.local.get(['clipboardHistory', 'pinnedItems', 'snippets', 'subscriptionStatus'], (data) => {
        if (!data.clipboardHistory) chrome.storage.local.set({ clipboardHistory: [] });
        if (!data.pinnedItems) chrome.storage.local.set({ pinnedItems: [] });
        if (!data.snippets) chrome.storage.local.set({ snippets: [] });
        if (!data.subscriptionStatus) chrome.storage.local.set({ subscriptionStatus: { active: false, licenseKey: null, endDate: null } });
    });

    chrome.contextMenus.create({
        id: "saveToSmartClipboardContextMenu_Final",
        title: "Save selection to Smart Clipboard Pro",
        contexts: ["selection"]
    }, () => {
        if (chrome.runtime.lastError) {
            console.warn("Error creating context menu (Final):", chrome.runtime.lastError.message);
        }
    });
});

// --- Context Menu Listener ---
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "saveToSmartClipboardContextMenu_Final" && info.selectionText) {
        addToClipboardHistory(info.selectionText);
    }
});

// --- Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background (Final) received message:", message.action, message);
    switch (message.action) {
        case "addToClipboard":
            addToClipboardHistory(message.text)
                .then((itemAddedOrMoved) => sendResponse({ success: true, itemAddedOrMoved }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        case "pinItem":
            pinItemById(message.itemId)
                .then(success => sendResponse({ success }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        case "unpinItem":
            unpinItemById(message.itemId)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        case "deleteItem":
            deleteItemById(message.itemId, message.itemType)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        case "getSnippets":
            chrome.storage.local.get('snippets', (data) => {
                sendResponse({ snippets: data.snippets || [] });
            });
            return true;
        case "saveSnippets":
             saveSnippetsToStorage(message.snippets, sendResponse);
             return true;
        case "checkSubscription":
             checkLocalSubscriptionStatus()
                .then(status => sendResponse(status))
                .catch(error => sendResponse({ active: false, licenseKey: null, endDate: null, error: error.message }));
             return true;
        case "verifyLicenseKey":
            verifyLicenseKeyWithGumroad(message.licenseKey, sendResponse);
            return true;
        case "saveReorderedList":
            saveReorderedListToStorage(message.listType, message.items)
                .then(() => sendResponse({ success: true }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;
        default:
            sendResponse({ success: false, error: "Unknown action" });
            return false;
    }
});

// --- Clipboard Management ---
async function addToClipboardHistory(text) {
    if (!text || typeof text !== 'string' || text.trim() === '') {
        console.log("Background: addToClipboardHistory - empty text ignored.");
        return false;
    }
    try {
        const data = await chrome.storage.local.get(['clipboardHistory', 'subscriptionStatus']);
        let history = data.clipboardHistory || [];
        const status = data.subscriptionStatus || { active: false };

        const existingItemIndex = history.findIndex(item => item.text === text);
        let itemAddedOrMoved = false;

        if (existingItemIndex !== -1) {
            // Item exists, remove it from its current position and add to top
            const existingItem = history.splice(existingItemIndex, 1)[0];
            existingItem.timestamp = Date.now();
            history.unshift(existingItem);
            console.log("Background: Existing item moved to top of history.");
            itemAddedOrMoved = true;
        } else {
            // Item is new, add it
            const newItem = {
                id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
                text: text,
                timestamp: Date.now()
            };
            history.unshift(newItem);
            itemAddedOrMoved = true;
            console.log("Background: New item added to history.");
        }

        const limit = status.active ? MAX_HISTORY_ITEMS_PREMIUM : MAX_HISTORY_ITEMS_FREE;
        if (history.length > limit) {
            history = history.slice(0, limit);
        }

        await chrome.storage.local.set({ clipboardHistory: history });
        console.log("Background: History updated. New count:", history.length);
        // Always broadcast update if any change (new or moved) happened
        if (itemAddedOrMoved) {
            broadcastUpdateToAllParts('updatePopup');
        }
        return itemAddedOrMoved;
    } catch (error) {
        console.error("Background: Error adding/updating clipboard history:", error);
        return false;
    }
}

async function pinItemById(itemId) {
    try {
        const data = await chrome.storage.local.get(['clipboardHistory', 'pinnedItems', 'subscriptionStatus']);
        const history = data.clipboardHistory || [];
        let pinned = data.pinnedItems || [];
        const status = data.subscriptionStatus || { active: false };

        if (!status.active && pinned.length >= MAX_PINS_FREE) {
            console.warn("Background: Free user pin limit reached.");
            broadcastUpdateToAllParts('showError', { messageKey: "maxPinReachedFree" }); // Using English key for now
            return false;
        }

        let itemToPin = history.find(item => item.id === itemId);
        if (!itemToPin) {
            itemToPin = pinned.find(item => item.id === itemId);
        }
        
        if (itemToPin && !pinned.some(p => p.id === itemId)) {
            pinned.unshift({ ...itemToPin });
            await chrome.storage.local.set({ pinnedItems: pinned });
            console.log("Background: Item pinned. New count:", pinned.length);
            broadcastUpdateToAllParts('updatePopup');
            return true;
        }
        console.log("Background: Item not found for pinning or already pinned.");
        return false;
    } catch (error) {
        console.error("Background: Error pinning item:", error);
        return false;
    }
}

async function unpinItemById(itemId) {
    try {
        const data = await chrome.storage.local.get('pinnedItems');
        let pinned = data.pinnedItems || [];
        const initialLength = pinned.length;
        pinned = pinned.filter(item => item.id !== itemId);
        if (pinned.length < initialLength) {
            await chrome.storage.local.set({ pinnedItems: pinned });
            console.log("Background: Item unpinned.");
            broadcastUpdateToAllParts('updatePopup');
        }
    } catch (error) { console.error("Background: Error unpinning item:", error); }
}

async function deleteItemById(itemId, itemType) {
    const storageKey = itemType === 'pinned' ? 'pinnedItems' : (itemType === 'snippets' ? 'snippets' : 'clipboardHistory');
    try {
        const data = await chrome.storage.local.get(storageKey);
        let items = data[storageKey] || [];
        const initialLength = items.length;
        items = items.filter(item => item.id !== itemId);
        if (items.length < initialLength) {
            await chrome.storage.local.set({ [storageKey]: items });
            console.log(`Background: Item deleted from ${itemType}.`);
            if (itemType === 'snippets') {
                 await broadcastUpdateToAllParts('snippetsUpdated');
            }
            await broadcastUpdateToAllParts('updatePopup'); // Always update popup
        }
    } catch (error) { console.error(`Background: Error deleting from ${itemType}:`, error); }
}

async function saveSnippetsToStorage(snippets, sendResponse) {
     try {
         await chrome.storage.local.set({ snippets: snippets });
         console.log("Background: Snippets saved.");
         await broadcastUpdateToAllParts('snippetsUpdated');
         await broadcastUpdateToAllParts('updatePopup');
         sendResponse({ success: true });
     } catch (error) {
         console.error("Background: Error saving snippets:", error);
         sendResponse({ success: false, error: error.message });
     }
 }

async function saveReorderedListToStorage(listType, items) {
    const storageKey = listType === 'pinned' ? 'pinnedItems' : 'clipboardHistory';
    try {
        await chrome.storage.local.set({ [storageKey]: items });
        console.log(`Background: Reordered ${listType} list saved.`);
        // No broadcast needed here as the popup handles its own re-render after drop
    } catch (error) {
        console.error(`Background: Error saving reordered ${listType} list:`, error);
    }
}

// --- Subscription Management (Gumroad License Key) ---
async function checkLocalSubscriptionStatus() {
    try {
        const data = await chrome.storage.local.get('subscriptionStatus');
        return data.subscriptionStatus || { active: false, licenseKey: null, endDate: null };
    } catch (error) {
        console.error("Background: Error checking local subscription:", error);
        return { active: false, licenseKey: null, endDate: null };
    }
}

async function updateLocalSubscriptionInStorage(isActive, licenseKey, expiryDate = null) {
     const newStatus = { active: isActive, licenseKey: isActive ? licenseKey : null, endDate: isActive ? expiryDate : null };
     try {
         await chrome.storage.local.set({ subscriptionStatus: newStatus });
         console.log("Background: Local subscription status updated in storage:", newStatus);
         broadcastUpdateToAllParts('subscriptionUpdated');
     } catch (error) { console.error("Background: Error updating local subscription in storage:", error); }
 }

async function verifyLicenseKeyWithGumroad(licenseKey, sendResponse) {
    if (!licenseKey) {
        sendResponse({ success: false, error: "No license key provided.", messageKey: 'licenseMessageInvalid' });
        return;
    }
    console.log(`Background: Verifying license key with Gumroad: ${licenseKey}`);
    const GUMROAD_PRODUCT_PERMALINK = 'imwysv'; // Your Gumroad product permalink
    const verifyUrl = 'https://api.gumroad.com/v2/licenses/verify';

    try {
        const response = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                'product_permalink': GUMROAD_PRODUCT_PERMALINK,
                'license_key': licenseKey.trim()
            })
        });
        const data = await response.json();

        if (data.success) {
            const purchase = data.purchase;
            const isActiveNow = !(purchase.subscription_cancelled_at ||
                                  purchase.subscription_failed_at ||
                                  purchase.chargebacked ||
                                  purchase.refunded);
            
            console.log("Background: Gumroad license verification response:", data);
            await updateLocalSubscriptionInStorage(isActiveNow, licenseKey, null); // Gumroad doesn't provide a clear expiry for active subs here
            sendResponse({ success: true, active: isActiveNow, messageKey: isActiveNow ? 'licenseMessageSuccess' : 'licenseMessageInvalid' });
        } else {
            console.warn("Background: Gumroad license verification failed:", data.message || 'Invalid key');
            await updateLocalSubscriptionInStorage(false, null);
            sendResponse({ success: false, active: false, error: data.message || 'Invalid license key', messageKey: 'licenseMessageInvalid' });
        }
    } catch (error) {
        console.error("Background: Error verifying license with Gumroad:", error);
        sendResponse({ success: false, error: `Network or API error: ${error.message}`, messageKey: 'errorGeneric' });
    }
}

// --- Broadcast Updates ---
async function broadcastUpdateToAllParts(action, data = {}) {
    const message = { action, ...data };
    try {
        chrome.runtime.sendMessage(message).catch(err => {
            if (err.message && !err.message.includes("Receiving end does not exist")) {
                // console.warn("Background: Error sending runtime message:", err.message);
            }
        });
        const tabs = await chrome.tabs.query({url: ["http://*/*", "https://*/*"]});
        tabs.forEach(tab => {
            if (tab.id) { // Check if tab.id is defined
                chrome.tabs.sendMessage(tab.id, message).catch(err => {
                    if (err.message && !err.message.includes("Receiving end does not exist")) {
                        // console.warn(`Background: Error sending message to tab ${tab.id}: ${err.message}`);
                    }
                });
            }
        });
        console.log("Background: Broadcast update sent:", action);
    } catch (error) { console.error("Background: Error broadcasting update:", error); }
}

console.log("Background service worker (Final Version) started.");
