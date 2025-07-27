/**
 * ENVIRONMENT VARIABLES DOCUMENTATION
 *
 * TRIAL FLOW VARIABLES:
 *
 * PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY
 *   Purpose: New trial subscriber registration
 *   When: User completes trial registration form
 *   Action: Creates new subscriber in AWeber with trial-active tag
 *   Example: https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjUwNTY0...
 *
 * PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER  
 *   Purpose: Add tags to existing trial subscribers
 *   When: Trial expires (daily cron check)
 *   Action: Adds trial-end tag to existing AWeber subscriber
 *   Example: https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZh...
 *
 * SALES_PAGE_URL
 *   Purpose: Dynamic sales page URL included in email tags
 *   Usage: Sent as part of aweber_tags for email personalization
 *   Default: https://siteoverlay.24hr.pro
 *   Note: Can be updated centrally to change all email links
 *
 * SUPPORT_EMAIL
 *   Purpose: Support contact email for customer communications
 *   Usage: Included in all Pabbly webhook data
 *   Default: support@siteoverlaypro.com
 */

/**
 * TRIAL FLOW: Send trial data to Pabbly for AWeber integration
 * 
 * PURPOSE: Sends trial events to Pabbly which routes to AWeber for email automation
 * TRIGGERS: 
 *   - Trial registration (aweber_tags: 'trial-active')
 *   - Trial expiry (aweber_tags: 'trial-end') 
 * 
 * BUSINESS LOGIC:
 *   - New trials get 'trial-active' tag for welcome email automation
 *   - Expiring trials get 'trial-end' tag for renewal email automation
 *   - Tags are comma-separated: "trial-active,https://siteoverlay.24hr.pro"
 *   - Sales page URL included in tags for dynamic email content
 * 
 * WEBHOOKS USED:
 *   - PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY (new subscriber registration)
 *   - PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER (add tags to existing subscriber)
 * 
 * AWEBER INTEGRATION:
 *   - New subscribers: Creates subscriber + adds trial-active tag
 *   - Existing subscribers: Adds trial-end tag without creating duplicate
 *   - Both tags trigger different email sequences in AWeber
 * 
 * @param {string} email - Customer email address
 * @param {string} licenseKey - Trial license key (format: TRIAL-XXXX-XXXX-XXXX)
 * @param {object} metadata - Additional data (customer_name, trial_expires, aweber_tags)
 * @returns {boolean} - True if webhook sent successfully
 */
// Pabbly Connect integration with enhanced AWeber data
const db = require('../db');

async function sendToPabbly(email, licenseKey, licenseType, metadata = {}) {
  try {
    // Get current site usage for AWeber fields
    let sitesActive = 0;
    let sitesRemaining = 'Unknown';
    
    if (licenseKey && licenseKey !== 'newsletter') {
      try {
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        sitesActive = parseInt(usageResult.rows[0].count) || 0;
        
        // Get license to determine site limit
        const licenseResult = await db.query(
          'SELECT site_limit FROM licenses WHERE license_key = $1',
          [licenseKey]
        );
        
        if (licenseResult.rows.length > 0) {
          const siteLimit = licenseResult.rows[0].site_limit;
          if (siteLimit === -1) {
            sitesRemaining = 'Unlimited';
          } else {
            sitesRemaining = Math.max(0, siteLimit - sitesActive).toString();
          }
        }
      } catch (usageError) {
        console.log('⚠️ Could not get site usage for AWeber data:', usageError.message);
      }
    }

    // Prepare enhanced data for Pabbly Connect webhook
    const pabblyData = {
      // Core data
      email: email,
      license_key: licenseKey,
      license_type: licenseType,
      
      // AWeber custom fields (your 4 fields)
      installs_remaining: sitesRemaining,
      sites_active: sitesActive.toString(),
      next_renewal: metadata.renewal_date ? 
        (typeof metadata.renewal_date === 'string' ? metadata.renewal_date.split('T')[0] : metadata.renewal_date.toISOString().split('T')[0]) :
        (licenseType === 'lifetime_unlimited' ? 'Never' : 'Unknown'),
      
      // Customer context
      customer_name: metadata.customer_name || '',
      website_url: metadata.website_url || '',
      site_url: metadata.site_url || '',
      
      // Purchase data
      purchase_amount: metadata.purchase_amount || '0',
      currency: metadata.currency || 'USD',
      payment_processor: metadata.payment_processor || 'stripe',
      
      // Timing data
      signup_date: new Date().toISOString(),
      trial_expires: metadata.trial_expires || '',
      
      // AWeber list and tagging
      aweber_list: 'siteoverlay-pro-buyers',
      aweber_tags: [
        'SiteOverlay Pro',
        licenseType === 'trial' ? 'Trial User' : 'Paying Customer',
        licenseType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        metadata.payment_processor ? metadata.payment_processor.toUpperCase() : 'STRIPE'
      ].join(','),
      
      // Email template variables
      product_name: 'SiteOverlay Pro',
      trial_duration: '14 days',
      support_email: 'support@siteoverlaypro.com',
      login_instructions: 'Go to WordPress Admin → Settings → SiteOverlay Pro'
    };

    console.log('Sending to Pabbly Connect:', { email, licenseKey, licenseType, sitesActive, sitesRemaining });

    // Send to Pabbly Connect webhook
    if (process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pabblyData)
      });

      if (response.ok) {
        console.log('✅ Pabbly webhook sent successfully');
        return true;
      } else {
        console.error('❌ Pabbly webhook failed:', response.status, response.statusText);
        return false;
      }
    } else {
      console.log('⚠️ No Pabbly webhook URL configured');
      return false;
    }

  } catch (error) {
    console.error('❌ Pabbly webhook error:', error);
    return false;
  }
}

