// ======================================================
// --- options.js (Final - English Only) ---
// ======================================================

// DOM Elements
const subscriptionStatusDivEl = document.getElementById('subscriptionStatus');
const licenseSectionEl = document.getElementById('licenseSection');
const upgradeOptionsButtonEl = document.getElementById('upgradeOptionsButton');
const licenseKeyInputEl = document.getElementById('licenseKeyInput');
const activateLicenseButtonEl = document.getElementById('activateLicenseButton');
const licenseMessageEl = document.getElementById('licenseMessage');
const manageSubscriptionSectionEl = document.getElementById('manageSubscriptionSection');
const checkSubscriptionButtonEl = document.getElementById('checkSubscriptionButton');
const subscriptionErrorDivEl = document.getElementById('subscriptionError');

// Snippets Section Elements
const snippetsSectionEl = document.getElementById('snippetsSection');
const snippetShortcutInputEl = document.getElementById('snippetShortcut');
const snippetTextInputEl = document.getElementById('snippetText');
const addSnippetButtonEl = document.getElementById('addSnippetButton');
const snippetListOptionsEl = document.getElementById('snippetListOptions');
const snippetErrorDivEl = document.getElementById('snippetError');

// Constants
const GUMROAD_LINK = 'https://azdynamo7.gumroad.com/l/imwysv';

// State
let currentSnippets = [];
let isSubscribed = false;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("Options DOMContentLoaded - Final Version");
    await loadSubscriptionStatusOptions();
    setupOptionsEventListeners();
    updateOptionsUIVisibility();
});

// --- Subscription Status ---
async function loadSubscriptionStatusOptions() {
    subscriptionStatusDivEl.textContent = "Loading status...";
    subscriptionStatusDivEl.className = 'subscription-status loading';
    subscriptionErrorDivEl.textContent = '';
    licenseMessageEl.textContent = '';
    checkSubscriptionButtonEl.disabled = true;

    try {
        const status = await chrome.runtime.sendMessage({ action: "checkSubscription" });
        if (status === undefined) {
            throw new Error("No response from background for subscription check.");
        }

        isSubscribed = !!(status.active && status.licenseKey);
        console.log("Options page - Subscription status from background:", status);
        updateOptionsUIVisibility();

        if (isSubscribed) {
            const expiryText = status.endDate ? ` (Expires on: ${new Date(status.endDate).toLocaleDateString()})` : '';
            subscriptionStatusDivEl.textContent = `Premium License Active! (${status.licenseKey.substring(0, 4)}...${status.licenseKey.substring(status.licenseKey.length - 4)})${expiryText}`;
            subscriptionStatusDivEl.className = 'subscription-status subscribed';
            await loadSnippetsOptions();
        } else {
            subscriptionStatusDivEl.textContent = "You are using the free version.";
            subscriptionStatusDivEl.className = 'subscription-status not-subscribed';
        }
    } catch (error) {
        console.error("Error loading subscription status:", error);
        subscriptionStatusDivEl.textContent = "Error loading license status.";
        subscriptionStatusDivEl.className = 'subscription-status not-subscribed';
        subscriptionErrorDivEl.textContent = error.message;
        updateOptionsUIVisibility();
    } finally {
        checkSubscriptionButtonEl.disabled = false;
    }
}

function updateOptionsUIVisibility() {
    console.log("Options: Updating UI visibility, isSubscribed:", isSubscribed);
    licenseSectionEl.style.display = isSubscribed ? 'none' : 'block';
    manageSubscriptionSectionEl.style.display = isSubscribed ? 'block' : 'none';
    snippetsSectionEl.style.display = isSubscribed ? 'block' : 'none';
    if (!isSubscribed) {
        snippetListOptionsEl.innerHTML = `<li class="placeholder">Snippets are a Premium Feature.</li>`;
    }
}

// --- Snippets ---
async function loadSnippetsOptions() {
    if (!isSubscribed) {
        return;
    }
    snippetListOptionsEl.innerHTML = `<li class="placeholder loading">Loading snippets...</li>`;

    try {
        const data = await chrome.runtime.sendMessage({ action: "getSnippets" });
        if (data === undefined) {
            throw new Error("No response from background for getSnippets.");
        }
        currentSnippets = data.snippets || [];
        renderSnippetListOptions();
    } catch (error) {
        console.error("Error loading snippets:", error);
        snippetListOptionsEl.innerHTML = `<li class="placeholder">Error loading snippets: ${error.message}</li>`;
    }
}

