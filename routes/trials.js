// Trial management routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateLicenseKey } = require('../utils/license-mappings');
const { sendToPabbly } = require('../utils/pabbly-utils');

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
          sites_remaining: Math.max(0, 5 - 0)
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
      'email_trial_request', 5, true, true
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

    // Send to Pabbly Connect
    const pabblySuccess = await sendToPabbly(email, trialLicenseKey, 'trial', {
      customer_name: full_name,
      website_url: siteUrl,
      trial_expires: trialExpires.toISOString(),
      site_limit: 5
    });

    // Store in email collection table
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type, customer_name,
        website_url, sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      email, trialLicenseKey, 'trial_request', 'trial', full_name,
      siteUrl || '', pabblySuccess ? 'sent' : 'pending'
    ]);

    res.json({
      success: true,
      message: 'Trial license created successfully',
      data: {
        license_key: trialLicenseKey,
        trial_expires: trialExpires.toISOString(),
        sites_remaining: 5,
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

module.exports = router; 