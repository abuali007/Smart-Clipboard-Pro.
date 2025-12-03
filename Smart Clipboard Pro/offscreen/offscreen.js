// Offscreen document script for clipboard access in Manifest V3

const textarea = document.getElementById('clipboard-textarea');

// Suppress Chrome WebUI color change errors (Mojo isn't available in extensions)
function suppressMojoErrors(event) {
    const message =
        event?.message ||
        event?.reason?.message ||
        (typeof event?.reason === 'string' ? event.reason : '');
    if (typeof message === 'string' && message.includes('Mojo is not defined')) {
        console.warn('Color change updater is unsupported in offscreen documents; ignoring Mojo error.');
        if (typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        return true;
    }
    return false;
}

window.addEventListener('error', (event) => {
    if (suppressMojoErrors(event)) {
        event.stopImmediatePropagation?.();
    }
});

window.addEventListener('unhandledrejection', (event) => {
    if (suppressMojoErrors(event)) {
        event.stopImmediatePropagation?.();
    }
});

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Offscreen received message:', message);
    
    if (message.action === 'offscreenPing') {
        sendResponse({ ready: true });
        return true;
    }
    
    if (message.action === 'getClipboardContent') {
        getClipboardContent()
            .then(text => {
                console.log('Offscreen clipboard content:', text?.substring(0, 50));
                sendResponse({ success: true, text: text });
            })
            .catch(error => {
                console.error('Offscreen: Error getting clipboard content:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Keep the message channel open for async response
    }
    
    return false;
});

// Function to get clipboard content using the modern clipboard API
async function getClipboardContent() {
    const modernResult = await tryModernClipboardApi();
    if (typeof modernResult === 'string') {
        return modernResult;
    }
    return await getClipboardContentFallback();
}

async function tryModernClipboardApi() {
    // Offscreen documents never receive user focus, so navigator.clipboard will
    // immediately throw in most builds. Skip when focus/permission preconditions fail.
    if (!document.hasFocus?.() || !navigator.clipboard?.readText || self.isSecureContext === false) {
        return null;
    }

    try {
        const permissionState = await queryClipboardPermission();
        if (permissionState === 'denied') {
            console.warn('Clipboard permission denied, skipping navigator.clipboard.');
            return null;
        }
        const text = await navigator.clipboard.readText();
        console.log('Clipboard API success, text length:', text?.length);
        return text;
    } catch (error) {
        const name = error?.name || 'ClipboardError';
        const message = error?.message || String(error);
        console.warn(`Clipboard API failed (${name}: ${message}). Falling back to execCommand.`);
        return null;
    }
}

async function queryClipboardPermission() {
    if (!navigator.permissions?.query) {
        return 'prompt';
    }
    try {
        const result = await navigator.permissions.query({ name: 'clipboard-read' });
        return result.state;
    } catch (error) {
        console.warn('Unable to query clipboard permission, assuming prompt state.', error);
        return 'prompt';
    }
}

// Fallback method using execCommand
async function getClipboardContentFallback() {
    try {
        // Focus the textarea
        textarea.focus();
        textarea.select();
        
        // Clear any existing content
        textarea.value = '';
        
        // Execute paste command
        const success = document.execCommand('paste');
        
        if (success) {
            const clipboardText = textarea.value;
            // Clear the textarea for security
            textarea.value = '';
            console.log('ExecCommand success, text length:', clipboardText?.length);
            return clipboardText;
        } else {
            throw new Error('Paste command failed');
        }
    } catch (error) {
        throw new Error(`ExecCommand failed: ${error.message}`);
    }
}

console.log('Offscreen document loaded for Smart Clipboard Pro');
