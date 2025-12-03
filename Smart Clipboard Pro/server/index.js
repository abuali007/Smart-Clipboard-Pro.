import express from 'express';
import fetch from 'node-fetch';
import rateLimit from 'express-rate-limit';

const app = express();
app.use(express.json());

const GUMROAD_API_KEY = process.env.GUMROAD_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
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
const PRODUCT_PERMALINK = process.env.GUMROAD_PRODUCT_PERMALINK || 'imwysv';
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

function getOfflineLicenseSecret() {
    const secret = process.env.OFFLINE_LICENSE_SECRET || process.env.LICENSE_SECRET;
    if (!secret) {
        throw new Error('Offline license secret not configured');
    }
    return secret;
}

app.post('/api/verify-license', limiter, async (req, res) => {
    allowCors(req, res);

    const { licenseKey, increment = false } = req.body || {};
    const normalized = String(licenseKey || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

    if (!/^[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}-[A-Z0-9]{8}$/i.test(normalized)) {
        return res.status(400).json({ valid: false, error: 'Invalid license format. Use XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX' });
    }

    if (!GUMROAD_API_KEY && process.env.OFFLINE_MODE === 'true') {
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

    try {
        const response = await fetch('https://api.gumroad.com/v2/licenses/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                product_permalink: PRODUCT_PERMALINK,
                license_key: normalized,
                increment_uses_count: increment ? 'true' : 'false'
            })
        });

        if (!response.ok) {
            console.error('Gumroad API error:', response.status, response.statusText);
            return res.status(500).json({ valid: false, error: 'Gumroad API temporarily unavailable' });
        }

        const data = await response.json();

        if (!data.success) {
            return res.json({
                valid: false,
                error: data.message || 'License not recognized for this product'
            });
        }

        const purchase = data.purchase;

        if (purchase.refunded) {
            return res.json({ valid: false, error: 'This license was refunded' });
        }

        if (purchase.chargebacked || (purchase.disputed && !purchase.dispute_won)) {
            return res.json({ valid: false, error: 'Payment disputed' });
        }

        const isSubscription = Boolean(purchase.subscription_id);
        const cancelledAt = purchase.subscription_cancelled_at || purchase.subscription_ended_at;
        const failedAt = purchase.subscription_failed_at;

        if (failedAt && Date.parse(failedAt) < Date.now()) {
            return res.json({ valid: false, error: 'Subscription payment failed' });
        }

        if (cancelledAt && Date.parse(cancelledAt) < Date.now()) {
            return res.json({ valid: false, error: 'Subscription has ended' });
        }

        let expiresAt = null;
        if (isSubscription) {
            expiresAt = cancelledAt ? Date.parse(cancelledAt) : null;
        } else {
            const purchaseDate = Date.parse(purchase.created_at) || Date.now();
            expiresAt = purchaseDate + (DEFAULT_DURATION_DAYS * DAY_IN_MS);
        }

        const licenseInfo = {
            key: normalized,
            activated: true,
            productId: purchase.product_id,
            productName: purchase.product_name || 'Smart Clipboard Pro',
            purchaser: {
                email: purchase.email || '',
                name: purchase.full_name || ''
            },
            activatedAt: Date.parse(purchase.created_at) || Date.now(),
            lastVerifiedAt: Date.now(),
            subscriptionId: purchase.subscription_id || null,
            subscriptionType: isSubscription ? (purchase.subscription_period || 'monthly') : `${DEFAULT_DURATION_DAYS}-day pass`,
            subscriptionCancelled: Boolean(cancelledAt),
            nextChargeAt: purchase.subscription_charge_date ? Date.parse(purchase.subscription_charge_date) : null,
            expiresAt,
            planLabel: isSubscription ? 'Pro Subscription' : '30-Day Pro Pass',
            features: DEFAULT_FEATURES,
            usageCount: purchase.uses || purchase.uses_count || 0,
            maxActivations: purchase.max_uses || 3,
            status: 'active'
        };

        console.log(`License verified: ${normalized.slice(0, 12)}... for ${purchase.email}`);
        return res.json({ valid: true, licenseInfo });
    } catch (error) {
        console.error('Verification error:', error);
        return res.status(500).json({
            valid: false,
            error: 'Unable to verify license. Please try again later.'
        });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        gumroadConfigured: Boolean(GUMROAD_API_KEY),
        offlineMode: process.env.OFFLINE_MODE === 'true'
    });
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
    console.log(`   Gumroad API: ${GUMROAD_API_KEY ? 'Configured' : 'NOT configured'}`);
    console.log(`   Offline Mode: ${process.env.OFFLINE_MODE === 'true' ? 'Enabled' : 'Disabled'}`);
    console.log(`   Allowed Origins: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'All (dev mode)'}`);
});
