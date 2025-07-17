const express = require('express');
const router = express.Router();
const db = require('./db');
const mailer = require('./mailer');
const crypto = require('crypto');

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

// Helper function to get site limit based on license plan
function getSiteLimit(license) {
  // Check if site_limit is explicitly set
  if (license.site_limit !== null && license.site_limit !== undefined) {
    return parseInt(license.site_limit);
  }
  
  // Default limits based on license type
  const limits = {
    '5sites': 5,
    'professional': 5,
    'trial': 5,
    'annual_unlimited': -1,
    'lifetime_unlimited': -1,
    'unlimited': -1
  };
  
  return limits[license.license_type] || 5;
}

// Helper function to generate site signature
function generateSiteSignature(siteData) {
  const domain = siteData.site_domain || '';
  const path = siteData.site_path || '';
  const abspath = siteData.abspath || '';
  
  return crypto.createHash('md5').update(domain + path + abspath).digest('hex');
}

// Database setup endpoint - ENHANCED with site_usage table
router.get('/setup-database', async (req, res) => {
  try {
    console.log('Setting up database tables...');
    
    // Create licenses table with site_limit column
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
        site_limit INTEGER DEFAULT 5,
        kill_switch_enabled BOOLEAN DEFAULT true,
        resale_monitoring BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add site_limit column to existing licenses table (if it doesn't exist)
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS site_limit INTEGER DEFAULT 5
    `);
    
    // Create site_usage table for tracking site usage per license
    await db.query(`
      CREATE TABLE IF NOT EXISTS site_usage (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        site_signature VARCHAR(255) NOT NULL,
        site_domain VARCHAR(255) NOT NULL,
        site_url TEXT NOT NULL,
        site_data JSONB,
        status VARCHAR(50) DEFAULT 'active',
        registered_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        deactivated_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(license_key, site_signature)
      )
    `);
    
    // Create indexes for better performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_site_usage_license ON site_usage(license_key)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_site_usage_status ON site_usage(license_key, status)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_site_usage_domain ON site_usage(site_domain)
    `);
    
    // Update existing licenses with proper site limits based on license type
    await db.query(`
      UPDATE licenses 
      SET site_limit = CASE 
        WHEN license_type IN ('professional', '5sites') THEN 5
        WHEN license_type IN ('annual_unlimited', 'lifetime_unlimited', 'unlimited') THEN -1
        WHEN license_type = 'trial' THEN 5
        ELSE 5
      END
      WHERE site_limit IS NULL
    `);
    
    // Create email_collection table (if not exists)
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
    
    // Create plugin_installations table (if not exists)
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
      message: 'Database tables created successfully with site usage tracking!',
      tables: ['licenses', 'site_usage', 'email_collection', 'plugin_installations'],
      features: ['site_limit_enforcement', 'site_usage_tracking', 'performance_indexes']
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

// Core license validation endpoint - ENHANCED with site usage tracking
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

// ENHANCED: Handle license check with site usage enforcement
async function handleLicenseCheck(req, res) {
  const { licenseKey, siteUrl, siteTitle, wpVersion, pluginVersion } = req.body;

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

    // ENHANCED: Check site limits and register site usage
    const siteLimit = getSiteLimit(license);
    
    if (siteLimit !== -1) { // Only check limits if not unlimited
      // Prepare site data
      const siteData = {
        site_url: siteUrl,
        site_domain: new URL(siteUrl).hostname,
        site_title: siteTitle,
        wp_version: wpVersion,
        plugin_version: pluginVersion,
        site_signature: crypto.createHash('md5').update(siteUrl + (process.env.SITE_SALT || 'default')).digest('hex')
      };
      
      // Check if this site is already registered
      const existingSite = await db.query(
        'SELECT * FROM site_usage WHERE license_key = $1 AND site_signature = $2',
        [licenseKey, siteData.site_signature]
      );
      
      if (existingSite.rows.length === 0) {
        // New site - check if we're at the limit
        const currentUsage = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        
        const currentCount = parseInt(currentUsage.rows[0].count);
        
        if (currentCount >= siteLimit) {
          return res.json({
            success: false,
            message: `Site limit exceeded. Your ${license.license_type} license allows ${siteLimit} sites. Currently using ${currentCount} sites.`,
            error_code: 'SITE_LIMIT_EXCEEDED',
            current_usage: currentCount,
            site_limit: siteLimit,
            upgrade_url: 'https://siteoverlay.24hr.pro/'
          });
        }
        
        // Register the new site
        await db.query(
          `INSERT INTO site_usage (
            license_key, site_signature, site_domain, site_url, 
            site_data, status, registered_at, last_seen
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
          [
            licenseKey,
            siteData.site_signature,
            siteData.site_domain,
            siteData.site_url,
            JSON.stringify(siteData),
            'active'
          ]
        );
      } else {
        // Update existing site
        await db.query(
          `UPDATE site_usage 
           SET last_seen = NOW(), 
               site_data = $3,
               status = 'active'
           WHERE license_key = $1 AND site_signature = $2`,
          [licenseKey, siteData.site_signature, JSON.stringify(siteData)]
        );
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
        site_limit: siteLimit,
        unlimited: siteLimit === -1,
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
    const siteLimit = getSiteLimit(license);
    
    if (siteLimit !== -1) {
      const installResult = await db.query(
        'SELECT COUNT(*) as site_count FROM site_usage WHERE license_key = $1 AND status = $2',
        [licenseKey, 'active']
      );

      const siteCount = parseInt(installResult.rows[0].site_count);
      if (siteCount >= siteLimit) {
        const siteSignature = crypto.createHash('md5').update(siteUrl + (process.env.SITE_SALT || 'default')).digest('hex');
        const siteExists = await db.query(
          'SELECT id FROM site_usage WHERE license_key = $1 AND site_signature = $2',
          [licenseKey, siteSignature]
        );

        if (siteExists.rows.length === 0) {
          return res.json({
            success: false,
            message: `Site limit exceeded. ${license.license_type} license allows up to ${siteLimit} sites.`,
            error_code: 'SITE_LIMIT_EXCEEDED'
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
        site_limit: siteLimit,
        unlimited: siteLimit === -1,
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

    // Mark site usage as inactive
    const siteSignature = crypto.createHash('md5').update(siteUrl + (process.env.SITE_SALT || 'default')).digest('hex');
    await db.query(
      'UPDATE site_usage SET status = $3, deactivated_at = NOW() WHERE license_key = $1 AND site_signature = $2',
      [licenseKey, siteSignature, 'inactive']
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
      INSERT INTO licenses (license_key, license_type, status, customer_name, purchase_source, site_limit)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [trialLicenseKey, 'trial', 'trial', 'Trial User', 'trial_signup', 5]);

    // Track installation
    await trackInstallation(trialLicenseKey, siteUrl, req.body);

    res.json({
      success: true,
      message: '14-day trial started successfully',
      data: {
        license_key: trialLicenseKey,
        license_type: 'trial',
        status: 'trial',
        site_limit: 5,
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
          message: `A trial license was already sent to this email address on ${createdDate}. Please check your email (including spam folder) for your license key.`
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
          purchase_source, trial_expires, site_limit, kill_switch_enabled, resale_monitoring,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `, [
        trialLicenseKey, 
        'trial', 
        'trial', 
        email,
        full_name,
        'email_trial_request',
        trialExpires,
        5, // Trial gets 5 sites
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

// NEW SITE USAGE TRACKING ENDPOINTS

// POST /api/register-site-usage - Register site usage for a license
router.post('/register-site-usage', async (req, res) => {
  try {
    const { license_key, site_data, action } = req.body;
    
    if (!license_key || !site_data) {
      return res.json({
        success: false,
        message: 'Missing required parameters'
      });
    }
    
    console.log(`Site registration request for license: ${license_key}`);
    
    // Get license information
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [license_key]
    );
    
    if (licenseResult.rows.length === 0) {
      return res.json({
        success: false,
        message: 'License not found'
      });
    }
    
    const license = licenseResult.rows[0];
    const siteLimit = getSiteLimit(license);
    
    // Generate site signature
    const siteSignature = site_data.site_signature || generateSiteSignature(site_data);
    
    // Check if site is already registered
    const existingSite = await db.query(
      'SELECT * FROM site_usage WHERE license_key = $1 AND site_signature = $2',
      [license_key, siteSignature]
    );
    
    if (existingSite.rows.length > 0) {
      // Update existing site registration
      await db.query(
        `UPDATE site_usage 
         SET last_seen = NOW(), 
             site_data = $3,
             status = 'active'
         WHERE license_key = $1 AND site_signature = $2`,
        [license_key, siteSignature, JSON.stringify(site_data)]
      );
      
      return res.json({
        success: true,
        message: 'Site registration updated'
      });
    }
    
    // Check site limit (unlimited = -1)
    if (siteLimit !== -1) {
      const currentUsage = await db.query(
        'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
        [license_key, 'active']
      );
      
      const currentCount = parseInt(currentUsage.rows[0].count);
      
      if (currentCount >= siteLimit) {
        return res.json({
          success: false,
          message: `Site limit exceeded. License allows ${siteLimit} sites, currently using ${currentCount}.`,
          error_code: 'SITE_LIMIT_EXCEEDED',
          current_usage: currentCount,
          site_limit: siteLimit
        });
      }
    }
    
    // Register new site
    await db.query(
      `INSERT INTO site_usage (
        license_key, site_signature, site_domain, site_url, 
        site_data, status, registered_at, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      [
        license_key,
        siteSignature,
        site_data.site_domain || '',
        site_data.site_url || '',
        JSON.stringify(site_data),
        'active'
      ]
    );
    
    console.log(`✅ Site registered successfully for license: ${license_key}`);
    
    res.json({
      success: true,
      message: 'Site registered successfully',
      site_signature: siteSignature
    });
    
  } catch (error) {
    console.error('Site registration error:', error);
    res.json({
      success: false,
      message: 'Site registration failed: ' + error.message
    });
  }
});

// POST /api/unregister-site-usage - Unregister site usage
router.post('/unregister-site-usage', async (req, res) => {
  try {
    const { license_key, site_data } = req.body;
    
    if (!license_key || !site_data) {
      return res.json({
        success: false,
        message: 'Missing required parameters'
      });
    }
    
    const siteSignature = site_data.site_signature || generateSiteSignature(site_data);
    
    // Mark site as inactive
    await db.query(
      `UPDATE site_usage 
       SET status = 'inactive', 
           deactivated_at = NOW() 
       WHERE license_key = $1 AND site_signature = $2`,
      [license_key, siteSignature]
    );
    
    console.log(`✅ Site unregistered for license: ${license_key}`);
    
    res.json({
      success: true,
      message: 'Site unregistered successfully'
    });
    
  } catch (error) {
    console.error('Site unregistration error:', error);
    res.json({
      success: false,
      message: 'Site unregistration failed: ' + error.message
    });
  }
});

// GET /api/license-usage/:license_key - Get site usage for a license
router.get('/license-usage/:license_key', async (req, res) => {
  try {
    const { license_key } = req.params;
    
    // Get license information
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [license_key]
    );
    
    if (licenseResult.rows.length === 0) {
      return res.json({
        success: false,
        message: 'License not found'
      });
    }
    
    const license = licenseResult.rows[0];
    const siteLimit = getSiteLimit(license);
    
    // Get active sites
    const activeSites = await db.query(
      `SELECT * FROM site_usage 
       WHERE license_key = $1 AND status = 'active' 
       ORDER BY registered_at DESC`,
      [license_key]
    );
    
    const sites = activeSites.rows.map(site => ({
      domain: site.site_domain,
      url: site.site_url,
      registered_at: site.registered_at,
      last_seen: site.last_seen,
      signature: site.site_signature,
      site_data: site.site_data
    }));
    
    res.json({
      success: true,
      data: {
        license_key: license_key,
        license_type: license.license_type,
        sites_used: activeSites.rows.length,
        site_limit: siteLimit,
        unlimited: siteLimit === -1,
        registered_sites: sites.map(s => s.signature),
        site_details: sites
      }
    });
    
  } catch (error) {
    console.error('Get license usage error:', error);
    res.json({
      success: false,
      message: 'Failed to get usage data: ' + error.message
    });
  }
});

// ADMIN API ENDPOINTS

// POST /api/admin/remove-site - Remove specific site from license
router.post('/admin/remove-site', async (req, res) => {
  try {
    const { license_key, site_signature, admin_key } = req.body;
    
    // TODO: Add admin authentication
    // if (!admin_key || admin_key !== process.env.ADMIN_API_KEY) {
    //   return res.json({ success: false, message: 'Unauthorized' });
    // }
    
    await db.query(
      `UPDATE site_usage 
       SET status = 'removed_by_admin', 
           deactivated_at = NOW() 
       WHERE license_key = $1 AND site_signature = $2`,
      [license_key, site_signature]
    );
    
    res.json({
      success: true,
      message: 'Site removed successfully'
    });
    
  } catch (error) {
    console.error('Admin remove site error:', error);
    res.json({
      success: false,
      message: 'Failed to remove site: ' + error.message
    });
  }
});

// POST /api/admin/reset-site-usage - Reset all site usage for a license
router.post('/admin/reset-site-usage', async (req, res) => {
  try {
    const { license_key, admin_key } = req.body;
    
    // TODO: Add admin authentication
    // if (!admin_key || admin_key !== process.env.ADMIN_API_KEY) {
    //   return res.json({ success: false, message: 'Unauthorized' });
    // }
    
    await db.query(
      `UPDATE site_usage 
       SET status = 'reset_by_admin', 
           deactivated_at = NOW() 
       WHERE license_key = $1 AND status = 'active'`,
      [license_key]
    );
    
    res.json({
      success: true,
      message: 'Site usage reset successfully'
    });
    
  } catch (error) {
    console.error('Admin reset site usage error:', error);
    res.json({
      success: false,
      message: 'Failed to reset site usage: ' + error.message
    });
  }
});

// POST /api/admin/update-license - Update license properties
router.post('/admin/update-license', async (req, res) => {
  try {
    const { license_key, updates, admin_key } = req.body;
    
    // TODO: Add admin authentication
    // if (!admin_key || admin_key !== process.env.ADMIN_API_KEY) {
    //   return res.json({ success: false, message: 'Unauthorized' });
    // }
    
    // Build dynamic update query based on provided updates
    const allowedFields = ['site_limit', 'status', 'license_type', 'customer_name', 'customer_email'];
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 2;
    
    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramIndex}`);
        updateValues.push(value);
        paramIndex++;
      }
    }
    
    if (updateFields.length === 0) {
      return res.json({
        success: false,
        message: 'No valid fields to update'
      });
    }
    
    const query = `UPDATE licenses SET ${updateFields.join(', ')} WHERE license_key = $1`;
    await db.query(query, [license_key, ...updateValues]);
    
    res.json({
      success: true,
      message: 'License updated successfully',
      updated_fields: Object.keys(updates)
    });
    
  } catch (error) {
    console.error('Admin update license error:', error);
    res.json({
      success: false,
      message: 'Failed to update license: ' + error.message
    });
  }
});

// GET /api/admin/licenses - Get all licenses with usage data
router.get('/admin/licenses', async (req, res) => {
  try {
    // Get all licenses
    const licenses = await db.query(`
      SELECT l.*, 
             COUNT(su.id) as active_sites,
             MAX(su.last_seen) as last_site_activity
      FROM licenses l
      LEFT JOIN site_usage su ON l.license_key = su.license_key AND su.status = 'active'
      GROUP BY l.id, l.license_key
      ORDER BY l.created_at DESC
    `);
    
    res.json({
      success: true,
      data: licenses.rows
    });
    
  } catch (error) {
    console.error('Admin get licenses error:', error);
    res.json({
      success: false,
      message: 'Failed to get licenses: ' + error.message
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