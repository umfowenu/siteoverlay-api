// SiteOverlay Pro API - Enhanced Version
const express = require('express');
const router = express.Router();
const db = require('./db');
const mailer = require('./mailer');
const crypto = require('crypto');

// Import utility modules
const { 
  getLicenseTypeFromStripePrice,
  getLicenseTypeFromPayPalAmount, 
  getLicenseTypeFromWarriorPlusProduct,
  getSiteLimitFromLicenseType,
  generateLicenseKey,
  generateSiteSignature
} = require('./utils/license-mappings');

const { sendToPabbly } = require('./utils/pabbly-utils');

// Import route modules
const trialsRoutes = require('./routes/trials');
const newsletterRoutes = require('./routes/newsletter');
const adminRoutes = require('./routes/admin');
// Import payment processor modules
const stripeRoutes = require('./routes/stripe');
const paypalRoutes = require('./routes/paypal');
const warriorplusRoutes = require('./routes/warriorplus');

// (All old utility function definitions are now removed from the bottom of the file, only initializeDatabase and module.exports = router remain)

// Test route to verify public API access
router.get('/test-public', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Public API is working!',
        timestamp: new Date().toISOString(),
        cors_test: 'OK'
    });
});

// Payment processor integrations

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'SiteOverlay Pro API by eBiz360',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint to verify routing is working
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Main routes.js is working correctly',
    modules: {
      trials: 'imported',
      newsletter: 'imported', 
      admin: 'imported',
      stripe: 'imported',
      paypal: 'imported',
      warriorplus: 'imported'
    },
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint for license validation
router.post('/debug-license', async (req, res) => {
  try {
    const { licenseKey } = req.body;
    
    if (!licenseKey) {
      return res.json({
        success: false,
        message: 'License key is required'
      });
    }

    console.log('🔍 DEBUG: Checking license key:', licenseKey);

    let licenseResult;
    let queryUsed;

    // Check if it's a site-specific license key (starts with SITE-)
    if (licenseKey.startsWith('SITE-')) {
      console.log('🔍 DEBUG: Validating site-specific license key');
      
      queryUsed = 'site_usage JOIN licenses';
      // Query site_usage table joined with licenses table for full license info
      licenseResult = await db.query(`
        SELECT l.*, su.site_license_key, su.site_url, su.site_domain 
        FROM site_usage su 
        JOIN licenses l ON su.license_key = l.license_key 
        WHERE su.site_license_key = $1 AND su.status = 'active'
      `, [licenseKey]);
      
    } else {
      console.log('🔍 DEBUG: Validating master license key');
      
      queryUsed = 'licenses table only';
      // Query licenses table for master license keys
      licenseResult = await db.query(
        'SELECT * FROM licenses WHERE license_key = $1',
        [licenseKey]
      );
    }

    console.log('🔍 DEBUG: License validation result:', {
      licenseKey,
      found: licenseResult.rows.length > 0,
      table: licenseKey.startsWith('SITE-') ? 'site_usage' : 'licenses',
      rowCount: licenseResult.rows.length
    });

    res.json({
      success: true,
      debug: {
        licenseKey,
        isSiteSpecific: licenseKey.startsWith('SITE-'),
        queryUsed,
        found: licenseResult.rows.length > 0,
        rowCount: licenseResult.rows.length,
        licenseData: licenseResult.rows[0] || null
      }
    });

  } catch (error) {
    console.error('❌ DEBUG license error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// PRODUCTION TEST ENDPOINTS - Keep for system maintenance and debugging
router.get('/test-license-install', async (req, res) => {
  try {
    // COMPLETE license install data package with ALL fields
    const completeLicenseData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothling',
      installs_remaining: '4',
      sites_active: '1', 
      site_url: 'https://test-customer-site.com',
      sales_page: 'https://siteoverlay.24hr.pro',
      license_key: 'SITE-A1B2-C3D4-E5F6',
      next_renewal: '2025-12-31',           // ADD
      support_email: 'support@ebiz360.ca',  // ADD
      aweber_tags: 'new_license,clear-tags'
    };

    // Send to license install webhook
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(completeLicenseData)
      });

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'COMPLETE license install data sent to Pabbly webhook for mapping',
          data: completeLicenseData
        });
      } else {
        res.json({ 
          success: false, 
          message: 'Failed to send to Pabbly webhook',
          status: response.status
        });
      }
    } else {
      res.json({ 
        success: false, 
        message: 'PABBLY_WEBHOOK_URL_LICENSE_INSTALL not configured' 
      });
    }
    
  } catch (error) {
    console.error('❌ Test license install webhook error:', error);
    res.json({ 
      success: false, 
      message: 'Error sending test data',
      error: error.message 
    });
  }
});

