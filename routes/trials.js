// Trial management routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateLicenseKey, generateSiteSignature } = require('../utils/license-mappings');
const { sendToPabbly, sendTrialToPabbly, sendLicenseUpdateToPabbly } = require('../utils/pabbly-utils');

// Test endpoint to check if the module is working
router.get('/test-trial', (req, res) => {
  res.json({
    success: true,
    message: 'Trials module is working correctly',
    timestamp: new Date().toISOString()
  });
});

// Start trial endpoint
router.post('/start-trial', async (req, res) => {
  try {
    const { siteUrl, pluginVersion, productCode, full_name, email } = req.body;

    if (!email || !full_name) {
      return res.json({
        success: false,
        message: 'Name and email are required for trial'
      });
    }

    console.log('🆓 Starting trial for:', email, 'Product:', productCode);

    // Check if user already has a trial
    const existingTrial = await db.query(
      'SELECT * FROM licenses WHERE customer_email = $1 AND license_type = $2',
      [email, 'trial']
    );

    if (existingTrial.rows.length > 0) {
      const existingLicense = existingTrial.rows[0];
      
      return res.json({
        success: true,
        message: 'Trial already exists for this email',
        data: {
          license_key: existingLicense.license_key,
          trial_expires: existingLicense.trial_end_date,
          sites_remaining: Math.max(0, 1 - 0)
        }
      });
    }

    // Generate trial license key
    const trialLicenseKey = 'TRIAL-' + generateLicenseKey();
    const trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    console.log('💾 Inserting trial license into database...');
    
    const licenseResult = await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_date, trial_end_date, subscription_id, subscription_status,
        stripe_price_id, amount_paid, payment_processor, purchase_source, 
        site_limit, kill_switch_enabled, resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id
    `, [
      trialLicenseKey, 'trial', 'trial', email, full_name,
      new Date(), trialExpires, null, null, null, 0, 'trial',
      'email_trial_request', 1, true, true
    ]);

    // Record trial in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, amount_paid, purchase_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      licenseResult.rows[0].id, email, 'trial', 'trial', trialLicenseKey,
      0, new Date(), 'trial', 'Free trial request'
    ]);

    // Send to Pabbly Connect (trials)
    const pabblySuccess = await sendTrialToPabbly(email, trialLicenseKey, {
      customer_name: full_name,
      site_url: siteUrl,
      trial_expires: trialExpires.toISOString(),
      aweber_tags: 'trial-active'
    });

    // Store in email collection table
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type, customer_name,
        site_url, sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      email, trialLicenseKey, 'trial_request', 'trial', full_name,
      siteUrl || '', pabblySuccess ? true : false
    ]);

    res.json({
      success: true,
      message: 'Trial license created successfully',
      data: {
        license_key: trialLicenseKey,
        trial_expires: trialExpires.toISOString(),
        sites_remaining: 1,
        customer_name: full_name,
        customer_email: email
      }
    });

  } catch (error) {
    console.error('❌ Trial creation error:', error);
    res.json({
      success: false,
      message: 'Failed to create trial license',
      error: error.message
    });
  }
});

// Alias for WordPress plugin compatibility - /request-trial endpoint
router.post('/request-trial', async (req, res) => {
  try {
    // Map WordPress plugin request format to internal format
    const { name, email, domain } = req.body;
    const siteUrl = domain;
    const pluginVersion = '1.0';
    const productCode = 'wordpress_plugin';
    const full_name = name;

    if (!email || !full_name) {
      return res.json({
        success: false,
        message: 'Name and email are required for trial'
      });
    }

    console.log('🆓 Starting trial for:', email, 'Product:', productCode);

    // Check if user already has a trial
    const existingTrial = await db.query(
      'SELECT * FROM licenses WHERE customer_email = $1 AND license_type = $2',
      [email, 'trial']
    );

    if (existingTrial.rows.length > 0) {
      const existingLicense = existingTrial.rows[0];
      
      return res.json({
        success: true,
        message: 'Trial already exists for this email',
        data: {
          license_key: existingLicense.license_key,
          trial_expires: existingLicense.trial_end_date,
          sites_remaining: Math.max(0, 1 - 0)
        }
      });
    }

    // Generate trial license key
    const trialLicenseKey = 'TRIAL-' + generateLicenseKey();
    const trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    console.log('💾 Inserting trial license into database...');
    
    const licenseResult = await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_date, trial_end_date, subscription_id, subscription_status,
        stripe_price_id, amount_paid, payment_processor, purchase_source, 
        site_limit, kill_switch_enabled, resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id
    `, [
      trialLicenseKey, 'trial', 'trial', email, full_name,
      new Date(), trialExpires, null, null, null, 0, 'trial',
      'wordpress_plugin_trial', 1, true, true
    ]);

    // Record trial in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, amount_paid, purchase_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      licenseResult.rows[0].id, email, 'trial', 'trial', trialLicenseKey,
      0, new Date(), 'trial', 'WordPress plugin trial request'
    ]);

    // Send to Pabbly Connect (trials)
    const pabblySuccess = await sendTrialToPabbly(email, trialLicenseKey, {
      customer_name: full_name,
      site_url: siteUrl,
      trial_expires: trialExpires.toISOString(),
      aweber_tags: 'trial-active'
    });

    // Store in email collection table
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type, customer_name,
        site_url, sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      email, trialLicenseKey, 'trial_request', 'trial', full_name,
      siteUrl || '', pabblySuccess ? true : false
    ]);

    res.json({
      success: true,
      message: 'Trial license created successfully',
      data: {
        license_key: trialLicenseKey,
        trial_expires: trialExpires.toISOString(),
        sites_remaining: 1,
        customer_name: full_name,
        customer_email: email
      }
    });

  } catch (error) {
    console.error('❌ Trial creation error:', error);
    res.json({
      success: false,
      message: 'Failed to create trial license'
    });
  }
});

