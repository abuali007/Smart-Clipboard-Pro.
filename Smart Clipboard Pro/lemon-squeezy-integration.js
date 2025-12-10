// Lemon Squeezy Integration for Smart Clipboard Pro
// Lightweight helpers for server-side license validation/activation.
// Do not bundle your API key inside the extension; keep it on the server.

const LEMONSQUEEZY_API_BASE = 'https://api.lemonsqueezy.com/v1';
const fetchFn = typeof fetch === 'function'
    ? fetch
    : (...args) => import('node-fetch').then(({ default: f }) => f(...args));

async function callLemonSqueezy(path, payload = {}, apiKey) {
    if (!apiKey) {
        throw new Error('Lemon Squeezy API key is required');
    }
    const response = await fetchFn(`${LEMONSQUEEZY_API_BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch (error) {
        json = null;
    }
    if (!response.ok) {
        const message = json?.message || json?.error || text || `HTTP ${response.status}`;
        const err = new Error(message);
        err.status = response.status;
        err.payload = json;
        throw err;
    }
    return json || {};
}

async function validateLicense(licenseKey, options = {}) {
    const { apiKey, instanceId = null } = options;
    const payload = { license_key: licenseKey };
    if (instanceId) {
        payload.instance_id = instanceId;
    }
    return callLemonSqueezy('/licenses/validate', payload, apiKey);
}

async function activateLicense(licenseKey, options = {}) {
    const { apiKey, instanceId = null, instanceName = 'Smart Clipboard Pro' } = options;
    const payload = { license_key: licenseKey, instance_name: instanceName };
    if (instanceId) {
        payload.instance_id = instanceId;
    }
    return callLemonSqueezy('/licenses/activate', payload, apiKey);
}

module.exports = {
    validateLicense,
    activateLicense
};