// PRODUCTION TEST ENDPOINTS - Keep for system maintenance and debugging
router.post('/test-renewal-reminder-webhook', async (req, res) => {
  try {
    // Mock renewal reminder data (Stage 3 of purchase flow)
    const mockRenewalData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothling',
      
      // Core license data
      installs_remaining: '3',
      sites_active: '2',
      site_url: 'https://test-customer-site.com',
      license_key: 'SITE-A1B2-C3D4-E5F6',
      
      // Purchase data that must be preserved
      next_renewal: '2025-12-31',
      support_email: 'support@ebiz360.ca',
      sales_page: 'https://siteoverlay.24hr.pro',
      
      // License type (if AWeber expects it)
      license_type: 'professional_5site',
      
      aweber_tags: 'subscription_ending,clear-tags'
    };

    // Reuse the same webhook URL (same Pabbly workflow)
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockRenewalData)
      });

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Mock renewal reminder data sent to Pabbly webhook successfully',
          data: mockRenewalData
        });
      } else {
        res.json({ 
          success: false, 
          message: 'Failed to send to Pabbly webhook',
          status: response.status
        });
      }
    } else {
      res.json({ 
        success: false, 
        message: 'PABBLY_WEBHOOK_URL_LICENSE_INSTALL not configured' 
      });
    }
    
  } catch (error) {
    console.error('❌ Test renewal reminder webhook error:', error);
    res.json({ 
      success: false, 
      message: 'Error sending test data',
      error: error.message 
    });
  }
});

// PRODUCTION TEST ENDPOINTS - Keep for system maintenance and debugging
router.get('/test-renewal-reminder', async (req, res) => {
  try {
    // Mock renewal reminder data (Stage 3 of purchase flow)
    const mockRenewalData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothling',
      
      // Core license data
      installs_remaining: '3',
      sites_active: '2',
      site_url: 'https://test-customer-site.com',
      license_key: 'SITE-A1B2-C3D4-E5F6',
      
      // Purchase data that must be preserved
      next_renewal: '2025-12-31',
      support_email: 'support@ebiz360.ca',
      sales_page: 'https://siteoverlay.24hr.pro',
      
      // License type (if AWeber expects it)
      license_type: 'professional_5site',
      
      aweber_tags: 'subscription_ending,clear-tags'
    };

    // Reuse the same webhook URL (same Pabbly workflow)
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockRenewalData)
      });

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Mock renewal reminder data sent to Pabbly webhook successfully',
          data: mockRenewalData
        });
      } else {
        res.json({ 
          success: false, 
          message: 'Failed to send to Pabbly webhook',
          status: response.status
        });
      }
    } else {
      res.json({ 
        success: false, 
        message: 'PABBLY_WEBHOOK_URL_LICENSE_INSTALL not configured' 
      });
    }
    
  } catch (error) {
    console.error('❌ Test renewal reminder webhook error:', error);
    res.json({ 
      success: false, 
      message: 'Error sending test data',
      error: error.message 
    });
  }
});