/**
 * TRIAL-SPECIFIC WEBHOOK: Send trial data to Pabbly for AWeber tag updates
 *
 * @description Sends trial events to Pabbly for AWeber automation (existing subscribers)
 *
 * BUSINESS LOGIC:
 *   - Used for trial-end notifications (aweber_tags: 'trial-end')
 *   - Adds tags to existing AWeber subscribers (no duplicate creation)
 *   - Tags are comma-separated: "trial-end,https://siteoverlay.24hr.pro"
 *   - Sales page URL included for dynamic email content
 *
 * WEBHOOK USED:
 *   - PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER (add tags to existing subscriber)
 *
 * AWEBER INTEGRATION:
 *   - Adds trial-end tag to existing subscriber
 *   - Triggers renewal/upgrade automation in AWeber
 *
 * @param {string} email - Customer email address
 * @param {string} licenseKey - Trial license key (format: TRIAL-XXXX-XXXX-XXXX)
 * @param {object} metadata - Additional data (customer_name, trial_expires, aweber_tags)
 * @returns {boolean} - True if webhook sent successfully
 */
async function sendTrialToPabbly(email, licenseKey, metadata = {}) {
  try {
    const pabblyData = {
      trial_expires: metadata.trial_expires || '',
      trial_duration: '14 days',
      support_email: process.env.SUPPORT_EMAIL || 'support@siteoverlaypro.com',
      site_url: metadata.website_url || metadata.site_url || '',
      signup_date: new Date().toISOString(),
      product_name: 'SiteOverlay Pro',
      license_type: 'trial',
      license_key: licenseKey,
      email: email,
      customer_name: metadata.customer_name || '',
      // Comma-separated tags for AWeber
      aweber_tags: [
        metadata.aweber_tags || 'trial-active',
        process.env.SALES_PAGE_URL || 'https://siteoverlay.24hr.pro'
      ].join(',')
    };

    console.log('Sending trial to Pabbly:', pabblyData);

    if (process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pabblyData)
      });
      return response.ok;
    }
    return false;
  } catch (error) {
    console.error('❌ Trial Pabbly error:', error);
    return false;
  }
}

/**
 * LICENSE UPDATE WEBHOOK: Send paid license data to Pabbly for AWeber tag updates
 *
 * @description Sends paid license events to Pabbly for AWeber automation (existing subscribers)
 *
 * BUSINESS LOGIC:
 *   - Used for new paid license generation (site-license-generated)
 *   - Adds tags to existing AWeber subscribers (no duplicate creation)
 *   - Tags are comma-separated: "site-license-generated,license-email-sent,https://siteoverlay.24hr.pro"
 *   - Sales page URL included for dynamic email content
 *
 * WEBHOOK USED:
 *   - PABBLY_WEBHOOK_URL_LICENSE_UPDATE (add tags to existing subscriber)
 *
 * AWEBER INTEGRATION:
 *   - Adds site-license-generated tag to existing subscriber
 *   - Triggers license delivery automation in AWeber
 *
 * @param {string} email - Customer email address
 * @param {string} siteLicenseKey - Site-specific license key (format: SITE-XXXX-XXXX-XXXX)
 * @param {object} metadata - Additional data (customer_name, site_url, license_type, installs_remaining, sites_active, aweber_tags)
 * @returns {boolean} - True if webhook sent successfully
 */
async function sendLicenseUpdateToPabbly(email, siteLicenseKey, metadata = {}) {
  try {
    const pabblyData = {
      email: email,
      customer_name: metadata.customer_name || '',
      
      // License install data
      installs_remaining: metadata.installs_remaining || '',
      sites_active: metadata.sites_active || '',
      site_url: metadata.site_url || '',
      sales_page: process.env.SALES_PAGE_URL || 'https://siteoverlay.24hr.pro',
      license_key: siteLicenseKey,
      
      // PRESERVE purchase data that would otherwise be lost
      next_renewal: metadata.next_renewal || '',
      support_email: process.env.SUPPORT_EMAIL || 'support@ebiz360.ca',
      
      aweber_tags: "new_license,clear-tags"
    };
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_UPDATE) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_UPDATE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pabblyData)
      });
      if (response.ok) {
        console.log('✅ License email sent via Pabbly to:', email);
        return true;
      } else {
        console.error('❌ License email failed:', response.status);
        return false;
      }
    }
    return false;
  } catch (error) {
    console.error('❌ License email error:', error);
    return false;
  }
}