function renderSnippetListOptions() {
    snippetListOptionsEl.innerHTML = '';
    if (currentSnippets.length === 0) {
        snippetListOptionsEl.innerHTML = `<li class="placeholder">No snippets added. Add your first snippet above!</li>`;
        return;
    }
    currentSnippets.forEach(snippet => {
        const li = document.createElement('li');
        li.className = 'snippet-item';
        li.dataset.id = snippet.id;

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'snippet-details';
        const shortcutSpan = document.createElement('span');
        shortcutSpan.className = 'snippet-shortcut';
        shortcutSpan.textContent = snippet.shortcut;
        detailsDiv.appendChild(shortcutSpan);
        const textSpan = document.createElement('span');
        textSpan.className = 'snippet-text';
        textSpan.textContent = snippet.text;
        detailsDiv.appendChild(textSpan);
        li.appendChild(detailsDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'snippet-actions';
        const deleteButton = document.createElement('button');
        deleteButton.textContent = "Delete";
        deleteButton.className = 'delete';
        deleteButton.addEventListener('click', () => deleteSnippet(snippet.id));
        actionsDiv.appendChild(deleteButton);
        li.appendChild(actionsDiv);
        snippetListOptionsEl.appendChild(li);
    });
}

// --- Event Listeners ---
function setupOptionsEventListeners() {
    addSnippetButtonEl.addEventListener('click', addSnippet);
    upgradeOptionsButtonEl.addEventListener('click', () => {
        chrome.tabs.create({ url: GUMROAD_LINK });
    });
    activateLicenseButtonEl.addEventListener('click', handleLicenseActivation);
    checkSubscriptionButtonEl.addEventListener('click', () => {
        loadSubscriptionStatusOptions();
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log("Options received message:", message.action);
        if (message.action === "subscriptionUpdated") {
            loadSubscriptionStatusOptions();
        } else if (message.action === "snippetsUpdated") {
            if (isSubscribed) loadSnippetsOptions();
        }
        return false;
    });
}

// --- Snippet Management ---
async function addSnippet() {
    snippetErrorDivEl.textContent = '';
    addSnippetButtonEl.disabled = true;
    const shortcut = snippetShortcutInputEl.value.trim();
    const text = snippetTextInputEl.value.trim();

    if (!shortcut || !text) {
        snippetErrorDivEl.textContent = "Please enter both shortcut and full text.";
        addSnippetButtonEl.disabled = false; return;
    }
    if (/\s/.test(shortcut)) {
        snippetErrorDivEl.textContent = "Shortcut must not contain spaces.";
        addSnippetButtonEl.disabled = false; return;
    }
    if (currentSnippets.some(s => s.shortcut === shortcut)) {
        snippetErrorDivEl.textContent = "This shortcut is already in use.";
        addSnippetButtonEl.disabled = false; return;
    }

    const newSnippet = { id: Date.now().toString() + Math.random().toString(16).slice(2), shortcut: shortcut, text: text };
    const oldSnippets = [...currentSnippets];
    currentSnippets.push(newSnippet);
    renderSnippetListOptions();

    try {
        const response = await chrome.runtime.sendMessage({ action: "saveSnippets", snippets: currentSnippets });
        if (response === undefined || !response.success) {
            throw new Error(response?.error || "Failed to save snippet in background.");
        }
        snippetShortcutInputEl.value = '';
        snippetTextInputEl.value = '';
    } catch (error) {
        snippetErrorDivEl.textContent = `Error saving snippet: ${error.message}`;
        currentSnippets = oldSnippets;
        renderSnippetListOptions();
    } finally {
        addSnippetButtonEl.disabled = false;
    }
}

async function deleteSnippet(snippetId) {
    const deleteButton = snippetListOptionsEl.querySelector(`li[data-id="${snippetId}"] .delete`);
    if (deleteButton) deleteButton.disabled = true;

    const oldSnippets = [...currentSnippets];
    currentSnippets = currentSnippets.filter(s => s.id !== snippetId);
    renderSnippetListOptions();

    try {
        const response = await chrome.runtime.sendMessage({ action: "saveSnippets", snippets: currentSnippets });
        if (response === undefined || !response.success) {
            throw new Error(response?.error || "Failed to delete snippet in background.");
        }
    } catch (error) {
        snippetErrorDivEl.textContent = `Error deleting snippet: ${error.message}`;
        currentSnippets = oldSnippets;
        renderSnippetListOptions();
    }
}

// --- License Activation ---
async function handleLicenseActivation() {
    const licenseKey = licenseKeyInputEl.value.trim();
    if (!licenseKey) {
        licenseMessageEl.textContent = "Please enter your license key.";
        licenseMessageEl.className = 'error'; return;
    }

    licenseMessageEl.textContent = "Verifying license key...";
    licenseMessageEl.className = 'loading';
    activateLicenseButtonEl.disabled = true;
    licenseKeyInputEl.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({ action: "verifyLicenseKey", licenseKey: licenseKey });
        if (response === undefined) {
            throw new Error("No response from background for license verification.");
        }

        if (response.success && response.active) {
            licenseMessageEl.textContent = "License activated successfully! Premium features are now available.";
            licenseMessageEl.className = 'success';
            await loadSubscriptionStatusOptions();
        } else {
            licenseMessageEl.textContent = `Activation failed: ${response.error || 'The license key is invalid or has expired.'}`;
            licenseMessageEl.className = 'error';
        }
    } catch (error) {
        licenseMessageEl.textContent = `An error occurred: ${error.message}`;
        licenseMessageEl.className = 'error';
    } finally {
        activateLicenseButtonEl.disabled = false;
        licenseKeyInputEl.disabled = false;
    }
}