/**
 * TRIAL EXPIRY MONITORING ENDPOINT
 * 
 * BUSINESS LOGIC:
 *   - Runs daily via cron job to check for trials expiring TODAY
 *   - NO grace period for trials (expire exactly at 14 days)
 *   - Sends trial-end notification to trigger AWeber renewal emails
 *   - Marks trials as notified to prevent duplicate emails
 * 
 * DATABASE LOGIC:
 *   - Finds trials where DATE(trial_end_date) = TODAY
 *   - Only processes trials not already notified (trial_end_notified != true)
 *   - Updates trial_end_notified = true after successful notification
 * 
 * PABBLY INTEGRATION:
 *   - Uses PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER webhook
 *   - Sends trial-end tag to add to existing AWeber subscriber
 *   - Includes sales page URL for dynamic email content
 * 
 * CRON SETUP:
 *   - Should be called daily at specific time (e.g., 9 AM)
 *   - Requires CRON_SECRET header for security
 *   - Example: curl -X POST -H "x-cron-secret: SECRET" /api/check-expiring-trials
 */
router.post('/check-expiring-trials', async (req, res) => {
  try {
    // Get trials expiring today (no grace period for trials)
    const today = new Date();
    const expiringTrials = await db.query(`
      SELECT license_key, customer_email, customer_name, trial_end_date
      FROM licenses 
      WHERE license_type = 'trial' 
      AND status = 'trial'
      AND DATE(trial_end_date) = DATE($1)
      AND trial_end_notified != true
    `, [today]);

    console.log(`Found ${expiringTrials.rows.length} trials expiring today`);

    for (const trial of expiringTrials.rows) {
      // Send "trial-end" notification to Pabbly
      const pabblySuccess = await sendTrialToPabbly(trial.customer_email, trial.license_key, {
        customer_name: trial.customer_name,
        trial_expires: trial.trial_end_date,
        aweber_tags: 'trial-end'
      });

      if (pabblySuccess) {
        // Mark as notified
        await db.query(`
          UPDATE licenses 
          SET trial_end_notified = true 
          WHERE license_key = $1
        `, [trial.license_key]);
        console.log(`✅ Trial end notification sent for: ${trial.customer_email}`);
      }
    }

    res.json({ 
      success: true, 
      trials_processed: expiringTrials.rows.length 
    });

  } catch (error) {
    console.error('❌ Error checking expiring trials:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PAID LICENSE REQUEST ENDPOINT
 *
 * @description Handles paid license requests for new site installations
 *
 * BUSINESS LOGIC:
 *   - Validates full name, email, and domain
 *   - Checks for active subscription (monthly/annual/lifetime) by email
 *   - Enforces site limits for the subscription
 *   - Generates new site-specific license key (SITE-XXXX-XXXX-XXXX)
 *   - Registers the site in site_usage table
 *   - Sends license to customer via email (Pabbly/AWeber)
 *   - Does NOT send license key to plugin (email delivery only)
 *
 * DATABASE OPERATIONS:
 *   - SELECT licenses by customer_email and license_type
 *   - COUNT active sites for license
 *   - INSERT new site_usage record with site_license_key
 *
 * INTEGRATION:
 *   - Uses sendLicenseUpdateToPabbly() for email delivery
 *   - Uses PABBLY_WEBHOOK_URL_LICENSE_INSTALL webhook
 *
 * ERROR HANDLING:
 *   - No active subscription found → "Please purchase or request a trial"
 *   - Site limit exceeded → "Site limit reached (X sites). Please upgrade"
 *   - Database errors → "Failed to process license request"
 *
 * @param {string} name - Full name of customer
 * @param {string} email - Customer email address
 * @param {string} domain - Site domain for license
 * @returns {Object} Success or error message
 */
router.post('/request-paid-license', async (req, res) => {
  try {
    const { name, email, domain } = req.body;
    if (!name || !email || !domain) {
      return res.json({
        success: false,
        message: 'Full name, email, and domain are required'
      });
    }
    // Debug logging to help troubleshoot
    console.log('🔍 License validation for email:', email);
    console.log('🔍 Looking for license types: 5_site_license, annual_unlimited, lifetime_unlimited');
    
    // 1. Find active subscription by email
    const subscription = await db.query(`
      SELECT * FROM licenses 
      WHERE customer_email = $1 
      AND (license_type = '5_site_license' OR license_type = 'annual_unlimited' OR license_type = 'lifetime_unlimited')
      AND status = 'active'
      AND kill_switch_enabled = true
    `, [email]);
    if (subscription.rows.length === 0) {
      console.log('🔍 No subscription found for email:', email);
      
      return res.json({
        success: false,
        message: 'No active subscription found for this email address. If you purchased with a different email, please contact support with your purchase details.',
        support_action: 'email_mismatch'
      });
    }
    // 2. Check site limits
    const mainLicense = subscription.rows[0];
    const currentSites = await db.query(`
      SELECT COUNT(*) as count FROM site_usage 
      WHERE license_key = $1 AND status = 'active'
    `, [mainLicense.license_key]);
    const siteCount = parseInt(currentSites.rows[0].count);
    const siteLimit = mainLicense.site_limit;
    if (siteLimit > 0 && siteCount >= siteLimit) {
      return res.json({
        success: false,
        message: `Site limit reached (${siteLimit} sites). Please upgrade your subscription.`
      });
    }
    // 3. Generate new site-specific license
    const siteLicenseKey = 'SITE-' + generateLicenseKey();
    // 4. Register the site
    await db.query(`
      INSERT INTO site_usage (
        license_key, site_signature, site_domain, site_url, 
        site_license_key, customer_email, customer_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      mainLicense.license_key,
      generateSiteSignature({ site_domain: new URL(domain).hostname }),
      new URL(domain).hostname,
      domain,
      siteLicenseKey,
      email,
      name,
      'active'
    ]);
    // 5. Send to Pabbly (Connection 2) - Email delivery with license
    await sendLicenseUpdateToPabbly(email, siteLicenseKey, {
      customer_name: name,
      site_url: domain,
      license_type: mainLicense.license_type,
      installs_remaining: siteLimit > 0 ? (siteLimit - siteCount - 1).toString() : 'Unlimited',
      sites_active: (siteCount + 1).toString(),
      aweber_tags: 'site-license-generated,license-email-sent'
    });
    res.json({
      success: true,
      message: 'License generated and sent to your email. Check your inbox for the license key.'
    });
  } catch (error) {
    console.error('❌ Paid license request error:', error);
    res.json({
      success: false,
      message: 'Failed to process license request'
    });
  }
});

// Temporary endpoint to get the most recent trial license details
router.get('/get-trial-details', async (req, res) => {
  try {
    const trials = await db.query(`
      SELECT 
        license_key,
        customer_email,
        customer_name,
        trial_end_date,
        status,
        created_at
      FROM licenses 
      WHERE license_type = 'trial'
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    res.json({ 
      success: true, 
      trials: trials.rows 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test endpoint for trial-end notification
router.post('/test-trial-end', async (req, res) => {
  try {
    const { email, license_key, customer_name } = req.body;
    if (!email || !license_key || !customer_name) {
      return res.status(400).json({ 
        success: false, 
        message: 'email, license_key, and customer_name are required' 
      });
    }
    console.log('=== DEBUG INFO ===');
    console.log('Environment variable:', process.env.PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER);
    console.log('Webhook URL exists:', !!process.env.PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER);
    const success = await sendTrialToPabbly(email, license_key, {
      customer_name: customer_name,
      site_url: 'https://test-site.com', // placeholder
      trial_expires: new Date().toISOString(),
      aweber_tags: 'trial-end'  // This will become "trial-end,https://siteoverlay.24hr.pro"
    });
    console.log('Pabbly response success:', success);
    res.json({ 
      success: success, 
      message: success ? 'Trial end notification sent to Pabbly' : 'Failed to send notification',
      debug: {
        webhook_url_exists: !!process.env.PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER,
        webhook_url: process.env.PABBLY_WEBHOOK_URL_TRIAL_EMAIL_UPDATER ? 'SET' : 'NOT SET'
      },
      data: {
        email: email,
        license_key: license_key,
        customer_name: customer_name,
        tags_sent: 'trial-end,https://siteoverlay.24hr.pro'
      }
    });
  } catch (error) {
    console.error('Test trial-end error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router; 