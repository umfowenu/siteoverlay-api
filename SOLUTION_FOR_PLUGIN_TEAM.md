# 🚨 URGENT FIX: Paid Customer Form Accessibility Issue

## Problem Statement
When a trial license is active, paid customers who want to request their license key experience UI confusion and may think the form is broken.

## Root Cause
The current logic correctly shows the form and handles paid requests, but the UI creates confusion because:

1. Users see "14-Day Free Trial (Already Active)" as disabled
2. The interface doesn't clearly communicate that paid customers can still use the form
3. No clear separation between trial and paid customer workflows

## Solution: Update siteoverlay-pro.php

Replace the current form logic (around lines 230-245) with this improved version:

```php
<?php if ($this->is_trial_active()): ?>
    <!-- TRIAL ACTIVE: Clear separation for paid customers -->
    <div style="background: #e7f3ff; border: 1px solid #b3d9ff; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
        <h4 style="margin: 0 0 10px 0; color: #0056b3;">🔄 Trial Currently Active</h4>
        <p style="margin: 0; color: #0056b3; font-size: 14px;">Your 14-day trial is running. If you've already purchased a license, enter your details below to receive your license key.</p>
    </div>
    
    <div style="margin-bottom: 15px;">
        <label style="font-weight: bold; margin-bottom: 5px; display: block; color: #0056b3;">I Already Purchased - Get My License Key:</label>
        <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Enter your purchase details to receive your license key via email.</p>
    </div>
<?php else: ?>
    <!-- NO TRIAL: Show both options -->
    <div style="margin-bottom: 15px;">
        <label style="font-weight: bold; margin-bottom: 5px; display: block;">Choose Your Option:</label>
        <label><input type="radio" name="license-type" value="trial" checked> 14-Day Free Trial</label>
        <label style="margin-left: 20px;"><input type="radio" name="license-type" value="paid"> I Already Purchased (Get License)</label>
    </div>
<?php endif; ?>

<!-- Hidden field to set license type when trial is active -->
<?php if ($this->is_trial_active()): ?>
    <input type="hidden" name="license-type" value="paid">
<?php endif; ?>
```

## Additional UI Improvements

1. **Update the submit button text** when trial is active:

```php
<?php if ($this->is_trial_active()): ?>
    <button type="button" class="button button-primary" id="submit-license-request">Get My License Key</button>
<?php else: ?>
    <button type="button" class="button button-primary" id="submit-license-request">Submit Registration</button>
<?php endif; ?>
```

2. **Update the success message** to be clearer:

```javascript
// In the JavaScript success handler, update the paid license message:
var msg = (licenseType === 'paid')
    ? '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"><strong>✅ License Key Sent!</strong> Check your email inbox for your license key. Use "Enter License Key" above to activate it.</div>'
    : '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"><strong>✅ Trial Started!</strong> Check your email for trial activation details.</div>';
```

## Testing Checklist

After implementing these changes, test the following scenarios:

### ✅ Scenario 1: Unlicensed User
- [ ] Can see both trial and paid options
- [ ] Can request trial license
- [ ] Can request paid license key

### ✅ Scenario 2: Trial Active User (MAIN FIX)
- [ ] Sees clear messaging about trial being active
- [ ] Can ONLY see paid license option (trial hidden/disabled)
- [ ] Form clearly indicates it's for "getting license key"
- [ ] Name and email fields work properly
- [ ] Submit button says "Get My License Key"
- [ ] Success message is clear about license key email

### ✅ Scenario 3: Paid User
- [ ] Form works correctly
- [ ] API call to `/api/request-paid-license` succeeds
- [ ] Email is sent with license key
- [ ] Can activate license successfully

## Priority Level: HIGH
This affects paid customers' ability to activate their licenses, which directly impacts revenue and customer satisfaction.

## Implementation Time: 30 minutes
These are UI/text changes that don't require backend modifications.