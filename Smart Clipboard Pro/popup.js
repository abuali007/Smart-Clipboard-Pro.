// ======================================================
// --- popup.js (Final - English Only & Core Fixes) ---
// ======================================================

// DOM Elements
const historyListEl = document.getElementById('historyList');
const pinnedListEl = document.getElementById('pinnedList');
const snippetListEl = document.getElementById('snippetList');
const searchInputEl = document.getElementById('searchInput');
const upgradeSectionEl = document.getElementById('upgradeSection');
const upgradeButtonEl = document.getElementById('upgradeButton');
const settingsButtonEl = document.getElementById('settingsButton');
const tabsButtons = document.querySelectorAll('.tab-button');
const tabContentsEls = document.querySelectorAll('.tab-content');
const usageLimitSectionEl = document.getElementById('usageLimitSection');
const historyCountEl = document.getElementById('historyCount');
const historyMaxEl = document.getElementById('historyMax');
const pinnedCountEl = document.getElementById('pinnedCount');
const pinnedMaxEl = document.getElementById('pinnedMax');
const snippetLimitMessageEl = document.getElementById('snippetLimitMessage');

// Constants
const MAX_FREE_HISTORY = 10;
const MAX_FREE_PINS = 2;
const GUMROAD_LINK = 'https://azdynamo7.gumroad.com/l/imwysv';

// State
let isSubscribed = false;
let allHistoryItems = [];
let allPinnedItems = [];
let allSnippets = [];
let draggedItemId = null;
let draggedItemElement = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Popup DOMContentLoaded - Final Version");
    await loadSubscriptionStatus();
    await loadInitialData(); // This will also call renderAllLists and updateUIVisibility
    setupTabs();
    setupEventListeners();

    window.addEventListener('focus', readClipboardOnPopupOpen);
    if (document.hasFocus()) { // Initial attempt if already focused
        readClipboardOnPopupOpen();
    }
});

// --- Subscription & Data Loading ---
async function loadSubscriptionStatus() {
    try {
        const data = await chrome.storage.local.get(['subscriptionStatus']);
        const status = data.subscriptionStatus || { active: false, licenseKey: null };
        isSubscribed = !!(status.active && status.licenseKey);
        console.log("Popup: Subscription status loaded:", isSubscribed);
    } catch (error) {
        console.error("Popup: Error loading subscription status:", error);
        isSubscribed = false;
    }
}

async function loadInitialData() {
    console.log("Popup: Loading initial data...");
    try {
        const data = await chrome.storage.local.get(['clipboardHistory', 'pinnedItems', 'snippets']);
        allHistoryItems = data.clipboardHistory || [];
        allPinnedItems = data.pinnedItems || [];
        allSnippets = data.snippets || [];
        console.log("Popup: Initial data loaded", { history: allHistoryItems.length, pinned: allPinnedItems.length, snippets: allSnippets.length });
        renderAllLists(); // This will also call updateUIVisibility
    } catch (error) {
        console.error("Popup: Error loading initial data:", error);
        if (historyListEl) historyListEl.innerHTML = `<li class="placeholder">Error loading history.</li>`;
        if (pinnedListEl) pinnedListEl.innerHTML = `<li class="placeholder">Error loading pinned items.</li>`;
        if (snippetListEl) snippetListEl.innerHTML = `<li class="placeholder">Error loading snippets.</li>`;
    }
}

function renderAllLists() {
    console.log("Popup: Rendering all lists...");
    renderList(historyListEl, filterAndLimitItems(allHistoryItems, searchInputEl.value), 'history');
    renderList(pinnedListEl, filterAndLimitItems(allPinnedItems, ''), 'pinned');
    renderList(snippetListEl, allSnippets, 'snippets');
    updateUIVisibility(); // Ensure UI reflects current state after rendering
}

// --- UI Rendering & Filtering ---
function filterAndLimitItems(items, searchTerm) {
    const lowerSearchTerm = searchTerm.toLowerCase();
    const filtered = items.filter(item => item.text && typeof item.text === 'string' && item.text.toLowerCase().includes(lowerSearchTerm));
    // Actual limiting of history count is done in background.js when adding.
    return filtered;
}

