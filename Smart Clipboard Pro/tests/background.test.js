/**
 * NOTE: The background script is not authored as an ES module, so these tests
 * are provided as scaffolding. Once background.js is modularized (or a build
 * step is added), swap to real imports and enable the suites.
 */
import { describe, it } from 'vitest';

describe.skip('Blacklist System (pending module export)', () => {
    it('should generate consistent hash for same text', () => {});
    it('should detect blacklisted text', async () => {});
    it('should not detect non-blacklisted text', async () => {});
});

describe.skip('License Verification (pending module export)', () => {
    it('should reject invalid format', async () => {});
    it('should accept valid format', async () => {});
});
