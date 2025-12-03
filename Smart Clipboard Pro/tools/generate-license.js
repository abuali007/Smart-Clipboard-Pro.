#!/usr/bin/env node

const crypto = require('crypto');

const LICENSE_SECRET = 'SC-PRO-2025-LICENSE';
const LICENSE_PATTERN = /^([A-Z0-9]{4}-){3}[A-Z0-9]{4}$/i;

function randomPayload() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 12; i++) {
        result += chars.charAt(crypto.randomInt(chars.length));
    }
    return result;
}

function computeLicenseChecksum(payload) {
    let hash = 0;
    const seed = (payload + LICENSE_SECRET).toUpperCase();
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 131 + seed.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36).toUpperCase().slice(-4).padStart(4, '0');
}

function formatKey(compact) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}`;
}

function generateLicense() {
    const payload = randomPayload();
    const checksum = computeLicenseChecksum(payload);
    return formatKey(payload + checksum);
}

function validateLicense(key) {
    if (!LICENSE_PATTERN.test(key)) return false;
    const compact = key.toUpperCase().replace(/-/g, '');
    const payload = compact.slice(0, 12);
    const checksum = compact.slice(12);
    return computeLicenseChecksum(payload) === checksum;
}

if (process.argv.includes('--verify')) {
    const key = process.argv[process.argv.length - 1];
    if (!key || key.startsWith('--')) {
        console.error('Usage: node tools/generate-license.js --verify XXXX-XXXX-XXXX-XXXX');
        process.exit(1);
    }
    console.log(validateLicense(key) ? 'VALID' : 'INVALID');
    process.exit(0);
}

const quantityArg = process.argv.find((arg) => arg.startsWith('--count='));
const count = quantityArg ? Number(quantityArg.split('=')[1]) : 1;

for (let i = 0; i < count; i++) {
    console.log(generateLicense());
}