function renderList(listElement, items, type) {
    if (!listElement) {
        console.warn(`List element for type "${type}" not found during render.`);
        return;
    }
    listElement.innerHTML = ''; // Clear previous items

    let placeholderText = "No items.";
    if (type === 'history') placeholderText = "No items in history yet. Copied items will appear here.";
    else if (type === 'pinned') placeholderText = "No pinned items. Click the pin icon on a history item to pin it.";
    else if (type === 'snippets') placeholderText = "No snippets added yet. Go to settings to add them (Premium feature).";

    if (items.length === 0) {
        listElement.innerHTML = `<li class="placeholder">${placeholderText}</li>`;
    } else {
        items.forEach((item, index) => {
            const li = document.createElement('li');
            li.dataset.id = item.id;
            li.dataset.index = index; // For drag-drop reference
            li.title = item.text; // Tooltip for full text
            if (type === 'history' || type === 'pinned') { // Only history and pinned are draggable
                li.draggable = true;
            }

            const textSpan = document.createElement('span');
            textSpan.className = 'item-text';
            textSpan.textContent = item.text;
            li.appendChild(textSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'item-actions';

            const copyButton = createActionButton('📄', "Copy", () => copyToClipboard(item.text));
            actionsDiv.appendChild(copyButton);

            if (type === 'history' || type === 'pinned') {
                const isCurrentlyPinned = allPinnedItems.some(pinnedItem => pinnedItem.id === item.id);
                const pinIcon = isCurrentlyPinned ? '📌' : '📍';
                const pinTitle = isCurrentlyPinned ? "Unpin" : "Pin";
                const pinAction = isCurrentlyPinned ? () => unpinItem(item.id) : () => pinItem(item.id);

                if ( (type === 'history' && (isSubscribed || allPinnedItems.length < MAX_FREE_PINS || isCurrentlyPinned)) || type === 'pinned') {
                    const pinButton = createActionButton(pinIcon, pinTitle, pinAction);
                    actionsDiv.appendChild(pinButton);
                }
            }

            const deleteButton = createActionButton('🗑️', "Delete", () => deleteItem(item.id, type));
            actionsDiv.appendChild(deleteButton);

            li.appendChild(actionsDiv);
            // Click on the list item (but not on action buttons) to copy
            li.addEventListener('click', (e) => {
                if (!e.target.closest('.item-actions')) {
                    copyToClipboard(item.text);
                }
            });
            listElement.appendChild(li);
        });
    }
    updateUsageLimitDisplay(); // Update usage counts after rendering
}

function createActionButton(icon, title, onClick) {
    const button = document.createElement('button');
    button.textContent = icon;
    button.title = title;
    button.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent li click event
        onClick();
    });
    return button;
}

// --- UI Visibility Updates ---
function updateUIVisibility() {
    console.log("Popup: Updating UI visibility, isSubscribed:", isSubscribed);
    if (upgradeSectionEl) upgradeSectionEl.style.display = isSubscribed ? 'none' : 'block';
    if (usageLimitSectionEl) usageLimitSectionEl.style.display = isSubscribed ? 'none' : 'block';
    updateUsageLimitDisplay();

    const snippetsTabButton = document.querySelector('.tab-button[data-tab="snippets"]');
    if (snippetsTabButton) {
        snippetsTabButton.style.display = isSubscribed ? 'flex' : 'none'; // Use flex to maintain layout
    }

    // Ensure correct tab content is shown
    tabContentsEls.forEach(content => {
        const isActiveTab = content.classList.contains('active');
        if (content.id === 'snippets') {
            content.style.display = (isSubscribed && isActiveTab) ? 'block' : 'none';
        } else {
            content.style.display = isActiveTab ? 'block' : 'none';
        }
    });

    // If snippets tab was active but user is not subscribed, switch to history
    if (snippetsTabButton && snippetsTabButton.classList.contains('active') && !isSubscribed) {
        const historyTabBtn = document.querySelector('.tab-button[data-tab="history"]');
        if (historyTabBtn) {
            historyTabBtn.click(); // This will re-trigger tab logic and updateUIVisibility
        }
    }
    if(snippetLimitMessageEl) snippetLimitMessageEl.style.display = (!isSubscribed && document.querySelector('.tab-button[data-tab="snippets"].active')) ? 'block' : 'none';
}

function updateUsageLimitDisplay() {
    if (!isSubscribed) {
        if(historyCountEl) historyCountEl.textContent = allHistoryItems.length;
        if(historyMaxEl) historyMaxEl.textContent = MAX_FREE_HISTORY;
        if(pinnedCountEl) pinnedCountEl.textContent = allPinnedItems.length;
        if(pinnedMaxEl) pinnedMaxEl.textContent = MAX_FREE_PINS;
    }
    // Specific list limit messages are removed, relying on the top usageLimitSection
    const historyListLimitMsg = document.getElementById('historyListLimitMessage');
    const pinnedListLimitMsg = document.getElementById('pinnedListLimitMessage');
    if(historyListLimitMsg) historyListLimitMsg.style.display = 'none';
    if(pinnedListLimitMsg) pinnedListLimitMsg.style.display = 'none';
}


