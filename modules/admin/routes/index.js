const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const DashboardController = require('../controllers/dashboard');
const LicenseController = require('../controllers/license');
const CustomerController = require('../controllers/customer');

// Dashboard routes
router.get('/dashboard', adminAuth, DashboardController.getStats);
router.get('/health', adminAuth, DashboardController.getSystemHealth);

// License management routes
router.post('/search', adminAuth, LicenseController.search);
router.post('/kill-switch', adminAuth, LicenseController.toggleKillSwitch);
router.post('/update-installs', adminAuth, LicenseController.updateInstalls);
router.post('/extend-trial', adminAuth, LicenseController.extendTrial);
router.post('/convert-lifetime', adminAuth, LicenseController.convertToLifetime);
router.post('/enable-license', adminAuth, LicenseController.enableLicense);

// Customer management routes
router.post('/customer-data', adminAuth, CustomerController.getCustomerData);
router.post('/kill-customer', adminAuth, CustomerController.killCustomerLicenses);

// New data retrieval routes
router.get('/purchasers', adminAuth, LicenseController.getAllPurchasers);
router.get('/trials', adminAuth, LicenseController.getAllTrials);

// New license control route
router.post('/toggle-status', adminAuth, LicenseController.toggleLicenseStatus);

// Debug route
router.get('/debug-license-types', adminAuth, LicenseController.debugLicenseTypes);

/**
 * DYNAMIC CONTENT MANAGEMENT ENDPOINTS
 * 
 * These endpoints manage configurable content for WordPress plugins and future platforms.
 * Content is stored in the dynamic_content table and served to plugin installations.
 * 
 * Database Schema:
 * - content_key: Unique identifier (e.g., 'preview_title_text')
 * - content_value: The actual content text/URL
 * - content_type: 'text' or 'url' for validation
 * - license_type: 'all' (future: specific license targeting)
 * - is_active: Boolean for content activation
 * 
 * Security: All endpoints require ADMIN_KEY for access
 * Caching: Plugin cache clearing triggered after updates
 */

// Dynamic content management routes
router.get('/dynamic-content', adminAuth, async (req, res) => {
  try {
    const db = require('../../../db');
    
    const contentResult = await db.query(`
      SELECT content_key, content_value, content_type, license_type, is_active 
      FROM dynamic_content 
      WHERE is_active = true
      ORDER BY content_key
    `);
    
    res.json({
      success: true,
      content: contentResult.rows,
      count: contentResult.rowCount
    });
    
  } catch (error) {
    console.error('Dynamic content fetch error:', error);
    res.json({
      success: false,
      message: 'Failed to fetch dynamic content',
      error: error.message
    });
  }
});

router.post('/dynamic-content', adminAuth, async (req, res) => {
  try {
    const db = require('../../../db');
    const { content_key, content_value, content_type = 'text', license_type = 'all' } = req.body;
    
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

// Test routes for debugging
router.get('/test-route', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Admin API route is working!',
        timestamp: new Date().toISOString(),
        path: req.path
    });
});

router.post('/test-route', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Admin API POST route is working!',
        body: req.body,
        timestamp: new Date().toISOString()
    });
});

// Debug route to see all mounted routes
router.get('/debug-routes', (req, res) => {
    const routes = [];
    
    // Get all routes from the router
    router.stack.forEach(function(r){
        if (r.route && r.route.path){
            routes.push({
                method: Object.keys(r.route.methods)[0].toUpperCase(),
                path: r.route.path
            });
        }
    });
    
    res.json({
        success: true,
        routes: routes,
        message: 'All available admin API routes'
    });
});

// Test database connection endpoint
router.get('/test-database', adminAuth, async (req, res) => {
  try {
    const db = require('../../../db');
    
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

// Debug endpoint to see raw database content
router.get('/debug-content', adminAuth, async (req, res) => {
  try {
    const db = require('../../../db');
    
    // Get ALL content (including inactive)
    const allContent = await db.query('SELECT * FROM dynamic_content ORDER BY created_at DESC');
    
    // Get table structure
    const tableInfo = await db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'dynamic_content'
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      all_content: allContent.rows,
      table_structure: tableInfo.rows,
      total_records: allContent.rowCount
    });
    
  } catch (error) {
    console.error('❌ Debug content error:', error);
    res.json({
      success: false,
      message: 'Debug failed',
      error: error.message
    });
  }
});

// Stripe Payment Mode Management Routes
router.get('/api/stripe-mode-status', adminAuth, async (req, res) => {
  try {
    const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
    
    console.log(`🔧 Stripe mode status request: ${isTestMode ? 'TEST' : 'LIVE'}`);
    
    res.json({ 
      success: true, 
      testMode: isTestMode,
      environmentValue: process.env.STRIPE_TEST_MODE,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting Stripe mode status:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error getting Stripe mode status',
      error: error.message
    });
  }
});

router.post('/api/update-stripe-mode', adminAuth, async (req, res) => {
  try {
    const db = require('../../../db');
    const { testMode } = req.body;
    
    console.log(`🔧 Stripe mode update request: ${testMode ? 'TEST' : 'LIVE'} mode`);
    
    // Update environment variable immediately
    process.env.STRIPE_TEST_MODE = testMode ? 'true' : 'false';
    console.log(`✅ Environment updated: STRIPE_TEST_MODE = ${process.env.STRIPE_TEST_MODE}`);
    
    // Save to database for persistence
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS system_settings (
          setting_key VARCHAR(100) PRIMARY KEY,
          setting_value TEXT NOT NULL,
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
      
      await db.query(`
        INSERT INTO system_settings (setting_key, setting_value, updated_at) 
        VALUES ($1, $2, NOW()) 
        ON CONFLICT (setting_key) 
        DO UPDATE SET setting_value = $2, updated_at = NOW()
      `, ['STRIPE_TEST_MODE', testMode ? 'true' : 'false']);
      
      console.log(`✅ Database updated: STRIPE_TEST_MODE = ${testMode}`);
      
    } catch (dbError) {
      console.error('❌ Database save error:', dbError);
    }
    
    res.json({ 
      success: true, 
      message: `Stripe mode updated to ${testMode ? 'test' : 'live'} mode`,
      testMode: testMode,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error updating Stripe mode:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error updating Stripe mode',
      error: error.message
    });
  }
});

module.exports = router; 