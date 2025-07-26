# 🚨 RAILWAY TEAM: Fix Required - Trial Key Rejection

## Issue Identified
The `/api/validate-license` endpoint currently **accepts trial keys** and treats them as valid licenses. This creates user confusion.

## Problem
When users enter a trial key (TRIAL-*) in the "Enter License Key" field:
- ✅ API responds with `{"success":true}` 
- ❌ Should respond with `{"success":false, "message":"Trial keys cannot be used for license activation"}`

## API Fix Required

**File:** `/routes/validate-license` (or equivalent route handler)

**Current behavior:**
```javascript
// Currently accepts trial keys
if (license_key.startsWith('TRIAL-')) {
    // Returns success - WRONG
}
```

**Required fix:**
```javascript
// REJECT trial keys in license validation
if (license_key.startsWith('TRIAL-')) {
    return res.json({
        success: false,
        message: "Trial keys cannot be used for license activation. This is a trial key - please request your paid license key instead."
    });
}
```

## Test Case
```bash
curl -X POST https://siteoverlay-api-production.up.railway.app/api/validate-license \
-H "Content-Type: application/json" \
-d '{"licenseKey":"TRIAL-AF96FBFB506ADF01","siteUrl":"https://test.com"}'

# Should return:
# {"success":false,"message":"Trial keys cannot be used for license activation. This is a trial key - please request your paid license key instead."}
```

## Priority: HIGH
This fix prevents user confusion and ensures proper license workflow.