// PRODUCTION TEST ENDPOINTS - Keep for system maintenance and debugging
router.post('/test-purchase-simple', async (req, res) => {
  try {
    const { sendPurchaseToPabbly } = require('./utils/pabbly-utils');
    
    const result = await sendPurchaseToPabbly('marius@shaw.ca', 'professional_5site', {
      customer_name: 'Marius Nothling',
      next_renewal: '2025-12-31'
    });
    
    res.json({ 
      success: result, 
      message: result ? 'Purchase data sent successfully' : 'Failed to send purchase data',
      webhook: 'PABBLY_WEBHOOK_URL_PURCHASE'
    });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});



// Diagnostic endpoint to check environment and imports
router.get('/diagnostic', (req, res) => {
  const diagnostics = {
    success: true,
    timestamp: new Date().toISOString(),
    environment: {
      node_env: process.env.NODE_ENV || 'not set',
      port: process.env.PORT || 'not set',
      database_url: process.env.DATABASE_URL ? 'set' : 'not set',
      stripe_secret_key: process.env.STRIPE_SECRET_KEY ? 'set' : 'not set',
      pabbly_webhook_url: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY ? 'set' : 'not set'
    },
    modules: {
      express: typeof express !== 'undefined' ? 'loaded' : 'not loaded',
      db: typeof db !== 'undefined' ? 'loaded' : 'not loaded',
      trialsRoutes: typeof trialsRoutes !== 'undefined' ? 'loaded' : 'not loaded',
      stripeRoutes: typeof stripeRoutes !== 'undefined' ? 'loaded' : 'not loaded'
    }
  };
  
  res.json(diagnostics);
});

// Register route modules
router.use('/', trialsRoutes);
router.use('/', newsletterRoutes);
router.use('/', adminRoutes);
// Register payment processor modules
router.use('/', stripeRoutes);
router.use('/', paypalRoutes);
router.use('/', warriorplusRoutes);

// ============================================================================
// DYNAMIC CONTENT ENDPOINTS
// ============================================================================

// Get dynamic content for plugin
router.get('/dynamic-content', async (req, res) => {
  try {
    const { license_type = 'all', plugin_version = '2.0.1' } = req.query;
    
    console.log('🎨 Dynamic content request:', { license_type, plugin_version });
    
    // Query dynamic content based on license type and plugin version
    const contentResult = await db.query(`
      SELECT content_key, content_value, content_type
      FROM dynamic_content 
      WHERE is_active = true 
        AND (license_type = $1 OR license_type = 'all')
        AND (plugin_version_min IS NULL OR plugin_version_min <= $2)
        AND (plugin_version_max IS NULL OR plugin_version_max >= $2)
      ORDER BY content_key
    `, [license_type, plugin_version]);
    
    // Format content for easy consumption
    const content = {};
    contentResult.rows.forEach(row => {
      content[row.content_key] = {
        value: row.content_value,
        type: row.content_type
      };
    });
    
    // Get the download/documentation URLs from the specific row (ID=1)
    const urlResult = await db.query(`
      SELECT plugin_download_url, installation_video_url, installation_guide_pdf_url
      FROM dynamic_content 
      WHERE id = 1
    `);

    // Add the URL fields if they exist
    if (urlResult.rows.length > 0) {
      const urlRow = urlResult.rows[0];
      
      if (urlRow.plugin_download_url) {
        content.plugin_download_url = {
          value: urlRow.plugin_download_url,
          type: 'url'
        };
      }
      
      if (urlRow.installation_video_url) {
        content.installation_video_url = {
          value: urlRow.installation_video_url,
          type: 'url'
        };
      }
      
      if (urlRow.installation_guide_pdf_url) {
        content.installation_guide_pdf_url = {
          value: urlRow.installation_guide_pdf_url,
          type: 'url'
        };
      }
    }
    

    
    res.json({
      success: true,
      content: content,
      license_type: license_type,
      plugin_version: plugin_version
    });
    
  } catch (error) {
    console.error('❌ Dynamic content fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch dynamic content'
    });
  }
});