// --- Tab Management ---
function setupTabs() {
    tabsButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            const clickedTab = event.currentTarget;

            // Prevent switching to snippets tab if not subscribed
            if (clickedTab.dataset.tab === 'snippets' && !isSubscribed) {
                console.log("Popup: Snippets tab clicked by non-subscribed user, action prevented.");
                return;
            }

            tabsButtons.forEach(btn => btn.classList.remove('active'));
            tabContentsEls.forEach(content => {
                content.classList.remove('active'); // Ensure class is removed
                content.style.display = 'none';   // Hide all content first
            });

            clickedTab.classList.add('active');
            const activeContentEl = document.getElementById(clickedTab.dataset.tab);
            if (activeContentEl) {
                activeContentEl.classList.add('active'); // Add class to content
                activeContentEl.style.display = 'block';   // Show the active one
            }
            updateUIVisibility(); // Update visibility of elements like snippetLimitMessage
            console.log("Popup: Switched to tab:", clickedTab.dataset.tab);
        });
    });

    // Activate the history tab by default
    const historyTabButton = document.querySelector('.tab-button[data-tab="history"]');
    if (historyTabButton) {
        historyTabButton.click(); // This will trigger the click listener and set up the initial view
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    if(searchInputEl) searchInputEl.addEventListener('input', () => {
        renderList(historyListEl, filterAndLimitItems(allHistoryItems, searchInputEl.value), 'history');
    });
    if(upgradeButtonEl) upgradeButtonEl.addEventListener('click', () => {
        chrome.tabs.create({ url: GUMROAD_LINK });
        window.close(); // Close popup after opening link
    });
    if(settingsButtonEl) settingsButtonEl.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    // Drag and Drop for History and Pinned Lists
    [historyListEl, pinnedListEl].forEach(listEl => {
        if (!listEl) return;
        listEl.addEventListener('dragstart', handleDragStart);
        listEl.addEventListener('dragover', handleDragOver);
        listEl.addEventListener('drop', handleDrop);
        listEl.addEventListener('dragend', handleDragEnd);
    });


    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Popup received message:", message.action);
        if (message.action === "updatePopup") {
            console.log("Popup: Received updatePopup, reloading data.");
            loadInitialData(); // This will re-render everything
        } else if (message.action === "subscriptionUpdated") {
            console.log("Popup: Received subscriptionUpdated, reloading status and UI.");
            loadSubscriptionStatus().then(() => {
                renderAllLists(); // This calls updateUIVisibility
            });
        } else if (message.action === "showError" && message.messageKey) {
            // For simplicity, using alert. Replace with a nicer notification if desired.
            alert(message.messageKey); // Using English key directly for now
        }
        // It's good practice to return true if you might send an asynchronous response.
        // In this listener, all responses are synchronous or handled by reloading data.
        return false; // Indicate synchronous processing or no response needed
    });
}

// --- Drag and Drop Handlers ---
function handleDragStart(e) {
    // Only allow LI elements to be draggable
    if (e.target.tagName === 'LI' && e.target.draggable) {
        draggedItemId = e.target.dataset.id;
        draggedItemElement = e.target; // Store the element being dragged
        // Add dragging class after a short delay to allow dataTransfer to be set
        setTimeout(() => {
            if (draggedItemElement) {
                 draggedItemElement.classList.add('dragging');
                 // document.body.style.cursor = 'grabbing'; // Optional: change body cursor
            }
        }, 0);
        e.dataTransfer.effectAllowed = 'move';
        try {
            e.dataTransfer.setData('text/plain', draggedItemId); // Necessary for Firefox
        } catch (error) {
            console.warn("Error setting drag data:", error); // Can happen in some edge cases
        }
        console.log("Drag Start:", draggedItemId);
    } else {
        e.preventDefault(); // Prevent dragging if not an LI or not draggable
    }
}

function handleDragOver(e) {
    e.preventDefault(); // This is necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';

    // Visual indicator for drop target
    const targetLi = e.target.closest('li[draggable="true"]');
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove()); // Clear previous indicators

    if (targetLi && targetLi !== draggedItemElement) { // Ensure not dropping on itself
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        const rect = targetLi.getBoundingClientRect();
        const isAfter = e.clientY > rect.top + rect.height / 2;
        if (isAfter) {
            targetLi.parentNode.insertBefore(indicator, targetLi.nextSibling);
        } else {
            targetLi.parentNode.insertBefore(indicator, targetLi);
        }
    }
}

