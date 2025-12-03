// Gumroad Integration for Smart Clipboard Pro
// This file handles Gumroad subscription verification

const GUMROAD_API_URL = 'https://api.gumroad.com/v2';
const GUMROAD_PRODUCT_ID = 'imwysv'; // Your product ID from the URL

function getCrypto() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
    try {
        // eslint-disable-next-line global-require
        return require('crypto');
    } catch (error) {
        return null;
    }
}

function secureRandomInt(maxExclusive) {
    const cryptoObj = getCrypto();
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new Error('Invalid maxExclusive for secure random generation');
    }
    if (typeof cryptoObj?.randomInt === 'function') {
        return cryptoObj.randomInt(0, maxExclusive);
    }
    if (typeof cryptoObj?.getRandomValues === 'function') {
        const limit = 0x100000000 - (0x100000000 % maxExclusive);
        let value;
        do {
            value = cryptoObj.getRandomValues(new Uint32Array(1))[0];
        } while (value >= limit);
        return value % maxExclusive;
    }
    if (typeof cryptoObj?.randomBytes === 'function') {
        const limit = 0x100000000 - (0x100000000 % maxExclusive);
        let value;
        do {
            const bytes = cryptoObj.randomBytes(4);
            value = bytes.readUInt32BE(0);
        } while (value >= limit);
        return value % maxExclusive;
    }
    throw new Error('Secure random generator not available');
}

/**
 * Verify Gumroad license key
 * @param {string} licenseKey - The license key from Gumroad
 * @returns {Promise<Object>} Verification result
 */
async function verifyGumroadLicense(licenseKey) {
    try {
        // Note: Gumroad doesn't have a direct public API for license verification
        // You'll need to use one of these approaches:
        
        // Option 1: Use Gumroad's webhook system
        // Set up a webhook in Gumroad that sends license info to your server
        // Then verify from your server
        
        // Option 2: Use Gumroad's purchase verification
        // This requires the customer's email and purchase ID
        
        // Option 3: Simple validation (for now)
        // This is a basic implementation - you should enhance this with server-side verification
        
        if (!licenseKey || licenseKey.trim().length < 10) {
            return { 
                valid: false, 
                error: 'Invalid license key format' 
            };
        }
        
        // Format validation: XXXX-XXXX-XXXX-XXXX
        const licensePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
        if (!licensePattern.test(licenseKey)) {
            return { 
                valid: false, 
                error: 'Invalid license key format. Expected: XXXX-XXXX-XXXX-XXXX' 
            };
        }
        
        // For production, you should verify with your backend server
        // Example:
        /*
        const response = await fetch('https://your-backend.com/verify-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                licenseKey,
                productId: GUMROAD_PRODUCT_ID 
            })
        });
        
        const result = await response.json();
        return result;
        */
        
        // Temporary: Accept any valid format (for testing)
        // In production, replace this with actual Gumroad verification
        return {
            valid: true,
            licenseInfo: {
                key: licenseKey,
                activated: true,
                activatedAt: Date.now(),
                expiresAt: null, // Monthly subscription - check monthly
                subscriptionType: 'monthly',
                features: ['unlimited_history', 'snippets', 'auto_backup', 'analytics'],
                source: 'gumroad'
            }
        };
        
    } catch (error) {
        console.error('Gumroad license verification error:', error);
        return { 
            valid: false, 
            error: error.message || 'Verification failed' 
        };
    }
}

/**
 * Check if subscription is still active
 * For monthly subscriptions, check if it's been renewed
 */
async function checkSubscriptionStatus(licenseInfo) {
    if (!licenseInfo || !licenseInfo.activated) {
        return { active: false, reason: 'Not activated' };
    }
    
    // For monthly subscriptions, check if it's been more than 30 days
    if (licenseInfo.subscriptionType === 'monthly') {
        const daysSinceActivation = (Date.now() - licenseInfo.activatedAt) / (1000 * 60 * 60 * 24);
        
        if (daysSinceActivation > 30) {
            // Subscription might have expired - verify with server
            // For now, we'll allow it but log a warning
            console.warn('Subscription may have expired. Please verify with server.');
        }
    }
    
    return { active: true };
}

/**
 * Generate a license key from Gumroad purchase
 * This should be called from your backend when Gumroad sends a webhook
 */
function generateLicenseKey(purchaseData) {
    // Generate a unique license key based on purchase data
    // Format: XXXX-XXXX-XXXX-XXXX
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    
    for (let i = 0; i < 16; i++) {
        if (i > 0 && i % 4 === 0) {
            key += '-';
        }
        key += chars.charAt(secureRandomInt(chars.length));
    }

    return key;
}

// Export for use in background.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        verifyGumroadLicense,
        checkSubscriptionStatus,
        generateLicenseKey
    };
}
