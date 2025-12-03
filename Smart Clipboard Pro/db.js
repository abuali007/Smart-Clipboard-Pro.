(function () {
    const DB_NAME = 'SmartClipboardDB';
    const DB_VERSION = 1;
    const HISTORY_STORE = 'history';
    const PINNED_STORE = 'pinned';

    class ClipboardDB {
        constructor() {
            this.db = null;
            this.ready = null;
        }

        async init() {
            if (this.ready) return this.ready;
            this.ready = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, DB_VERSION);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                        const historyStore = db.createObjectStore(HISTORY_STORE, { keyPath: 'id' });
                        historyStore.createIndex('timestamp', 'timestamp');
                        historyStore.createIndex('text', 'text', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(PINNED_STORE)) {
                        db.createObjectStore(PINNED_STORE, { keyPath: 'id' });
                    }
                };
            });
            return this.ready;
        }

        async run(storeName, mode, operation) {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                let result;
                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
                result = operation(store);
            });
        }

        async addHistory(item) {
            return this.run(HISTORY_STORE, 'readwrite', (store) => store.put(item));
        }

        async getHistory(limit = 100, offset = 0) {
            await this.init();
            const items = [];
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(HISTORY_STORE, 'readonly');
                const store = tx.objectStore(HISTORY_STORE);
                const index = store.index('timestamp');
                let skipped = 0;
                const request = index.openCursor(null, 'prev');
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor && items.length < limit) {
                        if (skipped >= offset) {
                            items.push(cursor.value);
                        }
                        skipped += 1;
                        cursor.continue();
                    }
                };
                request.onerror = () => reject(request.error);
                tx.oncomplete = () => resolve(items);
                tx.onerror = () => reject(tx.error);
            });
        }

        async getHistoryItem(id) {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(HISTORY_STORE, 'readonly');
                const store = tx.objectStore(HISTORY_STORE);
                const request = store.get(id);
                request.onsuccess = (event) => resolve(event.target.result || null);
                request.onerror = () => reject(request.error);
            });
        }

        async updateHistoryItem(id, updatedItem) {
            await this.init();
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(HISTORY_STORE, 'readwrite');
                const store = tx.objectStore(HISTORY_STORE);
                store.put({ ...updatedItem, id });
                tx.oncomplete = () => resolve(updatedItem);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error);
            });
        }

        async getMaxTimesCopiedByText(normalizedText) {
            await this.init();
            const target = (normalizedText || '').trim().toLowerCase();
            if (!target) return 0;
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(HISTORY_STORE, 'readonly');
                const store = tx.objectStore(HISTORY_STORE);
                let max = 0;
                const request = store.openCursor();
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        const itemText = (cursor.value?.text || '').trim().toLowerCase();
                        if (itemText === target) {
                            const count = Number(cursor.value.timesCopied) || 0;
                            if (count > max) {
                                max = count;
                            }
                        }
                        cursor.continue();
                        return;
                    }
                };
                request.onerror = () => reject(request.error);
                tx.oncomplete = () => resolve(max);
                tx.onerror = () => reject(tx.error);
            });
        }
    }

    self.clipboardDB = new ClipboardDB();
})();