/**
 * RENEWAL REMINDER WEBHOOK: Send renewal reminder data to Pabbly for AWeber integration
 *
 * @description Sends renewal reminder events to Pabbly for AWeber automation (existing subscribers)
 *
 * BUSINESS LOGIC:
 *   - Used for subscription renewal reminders (aweber_tags: 'subscription_ending,clear-tags')
 *   - Updates existing subscriber in AWeber with subscription_ending tag
 *   - Includes clear-tags for automated tag cleanup
 *   - Triggers renewal reminder email automation in AWeber
 *
 * WEBHOOK USED:
 *   - PABBLY_WEBHOOK_URL_LICENSE_INSTALL (reuses same webhook for buyer updates)
 *
 * AWEBER INTEGRATION:
 *   - Updates existing subscriber + adds subscription_ending tag
 *   - Includes clear-tags for automated cleanup
 *   - Triggers renewal reminder automation in AWeber
 *
 * @param {string} email - Customer email address
 * @param {object} metadata - Additional data (customer_name, installs_remaining, sites_active)
 * @returns {boolean} - True if webhook sent successfully
 */
async function sendRenewalReminderToPabbly(email, metadata = {}) {
  try {
    const renewalData = {
      email: email,
      customer_name: metadata.customer_name || '',
      
      // Preserve all existing custom field data
      installs_remaining: metadata.installs_remaining || '',
      sites_active: metadata.sites_active || '',
      site_url: metadata.site_url || '',
      sales_page: metadata.sales_page || process.env.SALES_PAGE_URL || 'https://siteoverlay.24hr.pro',
      license_key: metadata.license_key || '',
      
      // PRESERVE purchase data that would otherwise be lost
      next_renewal: metadata.next_renewal || '',
      support_email: metadata.support_email || process.env.SUPPORT_EMAIL || 'support@ebiz360.ca',
      
      aweber_tags: "subscription_ending,clear-tags"
    };

    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(renewalData)
      });

      if (response.ok) {
        console.log('✅ Renewal reminder sent successfully to:', email);
        return true;
      } else {
        console.error('❌ Renewal reminder failed:', response.status);
        return false;
      }
    }
    return false;
  } catch (error) {
    console.error('❌ Renewal reminder error:', error);
    return false;
  }
}

/**
 * PURCHASE WEBHOOK: Send purchase data to Pabbly for AWeber integration
 *
 * @description Sends purchase events to Pabbly for AWeber automation (new subscribers)
 *
 * BUSINESS LOGIC:
 *   - Used for new paid license purchases (aweber_tags: 'subscription-active')
 *   - Creates new subscriber in AWeber with subscription-active tag
 *   - Tags are comma-separated: "subscription-active,https://siteoverlay.24hr.pro"
 *   - Sales page URL included for dynamic email content
 *
 * WEBHOOK USED:
 *   - PABBLY_WEBHOOK_URL_PURCHASE (new subscriber registration)
 *
 * AWEBER INTEGRATION:
 *   - Creates new subscriber + adds subscription-active tag
 *   - Triggers welcome email automation in AWeber
 *
 * @param {string} email - Customer email address
 * @param {string} licenseType - License type (professional, annual_unlimited, lifetime_unlimited)
 * @param {object} metadata - Additional data (customer_name, next_renewal)
 * @returns {boolean} - True if webhook sent successfully
 */
async function sendPurchaseToPabbly(email, licenseType, metadata = {}) {
  try {
    const purchaseData = {
      email: email,
      customer_name: metadata.customer_name || '',
      support_email: process.env.SUPPORT_EMAIL || 'support@ebiz360.ca',
      sales_page: process.env.SALES_PAGE_URL || 'https://siteoverlay.24hr.pro',
      next_renewal: metadata.next_renewal || 'Unknown',
      license_type: licenseType,
      aweber_tags: "subscription-active"
    };

    if (process.env.PABBLY_WEBHOOK_URL_PURCHASE) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_PURCHASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(purchaseData)
      });

      if (response.ok) {
        console.log('✅ Purchase webhook sent successfully to:', email);
        return true;
      } else {
        console.error('❌ Purchase webhook failed:', response.status);
        return false;
      }
    }
    return false;
  } catch (error) {
    console.error('❌ Purchase webhook error:', error);
    return false;
  }
}

module.exports = {
  sendToPabbly,              // Keep existing
  sendTrialToPabbly,         // Keep existing  
  sendLicenseUpdateToPabbly, // Keep existing
  sendPurchaseToPabbly,      // Keep existing
  sendRenewalReminderToPabbly  // ADD new function
}; 