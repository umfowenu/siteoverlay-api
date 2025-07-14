const express = require('express');
const router = express.Router();
const db = require('./db');
const mailer = require('./mailer');

// Stripe integration
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'SiteOverlay Pro API by eBiz360',
    timestamp: new Date().toISOString()
  });
});

// Generate unique license key
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    if (i > 0 && i % 4 === 0) result += '-';
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Core license validation endpoint - matches WordPress plugin expectations
router.post('/validate-license', async (req, res) => {
  try {
    const { licenseKey, siteUrl, pluginVersion, productCode, action } = req.body;

    console.log(`License ${action} request:`, { licenseKey, siteUrl, action });

    if (!licenseKey || !siteUrl || !action) {
      return res.json({
        success: false,
        message: 'Missing required parameters'
      });
    }

    // Handle different actions
    switch (action) {
      case 'check':
        return await handleLicenseCheck(req, res);
      case 'activate':
        return await handleLicenseActivation(req, res);
      case 'deactivate':
        return await handleLicenseDeactivation(req, res);
      default:
        return res.json({
          success: false,
          message: 'Invalid action'
        });
    }
  } catch (error) {
    console.error('License validation error:', error);
    res.json({
      success: false,
      message: 'Server error - please contact eBiz360 support'
    });
  }
});

// Handle license check
async function handleLicenseCheck(req, res) {
  const { licenseKey, siteUrl } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = result.rows[0];

    // Check if license is active
    if (license.status !== 'active' && license.status !== 'trial') {
      return res.json({
        success: false,
        message: 'License is not active'
      });
    }

    // Check trial expiration
    if (license.status === 'trial') {
      const trialEnd = new Date(license.created_at);
      trialEnd.setDate(trialEnd.getDate() + 14);

      if (new Date() > trialEnd) {
        await db.query('UPDATE licenses SET status = $1 WHERE license_key = $2', ['expired', licenseKey]);
        return res.json({
          success: false,
          message: 'Trial period has expired'
        });
      }
    }

    // Check site limit for professional licenses
    if (license.license_type === 'professional') {
      const installResult = await db.query(
        'SELECT COUNT(*) as site_count FROM plugin_installations WHERE license_key = $1 AND is_active = true',
        [licenseKey]
      );

      const siteCount = parseInt(installResult.rows[0].site_count);
      if (siteCount >= 5) {
        const siteExists = await db.query(
          'SELECT id FROM plugin_installations WHERE license_key = $1 AND site_url = $2',
          [licenseKey, siteUrl]
        );

        if (siteExists.rows.length === 0) {
          return res.json({
            success: false,
            message: 'Site limit exceeded. Professional license allows up to 5 sites.'
          });
        }
      }
    }

    // Update installation tracking
    await trackInstallation(licenseKey, siteUrl, req.body);

    res.json({
      success: true,
      message: 'License is valid',
      data: {
        license_type: license.license_type,
        status: license.status,
        expires: license.license_type === 'unlimited' ? 'Never' : null,
        company: 'eBiz360'
      }
    });

  } catch (error) {
    console.error('License check error:', error);
    res.json({
      success: false,
      message: 'Database error - please contact eBiz360 support'
    });
  }
}

