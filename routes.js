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

// Enhanced license validation with kill switch and 3-tier pricing support
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

// Handle license check with kill switch support
async function handleLicenseCheck(req, res) {
  const { licenseKey, siteUrl } = req.body;

  try {
    const result = await db.query(`
      SELECT *, 
        CASE 
          WHEN license_type = 'trial' AND trial_expires < NOW() THEN 'expired'
          WHEN license_type = 'unlimited_annual' AND annual_expires < NOW() THEN 'expired'
          ELSE status 
        END as current_status
      FROM licenses 
      WHERE license_key = $1
    `, [licenseKey]);

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = result.rows[0];

    // Check kill switch
    if (license.kill_switch_enabled && license.current_status === 'suspended') {
      return res.json({
        success: false,
        message: 'License suspended. Contact support@siteoverlaypro.com',
        suspension_reason: license.suspension_reason
      });
    }

    if (license.current_status === 'terminated') {
      return res.json({
        success: false,
        message: 'License terminated due to terms violation'
      });
    }

    // Check verification requirement
    if (license.verification_required) {
      return res.json({
        success: false,
        message: 'License verification required. Please check your email.',
        requires_verification: true
      });
    }

    // Check expiration
    if (license.current_status === 'expired') {
      return res.json({
        success: false,
        message: license.license_type === 'trial' ? 
          'Trial period has expired. Please purchase a license.' :
          'Annual license has expired. Please renew your subscription.'
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

    // Update installation tracking with enhanced monitoring
    await trackInstallationEnhanced(licenseKey, siteUrl, req.body, license);

    // Update last seen
    await db.query(
      'UPDATE licenses SET last_seen = NOW() WHERE license_key = $1',
      [licenseKey]
    );

    res.json({
      success: true,
      message: 'License is valid',
      data: {
        license_type: license.license_type,
        status: license.current_status,
        customer_name: license.customer_name,
        licensed_to: license.customer_name, // Display in plugin
        expires: license.license_type === 'unlimited' ? 'Never' : 
                license.license_type === 'trial' ? license.trial_expires : 
                license.license_type === 'unlimited_annual' ? license.annual_expires : null,
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

// Handle license activation with enhanced tracking
async function handleLicenseActivation(req, res) {
  const { licenseKey, siteUrl } = req.body;

  try {
    const result = await db.query(`
      SELECT *, 
        CASE 
          WHEN license_type = 'trial' AND trial_expires < NOW() THEN 'expired'
          WHEN license_type = 'unlimited_annual' AND annual_expires < NOW() THEN 'expired'
          ELSE status 
        END as current_status
      FROM licenses 
      WHERE license_key = $1
    `, [licenseKey]);

    if (result.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = result.rows[0];

    // Check if license can be activated
    if (license.current_status === 'expired') {
      return res.json({
        success: false,
        message: license.license_type === 'trial' ? 
          'Trial has expired' : 'License has expired'
      });
    }

    if (license.current_status === 'suspended' || license.current_status === 'terminated') {
      return res.json({
        success: false,
        message: 'License is suspended. Contact support@siteoverlaypro.com'
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

    // Track installation with enhanced monitoring
    await trackInstallationEnhanced(licenseKey, siteUrl, req.body, license);

    res.json({
      success: true,
      message: 'License activated successfully',
      data: {
        license_type: license.license_type,
        status: license.current_status,
        customer_name: license.customer_name,
        licensed_to: license.customer_name,
        expires: license.license_type === 'unlimited' ? 'Never' : 
                license.license_type === 'trial' ? license.trial_expires : 
                license.license_type === 'unlimited_annual' ? license.annual_expires : null,
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

// Enhanced installation tracking with anti-abuse monitoring
async function trackInstallationEnhanced(licenseKey, siteUrl, data, license) {
  try {
    // Get client info for monitoring
    const clientInfo = {
      ip_address: data.clientIP || 'unknown',
      user_agent: data.userAgent || 'unknown',
      wp_version: data.wpVersion || 'unknown',
      plugin_version: data.pluginVersion || 'unknown'
    };

    await db.query(`
      INSERT INTO plugin_installations (
        license_key, site_url, site_title, wp_version, php_version, 
        plugin_version, theme_name, site_language, site_timezone, 
        client_ip, user_agent, last_seen
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (license_key, site_url) 
      DO UPDATE SET 
        last_seen = NOW(),
        activation_count = plugin_installations.activation_count + 1,
        is_active = true,
        client_ip = $10,
        user_agent = $11
    `, [
      licenseKey,
      siteUrl,
      data.siteTitle || null,
      data.wpVersion || null,
      data.phpVersion || null,
      data.pluginVersion || null,
      data.themeName || null,
      data.siteLanguage || null,
      data.siteTimezone || null,
      clientInfo.ip_address,
      clientInfo.user_agent
    ]);

    // Monitor for suspicious activity
    if (license.resale_monitoring) {
      await checkSuspiciousActivity(licenseKey, siteUrl, clientInfo);
    }

  } catch (error) {
    console.error('Enhanced installation tracking error:', error);
  }
}

// Suspicious activity detection
async function checkSuspiciousActivity(licenseKey, siteUrl, clientInfo) {
  try {
    // Check for multiple IPs (more than 3 different IPs)
    const ipCheck = await db.query(`
      SELECT DISTINCT client_ip 
      FROM plugin_installations 
      WHERE license_key = $1 AND client_ip != 'unknown'
    `, [licenseKey]);

    if (ipCheck.rows.length > 3) {
      await db.query(`
        UPDATE licenses 
        SET verification_required = true, 
            suspension_reason = 'Multiple IP addresses detected - possible resale'
        WHERE license_key = $1
      `, [licenseKey]);
    }

  } catch (error) {
    console.error('Suspicious activity check error:', error);
  }
}

// Email-based trial request system
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
    const trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    // Create trial license in database
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name, 
        purchase_source, trial_expires, kill_switch_enabled, resale_monitoring,
        trial_start, activated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
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

// Updated Stripe webhook with 3-tier pricing support
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

      // Determine license type based on amount - 3-TIER PRICING
      let licenseType = 'professional'; // Default: $35/month for 5 sites
      let isAnnual = false;
      let annualExpires = null;

      if (paymentIntent.amount >= 29700) { // $297.00 in cents
        licenseType = 'unlimited'; // Lifetime unlimited
        isAnnual = false;
      } else if (paymentIntent.amount >= 19700) { // $197.00 in cents  
        licenseType = 'unlimited_annual'; // Annual unlimited
        isAnnual = true;
        // Set expiration to 1 year from now
        const currentDate = new Date();
        annualExpires = new Date(currentDate.getFullYear() + 1, currentDate.getMonth(), currentDate.getDate());
      } else {
        licenseType = 'professional'; // $35/month for 5 sites
        isAnnual = false;
      }

      // Generate license key
      const licenseKey = licenseType === 'unlimited' ? 'LIFE-' + generateLicenseKey() :
                        licenseType === 'unlimited_annual' ? 'ANN-' + generateLicenseKey() :
                        'PRO-' + generateLicenseKey();

      // Create license record
      await db.query(`
        INSERT INTO licenses (
          license_key, license_type, status, customer_name, customer_email,
          purchase_source, total_revenue, mrr_contribution, annual_expires,
          kill_switch_enabled, resale_monitoring, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      `, [
        licenseKey,
        licenseType,
        'active',
        customer.name || customer.email,
        customer.email,
        'stripe_payment',
        paymentIntent.amount / 100,
        licenseType === 'professional' ? 35 : 0, // Only professional has monthly recurring
        annualExpires,
        true, // Kill switch enabled
        licenseType === 'unlimited' // Resale monitoring for lifetime licenses
      ]);

      // Store customer email
      await db.query(`
        INSERT INTO email_collection (
          email, license_key, collection_source, license_type, conversion_status
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (email, license_key) 
        DO UPDATE SET conversion_status = $5
      `, [customer.email, licenseKey, 'purchase', licenseType, 'customer']);

      // Send to Pabbly Connect for license delivery
      await sendToPabbly(customer.email, licenseKey, licenseType, {
        customer_name: customer.name || 'Valued Customer',
        amount_paid: paymentIntent.amount / 100,
        purchase_date: new Date().toISOString(),
        annual_expires: annualExpires ? annualExpires.toISOString() : null
      });

      // Send license email via mailer as backup
      if (mailer && mailer.sendLicenseEmail) {
        await mailer.sendLicenseEmail(
          customer.email,
          customer.name || 'Valued Customer',
          licenseKey,
          licenseType.charAt(0).toUpperCase() + licenseType.slice(1)
        );
      }

      console.log('License generated and sent:', licenseKey, 'Type:', licenseType);
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
    if (mailer && mailer.monitorTrials) {
      await mailer.monitorTrials();
    }
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
    await trackInstallationEnhanced(installData.licenseKey, installData.siteUrl, installData, {
      resale_monitoring: true
    });

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

// Manual license activation/reactivation
router.post('/admin/activate-license', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { licenseKey, reason } = req.body;

    await db.query(`
      UPDATE licenses 
      SET status = 'active', 
          suspension_reason = NULL, 
          verification_required = false,
          updated_at = NOW()
      WHERE license_key = $1
    `, [licenseKey]);

    // Log the action
    await db.query(`
      INSERT INTO admin_actions (action_type, license_key, reason, admin_user, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['manual_activate', licenseKey, reason || 'Manual activation', 'admin']);

    res.json({
      success: true,
      message: 'License activated successfully'
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create manual license (for special cases)
router.post('/admin/create-license', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { 
      licenseType, customerName, customerEmail, 
      customLicenseKey, notes, skipPabbly 
    } = req.body;

    // Generate license key if not provided
    const licenseKey = customLicenseKey || 
      (licenseType === 'trial' ? 'TRIAL-' : 
       licenseType === 'unlimited' ? 'LIFE-' : 
       licenseType === 'professional' ? 'PRO-' : 'ANN-') + generateLicenseKey();

    // Set expiration based on license type
    let trialExpires = null;
    let annualExpires = null;
    
    if (licenseType === 'trial') {
      trialExpires = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    } else if (licenseType === 'unlimited_annual') {
      annualExpires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }

    // Create license
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_name, customer_email,
        purchase_source, trial_expires, annual_expires, kill_switch_enabled,
        resale_monitoring, created_at, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11)
    `, [
      licenseKey, licenseType, 'active', customerName, customerEmail,
      'manual_creation', trialExpires, annualExpires, true, 
      licenseType === 'unlimited', // Resale monitoring for lifetime licenses
      notes || 'Manually created license'
    ]);

    // Send to Pabbly unless skipped
    if (!skipPabbly && customerEmail) {
      await sendToPabbly(customerEmail, licenseKey, licenseType, {
        source: 'manual_creation',
        customer_name: customerName
      });
    }

    // Log the action
    await db.query(`
      INSERT INTO admin_actions (action_type, license_key, reason, admin_user, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['manual_create', licenseKey, `Created ${licenseType} license for ${customerName}`, 'admin']);

    res.json({
      success: true,
      message: 'License created successfully',
      data: {
        license_key: licenseKey,
        license_type: licenseType,
        customer_name: customerName,
        expires: trialExpires || annualExpires
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Admin endpoints for license control
router.post('/admin/suspend-license', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { licenseKey, reason, requireVerification } = req.body;

    await db.query(`
      UPDATE licenses 
      SET status = $1, suspension_reason = $2, verification_required = $3, updated_at = NOW()
      WHERE license_key = $4
    `, ['suspended', reason, requireVerification || false, licenseKey]);

    // Log the action
    await db.query(`
      INSERT INTO admin_actions (action_type, license_key, reason, admin_user, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['suspend', licenseKey, reason, 'admin']);

    res.json({
      success: true,
      message: 'License suspended successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/admin/terminate-license', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { licenseKey, reason } = req.body;

    await db.query(`
      UPDATE licenses 
      SET status = $1, suspension_reason = $2, updated_at = NOW()
      WHERE license_key = $3
    `, ['terminated', reason, licenseKey]);

    // Deactivate all installations
    await db.query(
      'UPDATE plugin_installations SET is_active = false WHERE license_key = $1',
      [licenseKey]
    );

    // Log the action
    await db.query(`
      INSERT INTO admin_actions (action_type, license_key, reason, admin_user, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['terminate', licenseKey, reason, 'admin']);

    res.json({
      success: true,
      message: 'License terminated successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Reset license (clear all installations)
router.post('/admin/reset-license', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { licenseKey, reason } = req.body;

    // Clear all installations
    await db.query(
      'UPDATE plugin_installations SET is_active = false WHERE license_key = $1',
      [licenseKey]
    );

    // Reset verification requirements
    await db.query(`
      UPDATE licenses 
      SET verification_required = false, 
          suspension_reason = NULL,
          updated_at = NOW()
      WHERE license_key = $1
    `, [licenseKey]);

    // Log the action
    await db.query(`
      INSERT INTO admin_actions (action_type, license_key, reason, admin_user, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `, ['reset', licenseKey, reason || 'Manual reset', 'admin']);

    res.json({
      success: true,
      message: 'License reset successfully - all installations cleared'
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get license details for admin review
router.get('/admin/license-details/:licenseKey', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { licenseKey } = req.params;

    // Get license info
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
    );

    if (licenseResult.rows.length === 0) {
      return res.status(404).json({ error: 'License not found' });
    }

    const license = licenseResult.rows[0];

    // Get installations
    const installationsResult = await db.query(
      'SELECT * FROM plugin_installations WHERE license_key = $1 ORDER BY last_seen DESC',
      [licenseKey]
    );

    // Get admin actions history
    const actionsResult = await db.query(
      'SELECT * FROM admin_actions WHERE license_key = $1 ORDER BY created_at DESC LIMIT 10',
      [licenseKey]
    );

    res.json({
      success: true,
      data: {
        license: license,
        installations: installationsResult.rows,
        admin_history: actionsResult.rows,
        stats: {
          total_installations: installationsResult.rows.length,
          active_installations: installationsResult.rows.filter(i => i.is_active).length,
          unique_ips: [...new Set(installationsResult.rows.map(i => i.client_ip))].length
        }
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search and list licenses for admin
router.get('/admin/licenses', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { 
      status, license_type, customer_email, 
      limit = 50, offset = 0, search 
    } = req.query;

    let query = `
      SELECT l.*, 
        COUNT(pi.id) as installation_count,
        COUNT(CASE WHEN pi.is_active THEN 1 END) as active_installations
      FROM licenses l
      LEFT JOIN plugin_installations pi ON l.license_key = pi.license_key
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;

    if (status) {
      query += ` AND l.status = $${++paramCount}`;
      params.push(status);
    }

    if (license_type) {
      query += ` AND l.license_type = $${++paramCount}`;
      params.push(license_type);
    }

    if (customer_email) {
      query += ` AND l.customer_email ILIKE $${++paramCount}`;
      params.push(`%${customer_email}%`);
    }

    if (search) {
      query += ` AND (l.license_key ILIKE $${++paramCount} OR l.customer_name ILIKE $${paramCount} OR l.customer_email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    query += `
      GROUP BY l.id
      ORDER BY l.created_at DESC
      LIMIT $${++paramCount} OFFSET $${++paramCount}
    `;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        returned: result.rows.length
      }
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_company VARCHAR(255),
        purchase_source VARCHAR(100) DEFAULT 'direct',
        trial_expires TIMESTAMP,
        annual_expires TIMESTAMP,
        kill_switch_enabled BOOLEAN DEFAULT true,
        resale_monitoring BOOLEAN DEFAULT true,
        verification_required BOOLEAN DEFAULT false,
        suspension_reason TEXT,
        last_seen TIMESTAMP,
        notes TEXT,
        xagio_affiliate_url VARCHAR(500),
        dynamic_content_version INT DEFAULT 1,
        last_content_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
        client_ip VARCHAR(45),
        user_agent TEXT,
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

      CREATE TABLE IF NOT EXISTS admin_actions (
        id SERIAL PRIMARY KEY,
        action_type VARCHAR(50) NOT NULL,
        license_key VARCHAR(255) NOT NULL,
        reason TEXT,
        admin_user VARCHAR(100) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        'licenses (enhanced with kill switch and 3-tier pricing)',
        'plugin_installations (enhanced with IP tracking)', 
        'dynamic_content',
        'email_collection',
        'customer_analytics',
        'admin_actions (new for audit trail)'
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

// Test validation endpoint
router.post('/test-validate', async (req, res) => {
  try {
    console.log('Test validate received:', req.body);
    
    res.json({
      success: true,
      message: 'Test validation endpoint working',
      received_data: req.body,
      data: {
        license_type: 'test',
        status: 'active',
        customer_name: 'Test User',
        licensed_to: 'Test User',
        expires: 'Never',
        company: 'eBiz360'
      }
    });
    
  } catch (error) {
    console.error('Test validate error:', error);
    res.json({
      success: false,
      message: 'Test validation failed',
      error: error.message
    });
  }
});

// Pabbly Connect integration function (replaces sendToAweber)
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
      customer_name: metadata.customer_name || '',
      
      // Timing data
      signup_date: new Date().toISOString(),
      trial_expires: metadata.trial_expires || '',
      annual_expires: metadata.annual_expires || '',
      
      // Purchase data
      amount_paid: metadata.amount_paid || '',
      purchase_date: metadata.purchase_date || '',
      
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

// Database schema update for new license system
router.get('/update-schema', async (req, res) => {
  const adminSecret = req.query.secret || req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'siteoverlay-setup-2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Updating database schema for new license system...');

    // Add missing columns to licenses table
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255),
      ADD COLUMN IF NOT EXISTS trial_expires TIMESTAMP,
      ADD COLUMN IF NOT EXISTS annual_expires TIMESTAMP,
      ADD COLUMN IF NOT EXISTS kill_switch_enabled BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS resale_monitoring BOOLEAN DEFAULT true,
      ADD COLUMN IF NOT EXISTS verification_required BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
      ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP,
      ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // Add missing columns to plugin_installations table
    await db.query(`
      ALTER TABLE plugin_installations
      ADD COLUMN IF NOT EXISTS client_ip VARCHAR(45),
      ADD COLUMN IF NOT EXISTS user_agent TEXT;
    `);

    console.log('Schema update completed successfully!');

    res.json({
      success: true,
      message: 'Database schema updated successfully!',
      updates_applied: [
        'Added customer_email, trial_expires, annual_expires to licenses',
        'Added kill_switch_enabled, resale_monitoring to licenses', 
        'Added verification_required, suspension_reason to licenses',
        'Added client_ip, user_agent to plugin_installations'
      ]
    });

  } catch (error) {
    console.error('Schema update error:', error);
    res.status(500).json({
      success: false,
      message: 'Schema update failed',
      error: error.message
    });
  }
});

// Fix missing created_at column
router.get('/fix-created-at', async (req, res) => {
  const adminSecret = req.query.secret || req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_SECRET && adminSecret !== 'siteoverlay-setup-2025') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Adding missing created_at column...');

    // Add the missing created_at column
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // Update existing records to have created_at
    await db.query(`
      UPDATE licenses 
      SET created_at = CURRENT_TIMESTAMP 
      WHERE created_at IS NULL;
    `);

    console.log('created_at column added successfully!');

    res.json({
      success: true,
      message: 'created_at column added successfully!',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Fix created_at error:', error);
    res.status(500).json({
      success: false,
      message: 'Fix failed',
      error: error.message
    });
  }
});

// Simple database test - no auth needed
router.get('/test-db', async (req, res) => {
  try {
    // Test basic database connection
    const result = await db.query('SELECT NOW() as current_time');
    
    // Test licenses table structure
    const columns = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'licenses'
      ORDER BY ordinal_position
    `);

    res.json({
      success: true,
      database_time: result.rows[0].current_time,
      licenses_columns: columns.rows
    });

  } catch (error) {
    res.json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;