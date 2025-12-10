import { showError } from './toast.js';

export function reportError(context, error, notifyUser = false, fallbackMessage = 'Something went wrong') {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    console.error(`[${context}]`, normalizedError);
    if (notifyUser) {
        showError(fallbackMessage);
    }
}
