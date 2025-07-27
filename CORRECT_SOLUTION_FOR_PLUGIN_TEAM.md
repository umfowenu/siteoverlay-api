# 🚨 URGENT FIX: Add Paid Customer Form When Trial is Active

## CORRECT Problem Statement
When a trial license is ACTIVE, the plugin completely switches to a different UI section that:
- ❌ Shows ONLY purchase links and license entry field
- ❌ Has NO way for paid customers to request their license key
- ❌ Blocks paid customers until trial expires

## EXACT Issue Location
**File:** `siteoverlay-pro.php`
**Lines:** 309-380 (trial_active section)
**Problem:** Missing paid customer license request form

## SOLUTION: Add Paid Customer Form to Trial Active Section

**REPLACE** the section around lines 360-365 (right before the "Enter License Key" button) with:

```php
                        </div>
                        
                        <!-- NEW: Paid Customer License Request Form -->
                        <div style="background: #e7f3ff; border: 1px solid #b3d9ff; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                            <h4 style="margin: 0 0 15px 0; color: #0056b3;">💼 Already Purchased? Get Your License Key</h4>
                            <p style="margin: 0 0 15px 0; color: #0056b3; font-size: 14px;">
                                If you've already purchased a license, enter your details below to receive your license key via email.
                            </p>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 15px;">
                                <div>
                                    <label for="paid-full-name" style="display: block; margin-bottom: 5px; font-weight: bold; color: #0056b3;">Full Name:</label>
                                    <input type="text" id="paid-full-name" placeholder="Enter your full name" style="width: 100%; padding: 8px; border: 1px solid #b3d9ff; border-radius: 3px;" />
                                </div>
                                <div>
                                    <label for="paid-email-address" style="display: block; margin-bottom: 5px; font-weight: bold; color: #0056b3;">Email Address:</label>
                                    <input type="email" id="paid-email-address" placeholder="Enter your email address" style="width: 100%; padding: 8px; border: 1px solid #b3d9ff; border-radius: 3px;" />
                                </div>
                            </div>
                            
                            <button type="button" class="button button-primary" id="request-paid-license-key" style="background: #0056b3; border-color: #0056b3;">
                                Get My License Key
                            </button>
                            
                            <div id="paid-license-message" style="margin-top: 15px;"></div>
                        </div>
                        
                        <button type="button" class="button button-secondary" id="show-license-form">Enter License Key</button>
```

## ADD JavaScript Handler

Add this JavaScript to handle the paid license request (around line 600):

```javascript
            // Handle paid license request for trial active users
            $('#request-paid-license-key').on('click', function() {
                var fullName = $('#paid-full-name').val();
                var email = $('#paid-email-address').val();
                
                if (!fullName) {
                    alert('Please enter your full name');
                    return;
                }
                if (!email) {
                    alert('Please enter your email address');
                    return;
                }
                
                var $btn = $(this);
                var originalText = $btn.text();
                $btn.text('Sending...').prop('disabled', true);
                
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    timeout: 10000,
                    data: {
                        action: 'siteoverlay_request_paid_license',
                        full_name: fullName,
                        email: email,
                        nonce: '<?php echo wp_create_nonce('siteoverlay_overlay_nonce'); ?>'
                    },
                    success: function(response) {
                        $('#paid-license-message').empty();
                        if (response.success) {
                            $('#paid-license-message').html('<div style="padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;"><strong>✅ License Key Sent!</strong> Check your email inbox for your license key. Use "Enter License Key" below to activate it.</div>');
                            $btn.text('Sent!').prop('disabled', true);
                        } else {
                            $('#paid-license-message').html('<div style="padding: 10px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"><strong>❌ Error:</strong> ' + (response.data ? response.data.message : 'Request failed') + '</div>');
                            $btn.text(originalText).prop('disabled', false);
                        }
                    },
                    error: function(xhr, status, error) {
                        $('#paid-license-message').html('<div style="padding: 10px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;"><strong>❌ Connection Error:</strong> ' + error + '</div>');
                        $btn.text(originalText).prop('disabled', false);
                    }
                });
            });
```

## Expected Workflow

### For Trial Active Users:
1. **Trial users see:** Trial status, purchase options, paid customer form, license entry
2. **Paid customers can:** Enter name/email → Get license key → Enter license key → Replace trial with paid license
3. **Trial users can:** Continue trial or purchase → Enter license key

### Key Benefits:
- ✅ **Paid customers not blocked** during trial period
- ✅ **Separate, clear form** for paid license requests  
- ✅ **Trial users still see trial info** and purchase options
- ✅ **Maintains trial functionality** while adding paid customer support

## Backend Note
The `ajax_request_paid_license` handler already exists and works correctly. This solution only adds the missing frontend form.

## Priority: CRITICAL
This directly impacts revenue - paid customers cannot activate their licenses during trial period.

## Implementation Time: 45 minutes
HTML/CSS/JavaScript changes only, no backend modifications needed.