// Update dynamic content (admin endpoint)
router.post('/admin/dynamic-content', async (req, res) => {
  try {
    const { admin_key, content_key, content_value, content_type = 'text', license_type = 'all' } = req.body;
    
    // Verify admin access
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    if (!content_key || !content_value) {
      return res.json({ success: false, message: 'Content key and value required' });
    }
    
    console.log('🎨 Updating dynamic content:', { content_key, content_value, content_type, license_type });
    
    // Update or insert content
    const result = await db.query(`
      INSERT INTO dynamic_content (content_key, content_value, content_type, license_type, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, true, NOW(), NOW())
      ON CONFLICT (content_key) 
      DO UPDATE SET 
        content_value = $2,
        content_type = $3,
        updated_at = NOW()
      RETURNING *
    `, [content_key, content_value, content_type, license_type]);
    
    res.json({
      success: true,
      message: 'Dynamic content updated successfully',
      content: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Dynamic content update error:', error);
    res.json({
      success: false,
      message: 'Failed to update dynamic content'
    });
  }
});

// Get all dynamic content for admin dashboard
router.get('/admin/dynamic-content', async (req, res) => {
  try {
    const { admin_key } = req.query;
    
    // Verify admin access
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const contentResult = await db.query(`
      SELECT * FROM dynamic_content 
      ORDER BY license_type, content_key
    `);
    
    res.json({
      success: true,
      content: contentResult.rows
    });
    
  } catch (error) {
    console.error('❌ Dynamic content fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch dynamic content'
    });
  }
});

// Test database connection endpoint
router.get('/admin/test-database', async (req, res) => {
  try {
    const { admin_key } = req.query;
    
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ success: false, message: 'Invalid admin key' });
    }
    
    // Test database connection
    const result = await db.query('SELECT COUNT(*) as total FROM dynamic_content');
    
    res.json({
      success: true,
      message: 'Database connection working',
      total_records: result.rows[0].total
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ success: false, message: 'Database connection failed', error: error.message });
  }
});

// Get all purchasers (admin endpoint)
router.get('/admin/api/purchasers', async (req, res) => {
  try {
    const { admin_key, sort_by = 'created_at', sort_order = 'desc' } = req.query;
    
    // Verify admin access
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    console.log('🔍 Loading purchasers with sort:', { sort_by, sort_order });
    
    // Query all non-trial licenses
    const result = await db.query(`
      SELECT license_key, license_type, status, customer_name, customer_email, 
             site_limit, created_at, renewal_date, kill_switch_enabled,
             COALESCE(amount_paid, 0) as amount_paid,
             payment_processor
      FROM licenses 
      WHERE license_type != 'trial'
      ORDER BY ${sort_by} ${sort_order.toUpperCase()}
    `);
    
    console.log('🔍 Found purchasers:', result.rows.length);
    
    res.json({
      success: true,
      purchasers: result.rows
    });
    
  } catch (error) {
    console.error('❌ Purchasers fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch purchasers'
    });
  }
});

// Get all trials (admin endpoint)  
router.get('/admin/api/trials', async (req, res) => {
  try {
    const { admin_key, sort_by = 'created_at', sort_order = 'desc' } = req.query;
    
    // Verify admin access
    if (admin_key !== process.env.ADMIN_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    console.log('🔍 Loading trials with sort:', { sort_by, sort_order });
    
    // Query all trial licenses
    const result = await db.query(`
      SELECT license_key, status, customer_name, customer_email,
             created_at, trial_end_date, kill_switch_enabled,
             CASE 
               WHEN trial_end_date > NOW() THEN 'active'
               ELSE 'expired'
             END as trial_status
      FROM licenses 
      WHERE license_type = 'trial'
      ORDER BY ${sort_by} ${sort_order.toUpperCase()}
    `);
    
    console.log('🔍 Found trials:', result.rows.length);
    
    res.json({
      success: true,
      trials: result.rows
    });
    
  } catch (error) {
    console.error('❌ Trials fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch trials'
    });
  }
});

// ============================================================================
// LICENSE VALIDATION AND MANAGEMENT
// ============================================================================

/**
 * LICENSE VALIDATION ENDPOINT
 *
 * @description Validates license status for WordPress plugin
 *
 * BUSINESS LOGIC:
 *   - Checks license_key against the licenses table in the database
 *   - Verifies license exists and is not expired, revoked, or disabled
 *   - Checks kill_switch_enabled field for immediate disable
 *   - Handles trial expiration and renewal dates
 *   - Enforces site limits and site registration
 *   - Returns feature permissions and license details for plugin
 *
 * DATABASE OPERATIONS:
 *   - SELECT license by license_key
 *   - Checks status, expiration, kill switch, and site usage
 *   - Optionally registers new site if siteUrl provided and under limit
 *
 * INTEGRATION:
 *   - Plugin expects JSON response with features_enabled, license_type, expiry_date, etc.
 *   - Response format must be consistent for plugin consumption
 *
 * ENVIRONMENT VARIABLES:
 *   - DB_CONNECTION_STRING: PostgreSQL connection
 *   - CORS_ORIGIN: Allowed origin for API requests (if applicable)
 *
 * SECURITY:
 *   - Validates domain/siteUrl
 *   - Ensures only valid, active licenses are accepted
 *   - Handles kill switch and admin disables
 *
 * @param {string} licenseKey - License key to validate (from plugin)
 * @param {string} siteUrl - Site URL requesting validation
 * @returns {Object} License status with features_enabled, license_type, expiry_date, etc.
 */
