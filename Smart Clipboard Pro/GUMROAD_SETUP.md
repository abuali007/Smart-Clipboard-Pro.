# Gumroad Integration Setup Guide

## How to Set Up Monthly Subscriptions with Gumroad

### Step 1: Configure Gumroad Product

1. Go to your Gumroad product page: https://litextools.gumroad.com/l/imwysv
2. Make sure the product is set to **Subscription** mode ($2/month)
3. Enable **License Keys** in product settings

### Step 2: Set Up License Key Delivery

Gumroad can automatically send license keys via email when customers purchase. However, for better control, you have two options:

#### Option A: Use Gumroad's Built-in License Keys (Recommended for Start)

1. In Gumroad product settings, enable "License Keys"
2. Gumroad will generate and email license keys automatically
3. Customers receive keys in format: `XXXX-XXXX-XXXX-XXXX`

#### Option B: Custom Backend Verification (Recommended for Production)

1. Set up a backend server (Node.js, PHP, Python, etc.)
2. Configure Gumroad webhooks to send purchase notifications
3. Generate custom license keys and verify them server-side

### Step 3: Backend Server Setup (Optional but Recommended)

Create an API endpoint to verify licenses:

```javascript
// Example: Node.js/Express
app.post('/verify-license', async (req, res) => {
    const { licenseKey, productId } = req.body;
    
    // Verify with Gumroad API or your database
    const isValid = await verifyWithGumroad(licenseKey, productId);
    
    if (isValid) {
        res.json({ 
            valid: true, 
            licenseInfo: {
                key: licenseKey,
                activated: true,
                activatedAt: Date.now(),
                expiresAt: null,
                subscriptionType: 'monthly',
                features: ['unlimited_history', 'snippets', 'auto_backup', 'analytics']
            }
        });
    } else {
        res.json({ valid: false, error: 'Invalid license key' });
    }
});
```

### Step 4: Update Extension Code

In `background.js`, update the `verifyLicense` function to call your backend:

```javascript
async function verifyLicense(licenseKey) {
    try {
        // Validate format first
        const licensePattern = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;
        if (!licensePattern.test(licenseKey)) {
            return { valid: false, error: 'Invalid license key format' };
        }
        
        // Verify with your backend
        const response = await fetch('https://your-backend.com/verify-license', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                licenseKey,
                productId: 'imwysv' // Your Gumroad product ID
            })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            // Store license info
            await chrome.storage.local.set({ 
                [LICENSE_STORAGE_KEY]: result.licenseInfo 
            });
        }
        
        return result;
    } catch (error) {
        console.error('License verification error:', error);
        return { valid: false, error: 'Verification failed. Please try again.' };
    }
}
```

### Step 5: Monthly Subscription Check

Add a function to check if subscription is still active:

```javascript
async function checkSubscriptionStatus() {
    const licenseInfo = await getLicenseInfo();
    
    if (!licenseInfo || !licenseInfo.activated) {
        return { active: false };
    }
    
    // For monthly subscriptions, check if it's been renewed
    const daysSinceActivation = (Date.now() - licenseInfo.activatedAt) / (1000 * 60 * 60 * 24);
    
    if (daysSinceActivation > 30) {
        // Verify with server if subscription is still active
        const response = await fetch('https://your-backend.com/check-subscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ licenseKey: licenseInfo.key })
        });
        
        const result = await response.json();
        return result;
    }
    
    return { active: true };
}
```

### Step 6: Customer Instructions

Provide these instructions to customers:

1. **Purchase**: Go to https://litextools.gumroad.com/l/imwysv and subscribe
2. **Receive Key**: Check your email for the license key (format: XXXX-XXXX-XXXX-XXXX)
3. **Activate**: 
   - Open Smart Clipboard Pro extension
   - Click Settings (⚙️)
   - Go to "License Activation" section
   - Enter your license key
   - Click "Activate License"

### Troubleshooting

**Q: Customer didn't receive license key?**
- Check Gumroad email settings
- Verify license keys are enabled in product settings
- Check spam folder

**Q: License key not working?**
- Verify the key format is correct
- Check if subscription is still active in Gumroad
- Verify backend API is working (if using custom verification)

**Q: How to handle subscription renewals?**
- Gumroad automatically renews monthly subscriptions
- The extension should check subscription status monthly
- If payment fails, Gumroad will notify you and the customer

### Security Notes

1. **Never hardcode license keys** in the extension code
2. **Always verify on server-side** for production use
3. **Use HTTPS** for all API calls
4. **Implement rate limiting** on verification endpoints
5. **Log verification attempts** for security monitoring

### Next Steps

1. Set up your backend server (if using Option B)
2. Test the license activation flow
3. Update the extension code with your backend URL
4. Test with a real Gumroad purchase
5. Monitor subscription renewals

---

For more help, contact: support@smartclipboard.pro
