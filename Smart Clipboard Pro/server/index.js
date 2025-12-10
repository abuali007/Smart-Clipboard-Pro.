import express from 'express';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';

const app = express();
app.use(express.json());

const LEMONSQUEEZY_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LEMONSQUEEZY_API_BASE = 'https://api.lemonsqueezy.com/v1';
const LEMONSQUEEZY_VARIANT_ID = process.env.LEMONSQUEEZY_VARIANT_ID || '1092455';
const TRIAL_VARIANT_IDS = (process.env.LEMONSQUEEZY_TRIAL_VARIANT_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
const TRIAL_VARIANT_SET = new Set(TRIAL_VARIANT_IDS);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
const EXTENSION_ID = process.env.EXTENSION_ID || 'mpckpnadcdgigelebgicgnpkcfdmlfpf';
const LICENSE_PATTERN = /^([A-Z0-9]{4}-){3}[A-Z0-9]{4}$|^[A-Z0-9]{8}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{12}$/i;
const LEMONSQUEEZY_PATHS = Object.freeze({
    activate: '/licenses/activate',
    validate: '/licenses/validate'
});
const ALLOWED_LEMONSQUEEZY_PATHS = new Set(Object.values(LEMONSQUEEZY_PATHS));
const normalizeOrigin = (value) => {
    if (!value) return null;
    try {
        return new URL(value).origin;
    } catch (error) {
        return null;
    }
};
const ALLOWED_ORIGIN_SET = new Set(ALLOWED_ORIGINS.map(normalizeOrigin).filter(Boolean));
const ALLOWED_ORIGIN_LIST = Array.from(ALLOWED_ORIGIN_SET);
const DEFAULT_FEATURES = ['unlimited_history', 'snippets', 'auto_backup', 'analytics'];
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_DAYS = 30;

const limiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 100,
    message: { valid: false, error: 'Too many requests' }
});

