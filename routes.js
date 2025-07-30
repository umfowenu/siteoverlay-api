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

    if (!licenseKey) {
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
      
    } else if (licenseKey.startsWith('TRIAL-')) {
      console.log('🔍 Validating trial license key');
      
      // Allow trial keys to validate from licenses table
      licenseResult = await db.query(
        'SELECT * FROM licenses WHERE license_key = $1',
        [licenseKey]
      );
      
    } else {
      console.log('🔍 Master license key - NOT VALID for plugin usage');
      
      // REJECT master keys for plugin usage - they should only be used for site-specific license generation
      return res.json({
        success: false,
        message: 'Master license keys cannot be used directly for plugin activation. Please request a site-specific license from the plugin settings.'
      });
    }

    console.log('🔍 License validation result:', {
      licenseKey,
      found: licenseResult.rows.length > 0,
      table: licenseKey.startsWith('SITE-') ? 'site_usage' : 'licenses'
    });

    if (licenseResult.rows.length === 0) {
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

    // Create indexes for performance
    await db.query('CREATE INDEX IF NOT EXISTS idx_licenses_license_key ON licenses(license_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_licenses_customer_email ON licenses(customer_email)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_site_usage_license_key ON site_usage(license_key)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_purchase_history_license_id ON purchase_history(license_id)');

    console.log('✅ Database schema initialized successfully');

  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// Initialize database on startup
initializeDatabase();

module.exports = router;