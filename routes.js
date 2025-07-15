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

// Database setup endpoint
router.get('/setup-database', async (req, res) => {
  try {
    console.log('Setting up database tables...');
    
    // Create licenses table
    await db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) UNIQUE NOT NULL,
        license_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        customer_email VARCHAR(255),
        customer_name VARCHAR(255),
        purchase_source VARCHAR(100),
        trial_expires TIMESTAMP,
        kill_switch_enabled BOOLEAN DEFAULT true,
        resale_monitoring BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create email_collection table
    await db.query(`
      CREATE TABLE IF NOT EXISTS email_collection (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        license_key VARCHAR(255),
        collection_source VARCHAR(100),
        license_type VARCHAR(50),
        customer_name VARCHAR(255),
        website_url VARCHAR(500),
        sent_to_autoresponder BOOLEAN DEFAULT false,
        collected_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create plugin_installations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS plugin_installations (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        site_url VARCHAR(500) NOT NULL,
        site_title VARCHAR(255),
        wp_version VARCHAR(50),
        php_version VARCHAR(50),
        plugin_version VARCHAR(50),
        theme_name VARCHAR(255),
        site_language VARCHAR(50),
        site_timezone VARCHAR(100),
        last_seen TIMESTAMP DEFAULT NOW(),
        activation_count INTEGER DEFAULT 1,
        is_active BOOLEAN DEFAULT true,
        UNIQUE(license_key, site_url)
      )
    `);
    
    console.log('✅ Database tables created successfully!');
    
    res.json({
      success: true,
      message: 'Database tables created successfully!',
      tables: ['licenses', 'email_collection', 'plugin_installations']
    });
    
  } catch (error) {
    console.error('❌ Database setup error:', error);
    res.json({
      success: false,
      message: 'Database setup failed: ' + error.message,
      error: error.message
    });
  }
});

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
      'SELECT pi.id FROM plugin_installations pi JOIN licenses l ON pi.license_key = l.license_key WHERE pi.site_url = $1 AND l.status = $2',
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