function allowCors(req, res) {
    const normalizedOrigin = normalizeOrigin(req.headers.origin);
    const allowedOrigin = ALLOWED_ORIGIN_LIST.find((origin) => origin === normalizedOrigin);
    if (allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
        res.setHeader('Vary', 'Origin');
        return;
    }
    if (ALLOWED_ORIGIN_SET.size === 0) {
        // Development fallback only when no allowlist is configured.
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
}

app.options('/api/verify-license', (req, res) => {
    allowCors(req, res);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.sendStatus(204);
});

function normalizeLicenseKey(value = '') {
    const raw = String(value || '').trim().toUpperCase();
    const cleaned = raw.replace(/[^A-Z0-9]/g, '');
    if (cleaned.length === 16) {
        const groups = cleaned.match(/.{1,4}/g);
        const normalized = groups ? groups.join('-') : null;
        return normalized && LICENSE_PATTERN.test(normalized) ? normalized : null;
    }
    if (cleaned.length === 32) {
        // Lemon Squeezy UUID-style keys
        const match = cleaned.match(/^([A-Z0-9]{8})([A-Z0-9]{4})([A-Z0-9]{4})([A-Z0-9]{4})([A-Z0-9]{12})$/);
        if (!match) return null;
        const normalized = `${match[1]}-${match[2]}-${match[3]}-${match[4]}-${match[5]}`;
        return LICENSE_PATTERN.test(normalized) ? normalized : null;
    }
    // Already formatted with hyphens? Accept if pattern matches.
    if (LICENSE_PATTERN.test(raw)) {
        return raw.toUpperCase();
    }
    return null;
}

function escapeHtml(value = '') {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeTimestamp(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
}

async function callLemonSqueezy(operation, payload = {}) {
    if (!LEMONSQUEEZY_API_KEY) {
        throw new Error('LEMONSQUEEZY_API_KEY is not configured on the server');
    }
    const apiPath = LEMONSQUEEZY_PATHS[operation];
    if (!apiPath || !ALLOWED_LEMONSQUEEZY_PATHS.has(apiPath)) {
        throw new Error('Unsupported Lemon Squeezy API path');
    }
    const apiUrl = new URL(apiPath, LEMONSQUEEZY_API_BASE).toString();
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${LEMONSQUEEZY_API_KEY}`
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

function mapLemonSqueezyResponseToLicense(data, context = {}) {
    const meta = data?.meta || {};
    const payload = data?.data || {};
    const attributes = payload.attributes || {};
    const licenseKeyData = attributes.license_key || attributes.licenseKey || {};
    const relationships = payload.relationships || {};
    // Prefer the variant relationship first; fallback to product if variant is missing.
    const variantRelation = relationships.variant?.data || relationships.product?.data;
    const productRelation = relationships.product?.data || relationships.variant?.data;
    const trialEndsAt = normalizeTimestamp(
        meta.trial_ends_at ||
        meta.trialEndsAt ||
        attributes.trial_ends_at ||
        attributes.subscription_trial_ends_at ||
        attributes.trialEndsAt ||
        licenseKeyData.trial_ends_at ||
        licenseKeyData.trialEndsAt
    );
    const activationLimit = Number(
        attributes.activation_limit ||
        licenseKeyData.activation_limit ||
        attributes.max_activations ||
        licenseKeyData.max_activations ||
        attributes.max_uses ||
        0
    );
    const usageCount = Number(
        attributes.activations_count ||
        licenseKeyData.activations_count ||
        attributes.uses ||
        attributes.uses_count ||
        licenseKeyData.uses_count ||
        0
    );
    const status = attributes.status || meta.status || (meta.valid === false ? 'inactive' : 'active');
    const subscriptionType = meta.subscription_interval || attributes.subscription_interval || null;
    const variantId =
        attributes.variant_id ||
        licenseKeyData.variant_id ||
        variantRelation?.id ||
        meta.variant_id ||
        meta.variantId ||
        attributes.product_id ||
        licenseKeyData.product_id;
    const nextChargeAt = normalizeTimestamp(
        meta.renews_at || attributes.subscription_renews_at || attributes.renews_at
    );
    let expiresAt = normalizeTimestamp(
        trialEndsAt ||
        meta.expires_at ||
        meta.subscription_ends_at ||
        attributes.expires_at ||
        attributes.subscription_ends_at ||
        nextChargeAt
    );
    // Fallback: if no explicit expiry and this is a pass (not a subscription), derive from variant type.
    if (!expiresAt && !subscriptionType) {
        const isTrialVariant = TRIAL_VARIANT_SET.has(String(variantId || ''));
        const durationDays = isTrialVariant ? 7 : DEFAULT_DURATION_DAYS;
        expiresAt = Date.now() + (durationDays * DAY_IN_MS);
    }
    return {
        key: context.licenseKey || attributes.key || licenseKeyData.key || null,
        activationId: payload.id || meta.activation_id || attributes.activation_id || licenseKeyData.activation_id || context.activationId || null,
        activated: meta.activated !== false,
        status,
        source: 'lemon-squeezy',
        productId: attributes.product_id || licenseKeyData.product_id || productRelation?.id || LEMONSQUEEZY_VARIANT_ID,
        productName: attributes.product_name || licenseKeyData.product_name || 'Smart Clipboard Pro',
        purchaser: {
            email: attributes.customer_email || meta.customer_email || licenseKeyData.customer_email || '',
            name: attributes.customer_name || meta.customer_name || licenseKeyData.customer_name || ''
        },
        activatedAt: normalizeTimestamp(attributes.created_at || meta.activated_at || meta.created_at) || Date.now(),
        lastVerifiedAt: Date.now(),
        nextChargeAt,
        expiresAt,
        subscriptionType: subscriptionType || (meta.renews_at ? 'subscription' : null),
        planLabel: subscriptionType ? (subscriptionType.includes('year') ? 'Yearly Subscription' : subscriptionType.includes('month') ? 'Monthly Subscription' : 'Subscription') : `${DEFAULT_DURATION_DAYS}-Day Pro Pass`,
        usageCount: Number.isFinite(usageCount) && usageCount >= 0 ? usageCount : 0,
        maxActivations: Number.isFinite(activationLimit) && activationLimit > 0 ? activationLimit : 1,
        subscriptionCancelled: Boolean(
            meta.subscription_cancelled ||
            meta.cancelled ||
            attributes.cancelled ||
            attributes.disabled ||
            status === 'cancelled' ||
            status === 'canceled' ||
            status === 'expired'
        ),
        subscriptionFailedAt: normalizeTimestamp(meta.subscription_failed_at || attributes.subscription_failed_at),
        subscriptionId: attributes.subscription_id || null,
        saleId: attributes.order_id || attributes.sale_id || null,
        features: DEFAULT_FEATURES
    };
}

function getOfflineLicenseSecret() {
    const secret = process.env.OFFLINE_LICENSE_SECRET || process.env.LICENSE_SECRET;
    if (!secret) {
        throw new Error('Offline license secret not configured');
    }
    return secret;
}

app.post('/api/verify-license', limiter, async (req, res) => {
    allowCors(req, res);

    const { licenseKey, increment = false, incrementUseCount = false, deviceId = null, activationId = null } = req.body || {};
    const shouldIncrement = Boolean(increment || incrementUseCount);
    const normalized = normalizeLicenseKey(licenseKey);

    if (!normalized) {
        return res.status(400).json({ valid: false, error: 'Invalid license format. Paste the full license key from your receipt.' });
    }

    if (!LEMONSQUEEZY_API_KEY && process.env.OFFLINE_MODE === 'true') {
        try {
            const isValid = validateOfflineLicense(normalized);
            if (isValid) {
                return res.json({
                    valid: true,
                    licenseInfo: {
                        key: normalized,
                        activated: true,
                        productId: 'offline-license',
                        productName: 'Smart Clipboard Pro',
                        purchaser: { email: 'offline@user.com', name: 'Offline User' },
                        activatedAt: Date.now(),
                        subscriptionId: null,
                        expiresAt: Date.now() + (DEFAULT_DURATION_DAYS * DAY_IN_MS),
                        features: DEFAULT_FEATURES,
                        usageCount: 0,
                        maxActivations: 999,
                        status: 'active',
                        lastVerifiedAt: Date.now()
                    }
                });
            }
            return res.json({ valid: false, error: 'Invalid offline license' });
        } catch (error) {
            console.error('Offline license validation error:', error);
            return res.status(500).json({ valid: false, error: 'Offline licensing not configured' });
        }
    }

    if (!LEMONSQUEEZY_API_KEY) {
        return res.status(500).json({ valid: false, error: 'Lemon Squeezy API key is not configured on the server' });
    }

    try {
        const payload = { license_key: normalized };
        if (deviceId) {
            payload.fingerprint = deviceId;
            if (shouldIncrement) {
                payload.instance_id = activationId || deviceId;
            }
        }
        if (shouldIncrement) {
            payload.instance_name = 'Smart Clipboard Pro';
        }

        const data = await callLemonSqueezy(shouldIncrement ? 'activate' : 'validate', payload);

        if (data?.meta?.valid === false) {
            return res.json({
                valid: false,
                error: data?.meta?.error || 'License not recognized for this product',
                meta: data.meta
            });
        }

        const licenseInfo = mapLemonSqueezyResponseToLicense(data, { licenseKey: normalized, deviceId, activationId });

        // Hard-stop expired or cancelled licenses so the client can't keep running past end of trial/subscription.
        const now = Date.now();
        const isExpired = licenseInfo.expiresAt && Number(licenseInfo.expiresAt) < now;
        const isCancelled = Boolean(
            licenseInfo.subscriptionCancelled ||
            licenseInfo.status === 'cancelled' ||
            licenseInfo.status === 'canceled' ||
            licenseInfo.status === 'expired'
        );
        if (isExpired || isCancelled) {
            return res.json({
                valid: false,
                error: isCancelled ? 'Subscription is cancelled/expired' : 'License expired',
                licenseInfo
            });
        }

        console.log(`License verified: ${normalized.slice(0, 4)}**** for ${licenseInfo.purchaser.email || 'unknown user'}`);
        return res.json({ valid: true, licenseInfo });
    } catch (error) {
        console.error('Verification error:', error);
        const message = error?.message || 'Unable to verify license. Please try again later.';
        const statusCode = error?.status && error.status >= 400 && error.status < 500 ? error.status : 500;
        return res.status(statusCode).json({
            valid: false,
            error: message
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        lemonSqueezyConfigured: Boolean(LEMONSQUEEZY_API_KEY),
        offlineMode: process.env.OFFLINE_MODE === 'true'
    });
});

app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Smart Clipboard Pro license server is running',
        endpoints: {
            verify: '/api/verify-license',
            health: '/health'
        },
        lemonSqueezyConfigured: Boolean(LEMONSQUEEZY_API_KEY)
    });
});

app.get('/activate', (req, res) => {
    const licenseParam = String(req.query.license || '').trim();
    const normalizedLicense = licenseParam ? normalizeLicenseKey(licenseParam) : null;
    const license = normalizedLicense || '';
    const safeLicenseText = normalizedLicense
        ? escapeHtml(normalizedLicense)
        : licenseParam
            ? 'Invalid license format'
            : 'No license key provided';
    const extUrlBase = `chrome-extension://${EXTENSION_ID}/settings/settings.html`;
    const extUrl = normalizedLicense ? `${extUrlBase}?license=${encodeURIComponent(normalizedLicense)}` : extUrlBase;
    const safeExtUrl = escapeHtml(extUrl);
    const webStoreUrl = 'https://chrome.google.com/webstore/detail/mpckpnadcdgigelebgicgnpkcfdmlfpf';
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Activate Smart Clipboard Pro</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; max-width: 720px; }
    code { background: #f4f4f4; padding: 6px 10px; display: inline-block; border-radius: 6px; }
    a.button { display: inline-block; margin: 10px 0; padding: 12px 16px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 8px; }
    .muted { color: #555; }
  </style>
</head>
<body>
  <h1>Activate Smart Clipboard Pro</h1>
  <p class="muted">Click the button below to open the extension and activate your license.</p>
  <p><strong>License key:</strong><br><code>${safeLicenseText}</code></p>
  <p>
    <a class="button" href="${safeExtUrl}">Open extension & activate</a>
  </p>
  <p class="muted">If the button does not open the extension, make sure it is installed:</p>
  <p><a href="${webStoreUrl}">${webStoreUrl}</a></p>
</body>
</html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
});

function validateOfflineLicense(key) {
    const LICENSE_SECRET = getOfflineLicenseSecret();
    const compact = key.replace(/-/g, '');
    const payload = compact.slice(0, 12);
    const checksum = compact.slice(12);

    let hash = 0;
    const seed = (payload + LICENSE_SECRET).toUpperCase();
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 131 + seed.charCodeAt(i)) >>> 0;
    }
    const computed = hash.toString(36).toUpperCase().slice(-4).padStart(4, '0');

    return computed === checksum;
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`🚀 License verification server running on port ${port}`);
    console.log(`   Lemon Squeezy API: ${LEMONSQUEEZY_API_KEY ? 'Configured' : 'NOT configured'}`);
    console.log(`   Offline Mode: ${process.env.OFFLINE_MODE === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log(`   Allowed Origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'All (dev mode)'}`);
});