// License validation endpoint
router.post('/validate-license', async (req, res) => {
  try {
    const { licenseKey, siteUrl, siteData } = req.body;

    // Add comprehensive logging for debugging
    console.log('🔍 License validation request:', {
      licenseKey: licenseKey ? `${licenseKey.substring(0, 8)}...` : 'null',
      siteUrl: siteUrl || 'not provided',
      hasSiteData: !!siteData,
      timestamp: new Date().toISOString()
    });

    if (!licenseKey) {
      console.log('❌ License validation failed: No license key provided');
      return res.json({
        success: false,
        message: 'License key is required'
      });
    }

    // Get license from database
    let licenseResult;

    // Check if it's a site-specific license key (starts with SITE-)
    if (licenseKey.startsWith('SITE-')) {
      console.log('🔍 Validating site-specific license key');
      
      // Query site_usage table joined with licenses table for full license info
      licenseResult = await db.query(`
        SELECT l.*, su.site_license_key, su.site_url, su.site_domain 
        FROM site_usage su 
        JOIN licenses l ON su.license_key = l.license_key 
        WHERE su.site_license_key = $1 AND su.status = 'active'
      `, [licenseKey]);
      
      console.log('🔍 Site-specific license query result:', {
        licenseKey: `${licenseKey.substring(0, 8)}...`,
        rowsFound: licenseResult.rows.length,
        query: 'site_usage JOIN licenses',
        firstRow: licenseResult.rows[0] ? {
          license_key: licenseResult.rows[0].license_key ? `${licenseResult.rows[0].license_key.substring(0, 8)}...` : 'null',
          license_type: licenseResult.rows[0].license_type,
          status: licenseResult.rows[0].status,
          site_license_key: licenseResult.rows[0].site_license_key ? `${licenseResult.rows[0].site_license_key.substring(0, 8)}...` : 'null'
        } : null
      });
      
    } else if (licenseKey.startsWith('TRIAL-')) {
      console.log('🔍 Validating trial license key');
      
      // Allow trial keys to validate from licenses table
      licenseResult = await db.query(
        'SELECT * FROM licenses WHERE license_key = $1',
        [licenseKey]
      );
      
      console.log('🔍 Trial license query result:', {
        licenseKey: `${licenseKey.substring(0, 8)}...`,
        rowsFound: licenseResult.rows.length,
        query: 'licenses table only',
        firstRow: licenseResult.rows[0] ? {
          license_key: licenseResult.rows[0].license_key ? `${licenseResult.rows[0].license_key.substring(0, 8)}...` : 'null',
          license_type: licenseResult.rows[0].license_type,
          status: licenseResult.rows[0].status,
          trial_end_date: licenseResult.rows[0].trial_end_date
        } : null
      });
      
    } else {
      console.log('🔍 Master license key - NOT VALID for plugin usage');
      
      // REJECT master keys for plugin usage - they should only be used for site-specific license generation
      return res.json({
        success: false,
        message: 'Master license keys cannot be used directly for plugin activation. Please request a site-specific license from the plugin settings.'
      });
    }

    console.log('🔍 License validation result:', {
      licenseKey: `${licenseKey.substring(0, 8)}...`,
      found: licenseResult.rows.length > 0,
      table: licenseKey.startsWith('SITE-') ? 'site_usage' : 'licenses',
      rowCount: licenseResult.rows.length
    });

    if (licenseResult.rows.length === 0) {
      console.log('❌ License validation failed: No license found in database', {
        licenseKey: `${licenseKey.substring(0, 8)}...`,
        licenseType: licenseKey.startsWith('SITE-') ? 'site-specific' : licenseKey.startsWith('TRIAL-') ? 'trial' : 'master',
        searchedTable: licenseKey.startsWith('SITE-') ? 'site_usage JOIN licenses' : 'licenses'
      });
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = licenseResult.rows[0];

    // CHECK FOR TRIAL REUSE PREVENTION (only for paid licenses on sites that had trials)
    if (siteUrl && !licenseKey.startsWith('TRIAL-')) {
      const siteSignature = generateSiteSignature({
        site_domain: new URL(siteUrl).hostname,
        site_path: new URL(siteUrl).pathname,
        abspath: siteUrl
      });

      // Check if this site already had a trial
      const existingTrialCheck = await db.query(
        'SELECT * FROM licenses l JOIN site_usage su ON l.license_key = su.license_key WHERE su.site_signature = $1 AND l.license_type = $2',
        [siteSignature, 'trial']
      );

      if (existingTrialCheck.rows.length > 0) {
        const existingTrial = existingTrialCheck.rows[0];
        
        // If trial is still active
        if (existingTrial.status === 'active' && existingTrial.trial_end_date) {
          const now = new Date();
          const trialEnd = new Date(existingTrial.trial_end_date);
          if (now <= trialEnd) {
            return res.json({
              success: false,
              message: 'A trial is currently active on this site. Trials can only be used once per site.'
            });
          }
        }
        
        // If trial was used before (even if expired)
        return res.json({
          success: false,
          message: 'Trial has already been used on this site. Trials can only be used once per site. Please purchase a license to continue using SiteOverlay Pro.'
        });
      }
    }

    // Check kill switch
    if (license.kill_switch_enabled === false) {
      return res.json({
        success: false,
        message: 'License has been disabled. Please contact support.'
      });
    }

    // Check license status
    if (license.status !== 'active' && license.status !== 'trial') {
      return res.json({
        success: false,
        message: `License is ${license.status}. Please contact support.`
      });
    }

    // Check expiration for trials
    if (license.license_type === 'trial' && license.trial_end_date) {
      const now = new Date();
      const trialEnd = new Date(license.trial_end_date);
      if (now > trialEnd) {
        return res.json({
          success: false,
          message: 'Trial period has expired. Please purchase a license.'
        });
      }
    }

    // Check site limit and register site if provided
    let currentUsage = 0;
    const siteLimit = getSiteLimitFromLicenseType(license.license_type);

    if (siteUrl) {
      // Generate site signature
      const siteSignature = generateSiteSignature({
        site_domain: new URL(siteUrl).hostname,
        site_path: new URL(siteUrl).pathname,
        abspath: siteUrl
      });

      console.log('🔍 Site registration check:', {
        siteUrl,
        siteSignature,
        licenseKey,
        isSiteSpecific: licenseKey.startsWith('SITE-')
      });

      // Check if site already registered
      const existingSite = await db.query(
        'SELECT * FROM site_usage WHERE license_key = $1 AND site_signature = $2',
        [licenseKey, siteSignature]
      );

      if (existingSite.rows.length === 0) {
        // New site - check if we can register it
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );

        currentUsage = parseInt(usageResult.rows[0].count);

        if (siteLimit > 0 && currentUsage >= siteLimit) {
          return res.json({
            success: false,
            message: `Site limit exceeded. This license allows ${siteLimit} sites. To install on this site: Uninstall SiteOverlay Pro from an existing site to free up an installation slot, then try activating again.`
          });
        }

        // Register new site
        await db.query(`
          INSERT INTO site_usage (
            license_key, site_signature, site_domain, site_url, site_data, status
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          licenseKey,
          siteSignature,
          new URL(siteUrl).hostname,
          siteUrl,
          JSON.stringify(siteData || {}),
          'active'
        ]);

        currentUsage++;
      } else {
        // Update existing site
        await db.query(
          'UPDATE site_usage SET last_seen = NOW(), site_data = $1 WHERE license_key = $2 AND site_signature = $3',
          [JSON.stringify(siteData || {}), licenseKey, siteSignature]
        );

        // Get current usage
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        currentUsage = parseInt(usageResult.rows[0].count);
      }

      // Update license last seen
      await db.query(
        'UPDATE licenses SET last_seen = NOW() WHERE license_key = $1',
        [licenseKey]
      );
    }

    // Return success response
    console.log('✅ License validation successful:', {
      licenseKey: `${licenseKey.substring(0, 8)}...`,
      licenseType: license.license_type,
      status: license.status,
      customerName: license.customer_name,
      siteLimit: siteLimit,
      sitesUsed: currentUsage,
      sitesRemaining: siteLimit > 0 ? Math.max(0, siteLimit - currentUsage) : 'Unlimited'
    });

    res.json({
      success: true,
      message: 'License validated successfully',
      data: {
        license_key: licenseKey,
        license_type: license.license_type,
        status: license.status,
        customer_name: license.customer_name,
        customer_email: license.customer_email,
        licensed_to: license.customer_name,
        purchase_date: license.purchase_date,
        renewal_date: license.renewal_date || license.annual_expires || 'Never',
        expires: license.renewal_date || license.annual_expires || license.trial_end_date || 'Never',
        site_limit: siteLimit,
        sites_used: currentUsage,
        sites_remaining: siteLimit > 0 ? Math.max(0, siteLimit - currentUsage) : 'Unlimited',
        subscription_status: license.subscription_status,
        payment_processor: license.payment_processor || 'stripe',
        is_trial: license.license_type === 'trial',
        company: 'eBiz360',
        validation_source: 'railway_api',
        last_validated: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ License validation error:', error);
    res.json({
      success: false,
      message: 'License validation failed'
    });
  }
});

// Unregister site endpoint
router.post('/unregister-site', async (req, res) => {
  try {
    const { licenseKey, siteUrl } = req.body;

    if (!licenseKey || !siteUrl) {
      return res.json({
        success: false,
        message: 'License key and site URL are required'
      });
    }

    const siteSignature = generateSiteSignature({
      site_domain: new URL(siteUrl).hostname,
      site_path: new URL(siteUrl).pathname,
      abspath: siteUrl
    });

    await db.query(
      'UPDATE site_usage SET status = $1, deactivated_at = NOW() WHERE license_key = $2 AND site_signature = $3',
      ['deactivated', licenseKey, siteSignature]
    );

    res.json({
      success: true,
      message: 'Site unregistered successfully'
    });

  } catch (error) {
    console.error('Site unregistration error:', error);
    res.json({
      success: false,
      message: 'Failed to unregister site'
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// Initialize database (run on startup)
async function initializeDatabase() {
  try {
    console.log('🗄️ Initializing database schema...');

    // Create licenses table with all fields
    await db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) UNIQUE NOT NULL,
        license_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) DEFAULT 'active',
        customer_email VARCHAR(255),
        customer_name VARCHAR(255),
        purchase_date TIMESTAMP,
        renewal_date TIMESTAMP,
        trial_end_date TIMESTAMP,
        subscription_id VARCHAR(255),
        subscription_status VARCHAR(50),
        stripe_price_id VARCHAR(255),
        paypal_transaction_id VARCHAR(255),
        paypal_subscription_id VARCHAR(255),
        warriorplus_transaction_id VARCHAR(255),
        warriorplus_product_id VARCHAR(255),
        affiliate_id VARCHAR(255),
        affiliate_commission DECIMAL(10,2),
        amount_paid DECIMAL(10,2),
        payment_processor VARCHAR(50) DEFAULT 'stripe',
        purchase_source VARCHAR(100),
        site_limit INTEGER DEFAULT 5,
        kill_switch_enabled BOOLEAN DEFAULT true,
        resale_monitoring BOOLEAN DEFAULT true,
        verification_required BOOLEAN DEFAULT false,
        last_seen TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create site_usage table
    await db.query(`
      CREATE TABLE IF NOT EXISTS site_usage (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        site_signature VARCHAR(255) NOT NULL,
        site_domain VARCHAR(255),
        site_url TEXT,
        site_data JSONB,
        status VARCHAR(50) DEFAULT 'active',
        registered_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW(),
        deactivated_at TIMESTAMP,
        UNIQUE(license_key, site_signature)
      )
    `);

    // Create purchase_history table
    await db.query(`
      CREATE TABLE IF NOT EXISTS purchase_history (
        id SERIAL PRIMARY KEY,
        license_id INTEGER REFERENCES licenses(id),
        customer_email VARCHAR(255) NOT NULL,
        transaction_type VARCHAR(50),
        old_license_type VARCHAR(50),
        new_license_type VARCHAR(50),
        old_license_key VARCHAR(255),
        new_license_key VARCHAR(255),
        stripe_session_id VARCHAR(255),
        stripe_subscription_id VARCHAR(255),
        stripe_price_id VARCHAR(255),
        paypal_transaction_id VARCHAR(255),
        paypal_subscription_id VARCHAR(255),
        warriorplus_transaction_id VARCHAR(255),
        warriorplus_product_id VARCHAR(255),
        amount_paid DECIMAL(10,2),
        purchase_date TIMESTAMP DEFAULT NOW(),
        renewal_date TIMESTAMP,
        sites_migrated INTEGER DEFAULT 0,
        payment_processor VARCHAR(50),
        notes TEXT,
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
        website_url TEXT,
        sent_to_autoresponder VARCHAR(50) DEFAULT 'pending',
        collected_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create dynamic_content table
    await db.query(`
      CREATE TABLE IF NOT EXISTS dynamic_content (
        id SERIAL PRIMARY KEY,
        content_key VARCHAR(255) UNIQUE NOT NULL,
        content_value TEXT NOT NULL,
        content_type VARCHAR(50) NOT NULL,
        license_type VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        plugin_version_min VARCHAR(50),
        plugin_version_max VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for performance
    await db.query('CREATE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses(license_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_licenses_customer_email ON licenses(customer_email)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_site_usage_license_key ON site_usage(license_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_purchase_history_license_id ON purchase_history(license_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_dynamic_content_content_key ON dynamic_content(content_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_dynamic_content_license_type ON dynamic_content(license_type)');

    console.log('✅ Database schema initialized successfully');

  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Initialize database on startup
initializeDatabase();

/**
 * PUBLIC DYNAMIC CONTENT ENDPOINT
 * 
 * This endpoint provides public access to dynamic content for plugin installations.
 * No authentication required - serves active content to all plugin instances.
 * 
 * Used by: WordPress plugins, web apps, Chrome extensions
 * Security: Only returns active content, no sensitive admin data
 */

// Public dynamic content endpoint for plugin access
router.get('/dynamic-content-public', async (req, res) => {
  try {
    console.log('Public endpoint accessed'); // Debug log
    
    const contentResult = await db.query(`
      SELECT content_key, content_value, content_type 
      FROM dynamic_content 
      WHERE is_active = true
      ORDER BY content_key
    `);
    
    console.log('Content rows found:', contentResult.rowCount); // Debug log
    
    res.json({
      success: true,
      content: contentResult.rows,
      count: contentResult.rowCount
    });
    
  } catch (error) {
    console.error('Public dynamic content fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch content',
      error: error.message
    });
  }
});

// PABBLY MAPPING TEST - Send exact data structure for field mapping
router.post('/test-pabbly-mapping', async (req, res) => {
  try {
    const testData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothing', // Using the exact name from your list
      support_email: 'support@ebiz360.ca',
      sales_page: 'https://siteoverlay.24hr.pro',
      next_renewal: '2025-12-31',
      license_type: 'professional_5site',
      plugin_download: 'https://siteoverlay-pro.s3.us-east-1.amazonaws.com/plugins/siteoverlay-pro.zip',
      aweber_tags: 'subscription-active'
    };

    console.log('📤 Sending test data to Pabbly:', testData);
    
    // Send directly to Pabbly webhook URL
    const pabblyUrl = process.env.PABBLY_WEBHOOK_URL_PURCHASE;
    
    if (pabblyUrl) {
      const response = await fetch(pabblyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testData)
      });

      const responseText = await response.text();
      console.log('📥 Pabbly response:', response.status, responseText);

      res.json({ 
        success: response.ok,
        message: `Test data sent to Pabbly. Status: ${response.status}`,
        pabblyResponse: responseText,
        dataSent: testData,
        webhookUrl: pabblyUrl
      });
    } else {
      res.json({ 
        success: false, 
        error: 'PABBLY_WEBHOOK_URL_PURCHASE not configured',
        dataSent: testData
      });
    }
  } catch (error) {
    console.error('❌ Pabbly test error:', error);
    res.json({ 
      success: false, 
      error: error.message,
      dataSent: testData
    });
  }
});

module.exports = router;