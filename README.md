````markdown name=PRIVACY_POLICY.md
# Privacy Policy — Smart Clipboard Pro

Overview  
This extension stores clipboard data locally in your browser only and uses chrome.storage.local to keep the local history of copied/selected items and user settings.

What is collected and stored
- Text copied or selected by the user if they choose to save it to the clipboard history.
- (Optional) The page URL or page title as contextual metadata when an item is saved to the history.

What is not sent to any server
- No page content or clipboard data is sent to external servers.
- No external tracking or analytics are enabled.

Why <all_urls> is required  
The extension requires the <all_urls> host permission so its content script can run on web pages where the user types or copies text. The permission is used only to:
1. Expand user-defined snippets while typing into input/textarea/contenteditable fields.
2. Detect selection/copy events to save items into the extension’s local clipboard history.

Guarantees
- The extension only reacts to explicit user actions (typing/copying/selecting).
- All data is stored locally in chrome.storage.local.
- No data is uploaded to external servers.

Support: open an issue on the repository: https://github.com/abuali007/Smart-Clipboard-Pro
```
