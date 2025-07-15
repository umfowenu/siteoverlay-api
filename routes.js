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

// Email-based trial request system (NEW - Pabbly Connect integration)
router.post('/request-trial', async (req, res) => {
  try {
    const { email, siteUrl, siteTitle, wpVersion, pluginVersion } = req.body;

    if (!email || !siteUrl) {
      return res.json({
        success: false,
        message: 'Email and site URL are required'
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

    // Check if email already has active trial
    const existingTrial = await db.query(
      'SELECT license_key FROM licenses WHERE customer_email = $1 AND license_type = $2 AND status IN ($3, $4)',
      [email, 'trial', 'trial', 'active']
    );

    if (existingTrial.rows.length > 0) {
      return res.json({
        success: false,
        message: 'A trial license has already been issued to this email address. Please check your email for the license key.',
        existing_license: existingTrial.rows[0].license_key
      });
    }

    // Generate trial license
    const trialLicenseKey = 'TRIAL-' + generateLicenseKey();
    const trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Create trial license in database
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
      'Trial User',
      'trial_request',
      trialExpires,
      true,
      true
    ]);

    // Store email collection record
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type, 
        sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [email, trialLicenseKey, 'trial_request', 'trial', false]);

    // Send to Pabbly Connect
    const pabblySuccess = await sendToPabbly(email, trialLicenseKey, 'trial', {
      site_url: siteUrl,
      site_title: siteTitle,
      wp_version: wpVersion,
      plugin_version: pluginVersion,
      trial_expires: trialExpires.toISOString()
    });

    // Update autoresponder status
    if (pabblySuccess) {
      await db.query(
        'UPDATE email_collection SET sent_to_autoresponder = true WHERE email = $1 AND license_key = $2',
        [email, trialLicenseKey]
      );
    }

    console.log('Trial license created:', trialLicenseKey, 'for email:', email);

    res.json({
      success: true,
      message: 'Trial license has been sent to your email address. Please check your inbox and spam folder.',
      data: {
        email: email,
        license_key: trialLicenseKey,
        expires: trialExpires.toISOString(),
        pabbly_status: pabblySuccess ? 'sent' : 'pending'
      }
    });

  } catch (error) {
    console.error('Trial request error:', error);
    res.json({
      success: false,
      message: 'Failed to process trial request. Please try again.'
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
      site_url: metadata.site_url || '',
      site_title: metadata.site_title || '',
      wp_version: metadata.wp_version || '',
      plugin_version: metadata.plugin_version || '',
      
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

module.exports = router;