// Handle license activation
async function handleLicenseActivation(req, res) {
  const { licenseKey, siteUrl } = req.body;

  try {
    const result = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = result.rows[0];

    // Check if license can be activated
    if (license.status === 'expired') {
      return res.json({
        success: false,
        message: 'License has expired'
      });
    }

    // Check site limit for professional licenses
    if (license.license_type === 'professional') {
      const installResult = await db.query(
        'SELECT COUNT(*) as site_count FROM plugin_installations WHERE license_key = $1 AND is_active = true',
        [licenseKey]
      );

      const siteCount = parseInt(installResult.rows[0].site_count);
      if (siteCount >= 5) {
        const siteExists = await db.query(
          'SELECT id FROM plugin_installations WHERE license_key = $1 AND site_url = $2',
          [licenseKey, siteUrl]
        );

        if (siteExists.rows.length === 0) {
          return res.json({
            success: false,
            message: 'Site limit exceeded. Professional license allows up to 5 sites.'
          });
        }
      }
    }

    // Track installation
    await trackInstallation(licenseKey, siteUrl, req.body);

    res.json({
      success: true,
      message: 'License activated successfully',
      data: {
        license_type: license.license_type,
        status: license.status,
        expires: license.license_type === 'unlimited' ? 'Never' : null,
        company: 'eBiz360'
      }
    });

  } catch (error) {
    console.error('License activation error:', error);
    res.json({
      success: false,
      message: 'Activation failed - please contact eBiz360 support'
    });
  }
}

// Handle license deactivation
async function handleLicenseDeactivation(req, res) {
  const { licenseKey, siteUrl } = req.body;

  try {
    // Mark installation as inactive
    await db.query(
      'UPDATE plugin_installations SET is_active = false WHERE license_key = $1 AND site_url = $2',
      [licenseKey, siteUrl]
    );

    res.json({
      success: true,
      message: 'License deactivated successfully'
    });

  } catch (error) {
    console.error('License deactivation error:', error);
    res.json({
      success: false,
      message: 'Deactivation failed - please contact eBiz360 support'
    });
  }
}

// Track plugin installation
async function trackInstallation(licenseKey, siteUrl, data) {
  try {
    await db.query(`
      INSERT INTO plugin_installations (
        license_key, site_url, site_title, wp_version, php_version, 
        plugin_version, theme_name, site_language, site_timezone, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (license_key, site_url) 
      DO UPDATE SET 
        last_seen = NOW(),
        activation_count = plugin_installations.activation_count + 1,
        is_active = true
    `, [
      licenseKey,
      siteUrl,
      data.siteTitle || null,
      data.wpVersion || null,
      data.phpVersion || null,
      data.pluginVersion || null,
      data.themeName || null,
      data.siteLanguage || null,
      data.siteTimezone || null
    ]);
  } catch (error) {
    console.error('Installation tracking error:', error);
  }
}

// Start trial endpoint
router.post('/start-trial', async (req, res) => {
  try {
    const { siteUrl, pluginVersion, productCode } = req.body;

    if (!siteUrl) {
      return res.json({
        success: false,
        message: 'Site URL is required'
      });
    }

    // Check if site already has a trial
    const existingTrial = await db.query(
      'SELECT id FROM plugin_installations pi JOIN licenses l ON pi.license_key = l.license_key WHERE pi.site_url = $1 AND l.status = $2',
      [siteUrl, 'trial']
    );

    if (existingTrial.rows.length > 0) {
      return res.json({
        success: false,
        message: 'Trial already started for this site'
      });
    }

    // Generate trial license
    const trialLicenseKey = 'TRIAL-' + generateLicenseKey();

    // Create trial license
    await db.query(`
      INSERT INTO licenses (license_key, license_type, status, customer_name, purchase_source)
      VALUES ($1, $2, $3, $4, $5)
    `, [trialLicenseKey, 'trial', 'trial', 'Trial User', 'trial_signup']);

    // Track installation
    await trackInstallation(trialLicenseKey, siteUrl, req.body);

    res.json({
      success: true,
      message: '14-day trial started successfully',
      data: {
        license_key: trialLicenseKey,
        license_type: 'trial',
        status: 'trial',
        expires: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        company: 'eBiz360'
      }
    });

  } catch (error) {
    console.error('Trial start error:', error);
    res.json({
      success: false,
      message: 'Failed to start trial - please contact eBiz360 support'
    });
  }
});