async function handleDrop(e) {
    e.preventDefault();
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove()); // Clean up indicator
    const droppedOnLi = e.target.closest('li[draggable="true"]');
    const listElement = e.target.closest('ul'); // The UL element where the drop occurred
    const listType = listElement ? listElement.dataset.listType : null;

    if (!draggedItemId || !listType || !draggedItemElement) {
        console.log("Drop aborted: missing draggedItem, listType, or draggedElement");
        handleDragEnd(e); // Clean up drag state
        return;
    }

    let itemsArrayRef;
    if (listType === 'history') itemsArrayRef = allHistoryItems;
    else if (listType === 'pinned') itemsArrayRef = allPinnedItems;
    else {
        handleDragEnd(e);
        return;
    }

    const draggedItemIndex = itemsArrayRef.findIndex(item => item.id === draggedItemId);
    if (draggedItemIndex === -1) {
        handleDragEnd(e);
        return; // Dragged item not found in its source array
    }

    const itemToMove = itemsArrayRef.splice(draggedItemIndex, 1)[0]; // Remove item from old position

    let newIndex = itemsArrayRef.length; // Default to adding at the end
    if (droppedOnLi && droppedOnLi !== draggedItemElement) {
        const targetId = droppedOnLi.dataset.id;
        // Find the index in the *current state* of itemsArrayRef (after splice)
        const targetItemIndexInArray = itemsArrayRef.findIndex(item => item.id === targetId);

        if (targetItemIndexInArray !== -1) {
            const rect = droppedOnLi.getBoundingClientRect();
            const isAfter = e.clientY > rect.top + rect.height / 2;
            newIndex = isAfter ? targetItemIndexInArray + 1 : targetItemIndexInArray;
        }
    } else if (!droppedOnLi && listElement.children.length > 0 && listElement.children[0].classList.contains('placeholder')) {
        // If dropped on an empty list (only placeholder exists)
        newIndex = 0;
    }
    // If droppedOnLi is the draggedItemElement itself, or if dropped outside a valid li but within the ul,
    // newIndex remains itemsArrayRef.length (i.e., append to end).

    itemsArrayRef.splice(newIndex, 0, itemToMove); // Insert at new position

    console.log(`Dropped ${draggedItemId} in ${listType} at new index ${newIndex}`);

    // Update storage via background
    chrome.runtime.sendMessage({ action: "saveReorderedList", listType: listType, items: itemsArrayRef });
    // Optimistically re-render the list
    renderList(listElement, itemsArrayRef, listType);
    handleDragEnd(e); // Clean up drag state
}

function handleDragEnd(e) {
    if (draggedItemElement) {
        draggedItemElement.classList.remove('dragging');
    }
    document.querySelectorAll('.drop-indicator').forEach(ind => ind.remove());
    draggedItemId = null;
    draggedItemElement = null;
    // document.body.style.cursor = 'default'; // Reset body cursor if it was changed
}


// --- Helper Functions ---
async function readClipboardOnPopupOpen() {
    console.log("Popup: Attempting to read clipboard.");
    try {
        if (document.hasFocus()) { // Only read if popup is focused
            const text = await navigator.clipboard.readText();
            if (text && text.trim() !== '') {
                // Send to background to add to history
                // The response handling here is just for logging; actual UI update is via 'updatePopup'
                chrome.runtime.sendMessage({ action: "addToClipboard", text: text }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn("Popup: Error sending addToClipboard:", chrome.runtime.lastError.message);
                    } else if (response && response.success) {
                        console.log("Popup: Text sent to background successfully. Item added/moved:", response.itemAddedOrMoved);
                        // If an item was truly added or moved, background.js will send 'updatePopup'
                        // which will trigger loadInitialData() and re-render.
                    }
                });
            } else {
                console.log("Popup: Clipboard was empty or whitespace.");
            }
        } else {
            console.log("Popup: Document does not have focus, skipping clipboard read.");
        }
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            // This error is common if the popup isn't focused or permission is somehow lost.
            // console.warn("Popup: Clipboard read not allowed (document not focused or permission issue).");
        } else if (!err.message.includes('clipboard is empty')) { // Don't log error for empty clipboard
            console.warn('Popup: Could not read clipboard:', err.message);
        }
    }
}


function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            console.log("Text copied to clipboard!");
            // Simple visual feedback: change popup title temporarily
            const originalTitle = document.title;
            document.title = "Copied!";
            setTimeout(() => { document.title = originalTitle; }, 1200);
        })
        .catch(err => {
            console.error("Failed to copy text: ", err);
            alert("Failed to copy text."); // Inform user of failure
        });
}

async function pinItem(itemId) {
    if (!isSubscribed && allPinnedItems.length >= MAX_FREE_PINS) {
        alert("You have reached the maximum pin limit for the free version. Please upgrade.");
        return;
    }
    chrome.runtime.sendMessage({ action: "pinItem", itemId: itemId });
}

async function unpinItem(itemId) {
    chrome.runtime.sendMessage({ action: "unpinItem", itemId: itemId });
}

async function deleteItem(itemId, type) {
    chrome.runtime.sendMessage({ action: "deleteItem", itemId: itemId, itemType: type });
}