// Enhanced email-based trial request system with detailed logging
router.post('/request-trial', async (req, res) => {
  try {
    console.log('🚀 Trial request received:', req.body);
    
    const { 
      full_name, email, website, siteUrl, siteTitle, 
      wpVersion, pluginVersion, userAgent, requestSource 
    } = req.body;

    console.log('📝 Extracted data:', { full_name, email, siteUrl });

    // Basic validation
    if (!full_name || !email) {
      console.log('❌ Validation failed: Missing full_name or email');
      return res.json({
        success: false,
        message: 'Full name and email address are required'
      });
    }

    if (!siteUrl) {
      console.log('❌ Validation failed: Missing siteUrl');
      return res.json({
        success: false,
        message: 'Site URL is required'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.log('❌ Validation failed: Invalid email format');
      return res.json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    console.log('✅ Basic validation passed');

    // Check for existing trial
    console.log('🔍 Checking for existing trial...');
    try {
      const existingTrial = await db.query(
        'SELECT license_key, created_at FROM licenses WHERE customer_email = $1 AND license_type = $2 AND status IN ($3, $4)',
        [email, 'trial', 'trial', 'active']
      );

      console.log('📊 Existing trial query result:', existingTrial.rows.length, 'rows');

      if (existingTrial.rows.length > 0) {
        const existingLicense = existingTrial.rows[0];
        const createdDate = new Date(existingLicense.created_at).toLocaleDateString();
        
        console.log('⚠️ Existing trial found:', existingLicense.license_key);
        
        return res.json({
          success: false,
          message: `A trial license was already sent to this email address on ${createdDate}. Please check your email (including spam folder) for your license key.`,
          // Remove: existing_license: existingLicense.license_key
        });
      }
    } catch (dbError) {
      console.error('❌ Database query error (existing trial check):', dbError);
      return res.json({
        success: false,
        message: 'Database error during existing trial check: ' + dbError.message
      });
    }

    // Generate trial license
    console.log('🎲 Generating trial license...');
    const trialLicenseKey = 'TRIAL-' + generateLicenseKey();
    const trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    console.log('🔑 Generated license:', trialLicenseKey);

    // Create trial license
    console.log('💾 Inserting trial license into database...');
    try {
      await db.query(`
        INSERT INTO licenses (
          license_key, license_type, status, customer_email, customer_name, 
          purchase_source, trial_expires, kill_switch_enabled, resale_monitoring,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `, [
        trialLicenseKey, 
        'trial', 
        'trial', 
        email,
        full_name,
        'email_trial_request',
        trialExpires,
        true,
        true
      ]);

      console.log('✅ License inserted successfully');
    } catch (dbError) {
      console.error('❌ Database insert error (licenses):', dbError);
      return res.json({
        success: false,
        message: 'Database error during license creation: ' + dbError.message
      });
    }

    // Store email collection record
    console.log('📧 Storing email collection record...');
    try {
      await db.query(`
        INSERT INTO email_collection (
          email, license_key, collection_source, license_type, 
          customer_name, website_url, sent_to_autoresponder, collected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        email, 
        trialLicenseKey, 
        'trial_request', 
        'trial',
        full_name,
        website,
        false
      ]);

      console.log('✅ Email collection record stored');
    } catch (dbError) {
      console.error('❌ Database insert error (email_collection):', dbError);
      // Don't fail the whole request for this
      console.log('⚠️ Continuing despite email collection error...');
    }

    // Send to Pabbly Connect
    console.log('🔗 Attempting Pabbly webhook...');
    let pabblySuccess = false;
    try {
      pabblySuccess = await sendToPabbly(email, trialLicenseKey, 'trial', {
        customer_name: full_name,
        website_url: website,
        site_url: siteUrl,
        trial_expires: trialExpires.toISOString(),
        license_key: trialLicenseKey
      });
      console.log('📨 Pabbly webhook result:', pabblySuccess);
    } catch (pabblyError) {
      console.error('❌ Pabbly webhook error:', pabblyError);
      // Don't fail the whole request for this
      console.log('⚠️ Continuing despite Pabbly error...');
    }

    console.log('✅ Trial license created successfully:', trialLicenseKey, 'for:', email);

    res.json({
      success: true,
      message: `Trial license created successfully! Your 14-day trial license has been sent to ${email}.`,
      data: {
        email: email,
        customer_name: full_name,
        license_key: trialLicenseKey,
        expires: trialExpires.toISOString(),
        pabbly_status: pabblySuccess ? 'email_sent' : 'email_pending'
      }
    });

  } catch (error) {
    console.error('❌ Unexpected trial request error:', error);
    res.json({
      success: false,
      message: 'Unexpected error: ' + error.message
    });
  }
});

// Enhanced email collection endpoint
router.post('/collect-email', async (req, res) => {
  try {
    const { email, source, licenseKey, siteUrl, tags } = req.body;

    if (!email) {
      return res.json({
        success: false,
        message: 'Email is required'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.json({
        success: false,
        message: 'Please enter a valid email address'
      });
    }

    // Store email collection
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, site_url, collection_source, tags, collected_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (email, license_key) 
      DO UPDATE SET collection_source = $4, tags = $5, collected_at = NOW()
    `, [
      email, 
      licenseKey || null, 
      siteUrl || null, 
      source || 'newsletter_signup',
      JSON.stringify(tags || ['newsletter'])
    ]);

    // Send to Pabbly for newsletter signup
    const pabblySuccess = await sendToPabbly(email, licenseKey || 'newsletter', 'newsletter', {
      source: source || 'newsletter_signup',
      site_url: siteUrl
    });

    res.json({
      success: true,
      message: 'Email collected successfully! Check your inbox for confirmation.',
      pabbly_status: pabblySuccess ? 'sent' : 'logged'
    });

  } catch (error) {
    console.error('Email collection error:', error);
    res.json({
      success: false,
      message: 'Failed to collect email'
    });
  }
});

// Pabbly Connect integration function
async function sendToPabbly(email, licenseKey, licenseType, metadata = {}) {
  try {
    // Prepare data for Pabbly Connect webhook
    const pabblyData = {
      // Core data
      email: email,
      license_key: licenseKey,
      license_type: licenseType,
      
      // Customer context
      customer_name: metadata.customer_name || '',
      website_url: metadata.website_url || '',
      site_url: metadata.site_url || '',
      
      // Timing data
      signup_date: new Date().toISOString(),
      trial_expires: metadata.trial_expires || '',
      
      // AWeber mapping fields (Pabbly will handle these)
      aweber_list: 'siteoverlay-pro',
      aweber_tags: [licenseType, 'siteoverlay-pro', 'wordpress-plugin'].join(','),
      
      // Email template variables
      product_name: 'SiteOverlay Pro',
      trial_duration: '14 days',
      support_email: 'support@siteoverlaypro.com',
      login_instructions: 'Go to WordPress Admin → Settings → SiteOverlay License'
    };

    console.log('Sending to Pabbly Connect:', { email, licenseKey, licenseType });

    // Send to Pabbly Connect webhook
    if (process.env.PABBLY_WEBHOOK_URL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pabblyData)
      });

      if (response.ok) {
        console.log('✅ Pabbly Connect successful for:', email);
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ Pabbly webhook failed:', response.status, errorText);
        return false;
      }
    } else {
      console.log('⚠️  No Pabbly webhook URL configured - data stored locally only');
      return true; // System works without Pabbly initially
    }

  } catch (error) {
    console.error('❌ Pabbly integration error:', error);
    return false;
  }
}

// Fix database structure - add missing created_at column
router.get('/fix-database', async (req, res) => {
  try {
    console.log('Fixing database structure...');
    
    // Add missing created_at column to licenses table
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
    `);
    
    // Update existing records without created_at
    await db.query(`
      UPDATE licenses 
      SET created_at = NOW() 
      WHERE created_at IS NULL
    `);
    
    console.log('✅ Database structure fixed!');
    
    res.json({
      success: true,
      message: 'Database structure fixed successfully!'
    });
    
  } catch (error) {
    console.error('❌ Database fix error:', error);
    res.json({
      success: false,
      message: 'Database fix failed: ' + error.message
    });
  }
});

module.exports = router;