// Email collection endpoint
router.post('/collect-email', async (req, res) => {
  try {
    const { email, licenseKey, siteUrl, source } = req.body;

    if (!email) {
      return res.json({
        success: false,
        message: 'Email is required'
      });
    }

    // Store email
    await db.query(`
      INSERT INTO email_collection (email, license_key, site_url, collection_source)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email, license_key) DO NOTHING
    `, [email, licenseKey || null, siteUrl || null, source || 'plugin_signup']);

    res.json({
      success: true,
      message: 'Email collected successfully'
    });

  } catch (error) {
    console.error('Email collection error:', error);
    res.json({
      success: false,
      message: 'Failed to collect email'
    });
  }
});

// Dynamic content endpoint
router.get('/dynamic-content', async (req, res) => {
  try {
    const { license_type, plugin_version } = req.query;

    let query = 'SELECT content_key, content_value, content_type FROM dynamic_content WHERE is_active = true';
    let params = [];

    if (license_type && license_type !== 'all') {
      query += ' AND (license_type = $1 OR license_type = $2)';
      params.push(license_type, 'all');
    } else {
      query += ' AND license_type = $1';
      params.push('all');
    }

    const result = await db.query(query, params);

    const content = {};
    result.rows.forEach(row => {
      content[row.content_key] = {
        value: row.content_value,
        type: row.content_type
      };
    });

    res.json({
      success: true,
      content: content,
      company: 'eBiz360'
    });

  } catch (error) {
    console.error('Dynamic content error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch content'
    });
  }
});

