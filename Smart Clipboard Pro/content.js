// ======================================================
// --- content.js (Final - English Only) ---
// ======================================================

let snippets = [];
let isSubscribed = false;
let inputListenerAttached = false;
let retryTimeout = null;

async function initializeSnippets() {
    console.log("Content.js: Initializing snippets (Final Version)...");
    if (retryTimeout) clearTimeout(retryTimeout);

    try {
        const statusResponse = await chrome.runtime.sendMessage({ action: "checkSubscription" });
        isSubscribed = statusResponse?.active ?? false;
        console.log("Content.js: Subscription status:", isSubscribed);

        if (isSubscribed) {
            const snippetResponse = await chrome.runtime.sendMessage({ action: "getSnippets" });
            snippets = snippetResponse?.snippets || [];
            console.log("Content.js: Snippets loaded:", snippets.length);
            if (snippets.length > 0 && !inputListenerAttached) {
                attachInputListener();
            } else if (snippets.length === 0 && inputListenerAttached) {
                removeInputListener();
            }
        } else {
            removeInputListener();
            snippets = [];
        }
    } catch (error) {
        handleInitializationError(error);
    }
}

function handleInitializationError(error) {
    if (error.message && error.message.includes("Extension context invalidated")) {
        console.warn("Content.js: Extension context invalidated. Listener will be removed.");
        removeInputListener();
    } else if (error.message && error.message.includes("Receiving end does not exist")) {
        console.warn("Content.js: Background script not available. Retrying initialization in 5s.");
        if (retryTimeout) clearTimeout(retryTimeout);
        retryTimeout = setTimeout(initializeSnippets, 5000 + Math.random() * 1000);
    } else {
        console.error("Content.js: Could not initialize snippets/subscription:", error.message, error.stack);
    }
}

function attachInputListener() {
    if (inputListenerAttached) return;
    document.addEventListener('input', handleInputEvent, true);
    inputListenerAttached = true;
    console.log("Content.js: Snippet input listener attached.");
}

function removeInputListener() {
    if (!inputListenerAttached) return;
    document.removeEventListener('input', handleInputEvent, true);
    inputListenerAttached = false;
    console.log("Content.js: Snippet input listener removed.");
}

function handleInputEvent(event) {
    if (!isSubscribed || snippets.length === 0) {
        if (inputListenerAttached) removeInputListener();
        return;
    }
    const target = event.target;
    if (event.isTrusted && target &&
        ((target.tagName === 'INPUT' && /^(text|search|email|url|password|number|tel)$/i.test(target.type)) ||
         target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        const currentValue = target.isContentEditable ? target.textContent : target.value;
        if (!currentValue) return;
        for (const snippet of snippets) {
            const trigger = snippet.shortcut;
            if (currentValue.length >= trigger.length && currentValue.endsWith(trigger)) {
                const indexBeforeTrigger = currentValue.length - trigger.length - 1;
                const charBefore = indexBeforeTrigger >= 0 ? currentValue[indexBeforeTrigger] : null;
                if (charBefore === null || /\s/.test(charBefore) || charBefore === '>' ) {
                    console.log(`Content.js: Snippet detected: ${trigger}`);
                    replaceSnippetText(target, trigger, snippet.text);
                    return;
                }
            }
        }
    }
}

function replaceSnippetText(target, shortcut, fullText) {
    let currentCursorPosition = null;
    let selectionEnd = null;

    try {
        if (!target.isContentEditable) {
            currentCursorPosition = target.selectionStart;
            selectionEnd = target.selectionEnd;
        }
    } catch (e) { /* ignore */ }

    if (target.isContentEditable) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        if (!range.collapsed) return;

        const container = range.startContainer;
        if (!target.contains(container) || container.nodeType !== Node.TEXT_NODE) return;

        const textContent = container.textContent || '';
        const rangeStartOffset = range.startOffset;

        if (rangeStartOffset >= shortcut.length && textContent.substring(rangeStartOffset - shortcut.length, rangeStartOffset) === shortcut) {
            const indexBeforeShortcut = rangeStartOffset - shortcut.length - 1;
            const charBefore = indexBeforeShortcut >= 0 ? textContent[indexBeforeShortcut] : null;

            if (charBefore === null || /\s/.test(charBefore) || charBefore === '>') {
                range.setStart(container, rangeStartOffset - shortcut.length);
                range.setEnd(container, rangeStartOffset);
                range.deleteContents();

                const textNode = document.createTextNode(fullText);
                range.insertNode(textNode);

                range.setStartAfter(textNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);

                target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
            }
        }
    } else {
        const currentValue = target.value;
        if (currentCursorPosition !== null && currentCursorPosition === selectionEnd &&
            currentCursorPosition >= shortcut.length &&
            currentValue.substring(currentCursorPosition - shortcut.length, currentCursorPosition) === shortcut) {

            const lastIndex = currentCursorPosition - shortcut.length;
            const charBefore = lastIndex > 0 ? currentValue[lastIndex - 1] : null;

            if (charBefore === null || /\s/.test(charBefore)) {
                const newValue = currentValue.substring(0, lastIndex) + fullText + currentValue.substring(currentCursorPosition);
                const scrollTop = target.scrollTop;
                const scrollLeft = target.scrollLeft;
                target.value = newValue;
                target.scrollTop = scrollTop;
                target.scrollLeft = scrollLeft;
                const newCursorPosition = lastIndex + fullText.length;
                try {
                    setTimeout(() => {
                        if (document.activeElement === target) {
                           target.setSelectionRange(newCursorPosition, newCursorPosition);
                        }
                    }, 0);
                } catch (e) { console.warn("Content.js: Could not set selection range:", e.message); }

                target.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
            }
        }
    }
}

initializeSnippets();
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "subscriptionUpdated" || message.action === "snippetsUpdated") {
        console.log("Content.js: Received update, re-initializing.", message.action);
        initializeSnippets();
    }
    sendResponse({received: true});
    return false;
});
