// Options Page JavaScript for Smart Clipboard Pro
class OptionsManager {
    constructor() {
        this.settings = {
            theme: 'light',
            notifications: true,
            autoSync: false,
            autoBackup: false,
            keyboardShortcuts: true,
            autoCapture: true
        };
        this.snippets = [];
        
        this.init();
    }

    async init() {
        await this.loadSettings();
        await this.loadSnippets();
        this.setupEventListeners();
        this.updateUI();
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



    async loadSnippets() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'getSnippets'
            });
            if (response && response.snippets) {
                this.snippets = response.snippets;
            }
        } catch (error) {
            console.error('Error loading snippets:', error);
        }
    }

    setupEventListeners() {
        // Snippet management
        const addSnippetButton = document.getElementById('addSnippetButton');
        if (addSnippetButton) {
            addSnippetButton.addEventListener('click', () => {
                this.addSnippet();
            });
        }

        // Enter key in snippet inputs
        const snippetShortcut = document.getElementById('snippetShortcut');
        const snippetText = document.getElementById('snippetText');
        
        if (snippetShortcut) {
            snippetShortcut.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    snippetText.focus();
                }
            });
        }

        if (snippetText) {
            snippetText.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && e.ctrlKey) {
                    e.preventDefault();
                    this.addSnippet();
                }
            });
        }
    }

    updateUI() {
        this.updateSnippetsUI();
        
        // Show snippets section since all features are now free
        const snippetsSection = document.getElementById('snippetsSection');
        if (snippetsSection) {
            snippetsSection.style.display = 'block';
        }
        

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

    updateSnippetsUI() {
        const snippetList = document.getElementById('snippetListOptions');
        if (!snippetList) return;

        if (this.snippets.length === 0) {
            this.setSafeContent(snippetList, '<li class="placeholder">No snippets created yet. Add your first snippet above!</li>');
            return;
        }

        this.setSafeContent(snippetList, this.snippets.map((snippet, index) => `
            <li class="snippet-item" data-index="${index}">
                <div class="snippet-content">
                    <strong>${this.escapeHtml(snippet.shortcut)}</strong>
                    <span class="snippet-text">${this.escapeHtml(snippet.text.substring(0, 100))}${snippet.text.length > 100 ? '...' : ''}</span>
                </div>
                <button class="delete-snippet" data-index="${index}" title="Delete snippet">
                    🗑️
                </button>
            </li>
        `).join(''));
        
        // Add event listeners to delete buttons
        snippetList.querySelectorAll('.delete-snippet').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.dataset.index || e.target.closest('.snippet-item').dataset.index);
                this.deleteSnippet(index);
            });
        });
    }



    async addSnippet() {
        const shortcutInput = document.getElementById('snippetShortcut');
        const textInput = document.getElementById('snippetText');
        const errorDiv = document.getElementById('snippetError');
        
        if (!shortcutInput || !textInput) return;
        
        const shortcut = shortcutInput.value.trim();
        const text = textInput.value.trim();
        
        // Clear previous errors
        errorDiv.textContent = '';
        errorDiv.style.display = 'none';
        
        // Check snippet limits (now unlimited since it's free)
        try {
            const maxSnippets = 100; // Now unlimited for all users
            
            if (this.snippets.length >= maxSnippets) {
                this.showSnippetError(`You've reached the maximum limit of ${maxSnippets} snippets.`);
                return;
            }
        } catch (error) {

        }
        
        // Validation
        if (!shortcut || !text) {
            this.showSnippetError('Both shortcut and text are required');
            return;
        }
        
        if (shortcut.includes(' ')) {
            this.showSnippetError('Shortcut cannot contain spaces');
            return;
        }
        
        if (this.snippets.some(s => s.shortcut === shortcut)) {
            this.showSnippetError('A snippet with this shortcut already exists');
            return;
        }

        try {
            const newSnippet = { shortcut, text, id: Date.now().toString() };
            const updatedSnippets = [...this.snippets, newSnippet];
            
            const response = await chrome.runtime.sendMessage({
                action: 'saveSnippets',
                snippets: updatedSnippets
            });

            if (response && response.success) {
                this.snippets = updatedSnippets;
                this.updateSnippetsUI();
                
                // Clear inputs
                shortcutInput.value = '';
                textInput.value = '';
                
                this.showNotification('Snippet added successfully!', 'success');
            } else if (response && response.limitReached) {
                this.showSnippetError(response.error);

            } else {
                this.showSnippetError(response?.error || response?.message || 'Error adding snippet');
            }
        } catch (error) {
            console.error('Error adding snippet:', error);
            this.showSnippetError('Error adding snippet. Please try again.');
        }
    }

    async deleteSnippet(index) {
        if (index < 0 || index >= this.snippets.length) {
            console.error('Invalid snippet index:', index);
            return;
        }
        
        if (!confirm('Are you sure you want to delete this snippet?')) {
            return;
        }

        try {
            const snippet = this.snippets[index];
            if (!snippet) {
                this.showNotification('Snippet not found', 'error');
                return;
            }
            
            const response = await chrome.runtime.sendMessage({
                action: 'deleteSnippet',
                shortcut: snippet.shortcut
            });

            if (response && response.success) {
                this.snippets.splice(index, 1);
                this.updateSnippetsUI();
                this.showNotification('Snippet deleted successfully!', 'success');
            } else {
                this.showNotification('Error deleting snippet', 'error');
            }
        } catch (error) {
            console.error('Error deleting snippet:', error);
            this.showNotification('Error deleting snippet: ' + error.message, 'error');
        }
    }

    showSnippetError(message) {
        const errorEl = document.getElementById('snippetError');
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        // Set background color based on type
        switch (type) {
            case 'success':
                notification.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                notification.style.backgroundColor = '#f44336';
                break;
            default:
                notification.style.backgroundColor = '#2196F3';
        }
        
        // Add to page
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease';
                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 300);
            }
        }, 3000);
    }

    escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}

// Global reference for inline event handlers
let optionsManager;

// Initialize options manager when page loads
document.addEventListener('DOMContentLoaded', () => {
    optionsManager = new OptionsManager();
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .snippet-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-bottom: 8px;
        background: #f9f9f9;
    }
    
    .snippet-content {
        flex: 1;
    }
    
    .snippet-content strong {
        display: block;
        color: #333;
        margin-bottom: 4px;
    }
    
    .snippet-text {
        color: #666;
        font-size: 0.9em;
    }
    
    .delete-snippet {
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background-color 0.2s;
    }
    
    .delete-snippet:hover {
        background-color: #ffebee;
    }
    

    
    .status-active, .status-free {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .status-icon {
        font-size: 1.2em;
    }
    
    .status-details strong {
        display: block;
        margin-bottom: 4px;
    }
    
    .status-details p {
        margin: 2px 0;
        font-size: 0.9em;
        color: #666;
    }
`;
document.head.appendChild(style);