// Stripe webhook endpoint
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Received Stripe event:', event.type);

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;

      // Get customer details
      const customer = await stripe.customers.retrieve(paymentIntent.customer);

      // Determine license type based on amount
      let licenseType = 'professional';
      if (paymentIntent.amount >= 29700) { // $297.00 in cents
        licenseType = 'unlimited';
      }

      // Generate license key
      const licenseKey = generateLicenseKey();

      // Create license record
      await db.query(`
        INSERT INTO licenses (
          license_key, license_type, status, customer_name, 
          purchase_source, total_revenue, mrr_contribution
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        licenseKey,
        licenseType,
        'active',
        customer.name || customer.email,
        'stripe_payment',
        paymentIntent.amount / 100,
        licenseType === 'professional' ? 35 : 0
      ]);

      // Store customer email
      await db.query(`
        INSERT INTO email_collection (
          email, license_key, collection_source, license_type, conversion_status
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email, license_key) 
        DO UPDATE SET conversion_status = $5
      `, [customer.email, licenseKey, 'purchase', licenseType, 'customer']);

      // Send license email
      await mailer.sendLicenseEmail(
        customer.email,
        customer.name || 'Valued Customer',
        licenseKey,
        licenseType.charAt(0).toUpperCase() + licenseType.slice(1)
      );

      console.log('License generated and email sent:', licenseKey);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Cron endpoint for trial monitoring
router.get('/cron/monitor-trials', async (req, res) => {
  try {
    await mailer.monitorTrials();
    res.json({ 
      success: true, 
      message: 'Trial monitoring completed',
      service: 'eBiz360 SiteOverlay Pro'
    });
  } catch (error) {
    console.error('Trial monitoring error:', error);
    res.json({ 
      success: false, 
      message: 'Trial monitoring failed' 
    });
  }
});

// Installation tracking endpoint
router.post('/track-install', async (req, res) => {
  try {
    const installData = req.body;
    await trackInstallation(installData.licenseKey, installData.siteUrl, installData);

    res.json({
      success: true,
      message: 'Installation tracked successfully'
    });
  } catch (error) {
    console.error('Installation tracking error:', error);
    res.json({
      success: false,
      message: 'Failed to track installation'
    });
  }
});

// Usage analytics endpoint
router.post('/track-usage', async (req, res) => {
  try {
    const { licenseKey, siteUrl, overlayCount, totalViews } = req.body;

    await db.query(`
      UPDATE plugin_installations 
      SET overlay_count = $1, total_views = $2, last_overlay_created = NOW()
      WHERE license_key = $3 AND site_url = $4
    `, [overlayCount || 0, totalViews || 0, licenseKey, siteUrl]);

    res.json({
      success: true,
      message: 'Usage tracked successfully'
    });
  } catch (error) {
    console.error('Usage tracking error:', error);
    res.json({
      success: false,
      message: 'Failed to track usage'
    });
  }
});

// Database migration endpoint
router.get('/migrate', async (req, res) => {
  // Security check - only allow from admin or specific IP
  const adminSecret = req.query.secret || req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'siteoverlay-setup-2025') {
    return res.status(403).json({ 
      error: 'Unauthorized - Admin secret required',
      hint: 'Add ?secret=siteoverlay-setup-2025 to URL'
    });
  }

  try {
    console.log('Starting database migration...');

    // Create all tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL UNIQUE,
        license_type VARCHAR(50) NOT NULL DEFAULT 'trial',
        status VARCHAR(20) NOT NULL DEFAULT 'trial',
        xagio_affiliate_url VARCHAR(500),
        dynamic_content_version INT DEFAULT 1,
        last_content_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        customer_name VARCHAR(255),
        customer_company VARCHAR(255),
        purchase_source VARCHAR(100) DEFAULT 'direct',
        referral_code VARCHAR(50),
        total_revenue DECIMAL(10,2) DEFAULT 0.00,
        mrr_contribution DECIMAL(10,2) DEFAULT 0.00,
        ltv_estimate DECIMAL(10,2) DEFAULT 0.00,
        churn_risk_score INT DEFAULT 0,
        last_email_sent TIMESTAMP,
        email_opens INT DEFAULT 0,
        email_clicks INT DEFAULT 0,
        support_tickets INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS plugin_installations (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        site_url VARCHAR(500) NOT NULL,
        site_title VARCHAR(255),
        wp_version VARCHAR(50),
        php_version VARCHAR(50),
        plugin_version VARCHAR(50),
        theme_name VARCHAR(255),
        installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        activation_count INT DEFAULT 1,
        is_active BOOLEAN DEFAULT TRUE,
        site_language VARCHAR(10),
        site_timezone VARCHAR(50),
        estimated_traffic VARCHAR(50),
        site_category VARCHAR(100),
        overlay_count INT DEFAULT 0,
        total_views INT DEFAULT 0,
        last_overlay_created TIMESTAMP,
        UNIQUE(license_key, site_url)
      );

      CREATE TABLE IF NOT EXISTS dynamic_content (
        id SERIAL PRIMARY KEY,
        content_key VARCHAR(100) NOT NULL UNIQUE,
        content_value TEXT,
        content_type VARCHAR(20) DEFAULT 'text',
        license_type VARCHAR(50) DEFAULT 'all',
        plugin_version_min VARCHAR(50),
        plugin_version_max VARCHAR(50),
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS email_collection (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        license_key VARCHAR(255),
        site_url VARCHAR(500),
        collection_source VARCHAR(50) DEFAULT 'plugin_signup',
        license_type VARCHAR(50),
        sent_to_autoresponder BOOLEAN DEFAULT FALSE,
        autoresponder_id VARCHAR(100),
        tags JSON,
        collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_email_sent TIMESTAMP,
        conversion_status VARCHAR(50) DEFAULT 'lead',
        UNIQUE(email, license_key)
      );

      CREATE TABLE IF NOT EXISTS customer_analytics (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL UNIQUE,
        total_installations INT DEFAULT 0,
        active_installations INT DEFAULT 0,
        total_overlays_created INT DEFAULT 0,
        total_overlay_views INT DEFAULT 0,
        days_since_last_login INT DEFAULT 0,
        feature_usage_score INT DEFAULT 0,
        support_satisfaction_score INT DEFAULT 0,
        months_active INT DEFAULT 0,
        upgrade_probability DECIMAL(3,2) DEFAULT 0.00,
        churn_probability DECIMAL(3,2) DEFAULT 0.00,
        first_install_date DATE,
        last_activity_date DATE,
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Pre-populate dynamic content
    await db.query(`
      INSERT INTO dynamic_content (content_key, content_value, content_type)
      VALUES
        ('xagio_affiliate_url', 'https://xagio.com/?ref=PENDING', 'url'),
        ('upgrade_message', 'Limited Time: Save $100 on Unlimited License!', 'text'),
        ('support_url', 'https://siteoverlaypro.com/support', 'url'),
        ('training_url', 'https://siteoverlaypro.com/training', 'url')
      ON CONFLICT (content_key) DO NOTHING;
    `);

    console.log('Migration completed successfully!');

    res.json({
      success: true,
      message: 'Database migration completed successfully!',
      tables_created: [
        'licenses',
        'plugin_installations', 
        'dynamic_content',
        'email_collection',
        'customer_analytics'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
});

// Debug endpoint to check database status
router.get('/debug', async (req, res) => {
  // ... existing debug code ...
});

// ADD THE FIX ENDPOINT HERE ↓
// Database fix endpoint
router.get('/fix-db', async (req, res) => {
  const adminSecret = req.query.secret || req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'siteoverlay-setup-2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // Fix 1: Add missing license_type column
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS license_type VARCHAR(50) DEFAULT 'trial';
    `);

    // Fix 2: Update all existing records
    await db.query(`
      UPDATE licenses 
      SET license_type = 'trial' 
      WHERE license_type IS NULL;
    `);

    res.json({
      success: true,
      message: 'Database schema fixed!',
      fixes_applied: [
        'Added license_type column',
        'Updated existing records'
      ]
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Trial debug endpoint
router.get('/debug-trial', async (req, res) => {
  const adminSecret = req.query.secret || req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'siteoverlay-setup-2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const siteUrl = 'https://ebiz360.ca';
    const debug = {};

    // Test 1: Check the problematic JOIN query with specific column references
    try {
      const existingTrial = await db.query(
        'SELECT pi.id FROM plugin_installations pi JOIN licenses l ON pi.license_key = l.license_key WHERE pi.site_url = $1 AND l.status = $2',
        [siteUrl, 'trial']
      );
      debug.join_query_fixed = {
        success: true,
        rows_found: existingTrial.rows.length
      };
    } catch (err) {
      debug.join_query_fixed = {
        success: false,
        error: err.message
      };
    }

    // Test 2: Try creating a test trial license
    try {
      const testKey = 'TRIAL-TEST-' + Math.random().toString(36).substr(2, 9);
      
      // Insert license
      const licenseResult = await db.query(`
        INSERT INTO licenses (license_key, license_type, status, customer_name, purchase_source)
        VALUES ($1, $2, $3, $4, $5) RETURNING id
      `, [testKey, 'trial', 'trial', 'Test User', 'trial_signup']);
      
      debug.license_insert = {
        success: true,
        license_id: licenseResult.rows[0].id,
        license_key: testKey
      };

      // Test trackInstallation function
      try {
        await db.query(`
          INSERT INTO plugin_installations (
            license_key, site_url, site_title, wp_version, plugin_version, last_seen
          ) VALUES ($1, $2, $3, $4, $5, NOW())
          ON CONFLICT (license_key, site_url) 
          DO UPDATE SET 
            last_seen = NOW(),
            activation_count = plugin_installations.activation_count + 1,
            is_active = true
        `, [testKey, siteUrl, 'Test Site', '6.8.1', '2.0.0']);
        
        debug.installation_insert = { success: true };
      } catch (err) {
        debug.installation_insert = { success: false, error: err.message };
      }

      // Clean up test records
      await db.query('DELETE FROM plugin_installations WHERE license_key = $1', [testKey]);
      await db.query('DELETE FROM licenses WHERE license_key = $1', [testKey]);
      
    } catch (err) {
      debug.license_insert = { success: false, error: err.message };
    }

    res.json({
      success: true,
      debug: debug,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;