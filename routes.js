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

// NEW: Stripe webhook endpoint for payment processing
router.post('/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('✅ Stripe webhook verified:', event.type);
  } catch (err) {
    console.error('❌ Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;
      case 'invoice.payment_succeeded':
        await handleSubscriptionPayment(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object);
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
  } catch (error) {
    console.error('❌ Stripe webhook processing error:', error);
    res.status(500).json({error: 'Webhook processing failed'});
  }
});

// Handle successful checkout completion
async function handleCheckoutCompleted(session) {
  console.log('🛒 Processing checkout completion:', session.id);
  
  try {
    // Get line items to determine product
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      expand: ['data.price.product']
    });
    
    if (!lineItems.data.length) {
      console.error('❌ No line items found for session:', session.id);
      return;
    }
    
    const priceId = lineItems.data[0].price.id;
    const productId = lineItems.data[0].price.product.id;
    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name || 'Customer';
    
    console.log('📦 Product details:', { priceId, productId, customerEmail });
    
    // Determine license type based on price ID or product ID
    const licenseConfig = getLicenseConfig(priceId, productId);
    if (!licenseConfig) {
      console.error('❌ Unknown product/price ID:', { priceId, productId });
      return;
    }
    
    // Generate license key
    const licenseKey = licenseConfig.prefix + '-' + generateLicenseKey();
    console.log('🔑 Generated license:', licenseKey);
    
    // Calculate expiration date
    let expirationDate = null;
    if (licenseConfig.type === 'annual_unlimited') {
      expirationDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    }
    
    // Create license in database
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_source, trial_expires, site_limit, kill_switch_enabled, 
        resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      licenseKey,
      licenseConfig.type,
      'active',
      customerEmail,
      customerName,
      'stripe_checkout',
      expirationDate,
      licenseConfig.siteLimit,
      true,
      true
    ]);
    
    console.log('✅ License created in database');
    
    // Send license email via Pabbly
    const pabblySuccess = await sendToPabbly(customerEmail, licenseKey, licenseConfig.type, {
      customer_name: customerName,
      purchase_amount: session.amount_total / 100,
      currency: session.currency,
      stripe_session_id: session.id
    });
    
    console.log('📧 License email sent via Pabbly:', pabblySuccess);
    
    // Store email collection record
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type,
        customer_name, sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      customerEmail,
      licenseKey,
      'stripe_purchase',
      licenseConfig.type,
      customerName,
      pabblySuccess
    ]);
    
    console.log('✅ Checkout processing completed for:', customerEmail);
    
  } catch (error) {
    console.error('❌ Checkout processing error:', error);
    throw error;
  }
}

// Handle payment succeeded (for one-time payments)
async function handlePaymentSucceeded(paymentIntent) {
  console.log('💳 Payment succeeded:', paymentIntent.id);
  // Additional processing if needed
}

// Handle subscription payment (for monthly subscriptions)
async function handleSubscriptionPayment(invoice) {
  console.log('🔄 Subscription payment:', invoice.id);
  
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    // Check if this is a renewal or new subscription
    const existingLicense = await db.query(
      'SELECT * FROM licenses WHERE customer_email = $1 AND license_type = $2',
      [customer.email, 'professional']
    );
    
    if (existingLicense.rows.length === 0) {
      // New subscription - create license
      await handleCheckoutCompleted({
        customer_details: {
          email: customer.email,
          name: customer.name || 'Customer'
        },
        id: `sub_${subscription.id}`,
        amount_total: invoice.amount_paid,
        currency: invoice.currency
      });
    } else {
      // Renewal - update existing license
      await db.query(
        'UPDATE licenses SET status = $1, trial_expires = NULL WHERE customer_email = $2 AND license_type = $3',
        ['active', customer.email, 'professional']
      );
      console.log('✅ Subscription renewed for:', customer.email);
    }
    
  } catch (error) {
    console.error('❌ Subscription payment processing error:', error);
    throw error;
  }
}

// Handle subscription cancellation
async function handleSubscriptionCancelled(subscription) {
  console.log('❌ Subscription cancelled:', subscription.id);
  
  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    // Deactivate license
    await db.query(
      'UPDATE licenses SET status = $1 WHERE customer_email = $2 AND license_type = $3',
      ['cancelled', customer.email, 'professional']
    );
    
    console.log('✅ License deactivated for cancelled subscription:', customer.email);
    
  } catch (error) {
    console.error('❌ Subscription cancellation processing error:', error);
    throw error;
  }
}

// Get license configuration based on Stripe price/product ID
function getLicenseConfig(priceId, productId) {
  // Configure your Stripe price IDs here
  const priceConfigs = {
    // $35/month Professional (5 sites)
    'price_professional_monthly': {
      type: 'professional',
      prefix: 'PRO',
      siteLimit: 5
    },
    // $297 Lifetime Unlimited
    'price_lifetime_unlimited': {
      type: 'lifetime_unlimited',
      prefix: 'LIFE',
      siteLimit: -1
    },
    // $197/year Annual Unlimited (NEW PRODUCT)
    'price_annual_unlimited': {
      type: 'annual_unlimited',
      prefix: 'ANN',
      siteLimit: -1
    }
  };
  
  // Try to match by price ID first, then by product ID patterns
  if (priceConfigs[priceId]) {
    return priceConfigs[priceId];
  }
  
  // Fallback: try to determine by product ID patterns
  if (productId.includes('professional') || productId.includes('5site')) {
    return priceConfigs['price_professional_monthly'];
  } else if (productId.includes('lifetime') || productId.includes('297')) {
    return priceConfigs['price_lifetime_unlimited'];
  } else if (productId.includes('annual') || productId.includes('197')) {
    return priceConfigs['price_annual_unlimited'];
  }
  
  console.error('❌ No license config found for:', { priceId, productId });
  return null;
}

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
        sent_to_autoresponder BOOLEAN DEFAULT false,
        collected_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Create plugin_installations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS plugin_installations (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) NOT NULL,
        site_url TEXT NOT NULL,
        site_domain VARCHAR(255),
        wp_version VARCHAR(50),
        plugin_version VARCHAR(50),
        installation_date TIMESTAMP DEFAULT NOW(),
        last_heartbeat TIMESTAMP DEFAULT NOW(),
        status VARCHAR(50) DEFAULT 'active'
      )
    `);
    
    console.log('✅ All database tables created successfully');
    
    res.json({
      success: true,
      message: 'Database setup completed successfully',
      tables_created: [
        'licenses (with site_limit column)',
        'site_usage (for site tracking)',
        'email_collection (for marketing)',
        'plugin_installations (for analytics)'
      ]
    });
    
  } catch (error) {
    console.error('❌ Database setup error:', error);
    res.status(500).json({
      success: false,
      message: 'Database setup failed: ' + error.message
    });
  }
});

// Enhanced license validation with comprehensive logging
router.post('/validate-license', async (req, res) => {
  try {
    const { licenseKey, siteUrl, action, pluginVersion } = req.body;
    
    console.log('🔍 License validation request:', { licenseKey, siteUrl, action });
    
    if (!licenseKey) {
      return res.json({
        success: false,
        message: 'License key is required'
      });
    }
    
    // Get license from database
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
    );
    
    if (licenseResult.rows.length === 0) {
      console.log('❌ License not found:', licenseKey);
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }
    
    const license = licenseResult.rows[0];
    console.log('📋 License found:', license.license_type, license.status);
    
    // Check license status
    if (license.status === 'cancelled' || license.status === 'expired') {
      return res.json({
        success: false,
        message: `License is ${license.status}`
      });
    }
    
    // Check trial expiration
    if (license.license_type === 'trial' && license.trial_expires) {
      const now = new Date();
      const expires = new Date(license.trial_expires);
      
      if (now > expires) {
        await db.query(
          'UPDATE licenses SET status = $1 WHERE license_key = $2',
          ['expired', licenseKey]
        );
        
        return res.json({
          success: false,
          message: 'Trial license has expired'
        });
      }
    }
    
    // Get site limit for this license
    const siteLimit = getSiteLimit(license);
    console.log('🏠 Site limit for license:', siteLimit);
    
    // If we have a site URL, handle site registration/checking
    if (siteUrl && action === 'check') {
      // Generate site signature
      const siteSignature = generateSiteSignature({
        site_domain: new URL(siteUrl).hostname,
        site_path: new URL(siteUrl).pathname,
        abspath: siteUrl
      });
      
      // Check if site is already registered
      const siteResult = await db.query(
        'SELECT * FROM site_usage WHERE license_key = $1 AND site_signature = $2',
        [licenseKey, siteSignature]
      );
      
      if (siteResult.rows.length === 0 && siteLimit > 0) {
        // Site not registered, check if we're under the limit
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        
        const currentUsage = parseInt(usageResult.rows[0].count);
        console.log('📊 Current site usage:', currentUsage, '/', siteLimit);
        
        if (currentUsage >= siteLimit) {
          return res.json({
            success: false,
            message: `Site limit exceeded. This license allows ${siteLimit} sites, but ${currentUsage} are already registered.`
          });
        }
        
        // Register the new site
        await db.query(`
          INSERT INTO site_usage (
            license_key, site_signature, site_domain, site_url, site_data, status
          ) VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          licenseKey,
          siteSignature,
          new URL(siteUrl).hostname,
          siteUrl,
          JSON.stringify({ plugin_version: pluginVersion }),
          'active'
        ]);
        
        console.log('✅ New site registered:', siteUrl);
      } else if (siteResult.rows.length > 0) {
        // Update last seen for existing site
        await db.query(
          'UPDATE site_usage SET last_seen = NOW() WHERE license_key = $1 AND site_signature = $2',
          [licenseKey, siteSignature]
        );
      }
    }
    
    // Track installation if plugin version provided
    if (siteUrl && pluginVersion) {
      await trackInstallation(licenseKey, siteUrl, { pluginVersion });
    }
    
    // Get current site usage for response
    const usageResult = await db.query(
      'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
      [licenseKey, 'active']
    );
    
    const currentUsage = parseInt(usageResult.rows[0].count);
    
    // Return success response
    res.json({
      success: true,
      message: 'License validated successfully',
      data: {
        license_key: licenseKey,
        license_type: license.license_type,
        status: license.status,
        customer_name: license.customer_name,
        licensed_to: license.customer_name,
        expires: license.trial_expires || 'Never',
        site_limit: siteLimit,
        sites_used: currentUsage,
        sites_remaining: siteLimit > 0 ? Math.max(0, siteLimit - currentUsage) : 'Unlimited',
        company: 'eBiz360',
        validation_source: 'railway_api',
        last_validated: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ License validation error:', error);
    res.json({
      success: false,
      message: 'Validation failed - please contact support'
    });
  }
});

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
        expires: trialExpires.toISOString(),
        pabbly_status: pabblySuccess ? 'email_sent' : 'email_pending'
      }
    });

  } catch (error) {
    console.error('❌ Unexpected trial request error:', error);
    res.json({
      success: false,
      message: 'Failed to process trial request - please contact support'
    });
  }
});

// Email collection endpoint for newsletter signups
router.post('/collect-email', async (req, res) => {
  try {
    const { email, source, customer_name, license_type, website_url } = req.body;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.json({
        success: false,
        message: 'Valid email address is required'
      });
    }

    // Generate license key for newsletter if not provided
    const licenseKey = license_type ? 'NEWS-' + generateLicenseKey() : null;

    // Store email collection
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type,
        customer_name, website_url, sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      email,
      licenseKey,
      source || 'newsletter',
      license_type || 'newsletter',
      customer_name || '',
      website_url || '',
      false
    ]);

    // Send to Pabbly Connect for newsletter
    const pabblySuccess = await sendToPabbly(email, licenseKey || 'newsletter', 'newsletter', {
      customer_name: customer_name || '',
      website_url: website_url || '',
      collection_source: source || 'newsletter'
    });

    res.json({
      success: true,
      message: 'Email collected successfully',
      data: {
        email: email,
        pabbly_status: pabblySuccess ? 'sent' : 'pending'
      }
    });

  } catch (error) {
    console.error('Email collection error:', error);
    res.json({
      success: false,
      message: 'Failed to collect email'
    });
  }
});

// Register site usage endpoint
router.post('/register-site-usage', async (req, res) => {
  try {
    const { licenseKey, siteUrl, siteData } = req.body;

    if (!licenseKey || !siteUrl) {
      return res.json({
        success: false,
        message: 'License key and site URL are required'
      });
    }

    // Get license to check limits
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
    );

    if (licenseResult.rows.length === 0) {
      return res.json({
        success: false,
        message: 'Invalid license key'
      });
    }

    const license = licenseResult.rows[0];
    const siteLimit = getSiteLimit(license);

    // Generate site signature
    const siteSignature = generateSiteSignature({
      site_domain: new URL(siteUrl).hostname,
      site_path: new URL(siteUrl).pathname,
      abspath: siteUrl
    });

    // Check if site already registered
    const existingSite = await db.query(
      'SELECT * FROM site_usage WHERE license_key = $1 AND site_signature = $2',
      [licenseKey, siteSignature]
    );

    if (existingSite.rows.length > 0) {
      // Update existing site
      await db.query(
        'UPDATE site_usage SET last_seen = NOW(), site_data = $1 WHERE license_key = $2 AND site_signature = $3',
        [JSON.stringify(siteData || {}), licenseKey, siteSignature]
      );

      return res.json({
        success: true,
        message: 'Site registration updated',
        data: { site_signature: siteSignature }
      });
    }

    // Check site limit for new registration
    if (siteLimit > 0) {
      const usageResult = await db.query(
        'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
        [licenseKey, 'active']
      );

      const currentUsage = parseInt(usageResult.rows[0].count);

      if (currentUsage >= siteLimit) {
        return res.json({
          success: false,
          message: `Site limit exceeded. This license allows ${siteLimit} sites.`
        });
      }
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

    res.json({
      success: true,
      message: 'Site registered successfully',
      data: { site_signature: siteSignature }
    });

  } catch (error) {
    console.error('Site registration error:', error);
    res.json({
      success: false,
      message: 'Failed to register site'
    });
  }
});

// Unregister site usage endpoint
router.post('/unregister-site-usage', async (req, res) => {
  try {
    const { licenseKey, siteUrl } = req.body;

    if (!licenseKey || !siteUrl) {
      return res.json({
        success: false,
        message: 'License key and site URL are required'
      });
    }

    // Generate site signature
    const siteSignature = generateSiteSignature({
      site_domain: new URL(siteUrl).hostname,
      site_path: new URL(siteUrl).pathname,
      abspath: siteUrl
    });

    // Deactivate site
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

// Get license usage endpoint
router.get('/license-usage/:license_key', async (req, res) => {
  try {
    const { license_key } = req.params;

    // Get license info
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

    // Get site usage
    const usageResult = await db.query(
      'SELECT * FROM site_usage WHERE license_key = $1 ORDER BY registered_at DESC',
      [license_key]
    );

    const activeSites = usageResult.rows.filter(site => site.status === 'active');

    res.json({
      success: true,
      data: {
        license_key: license_key,
        license_type: license.license_type,
        site_limit: siteLimit,
        sites_used: activeSites.length,
        sites_remaining: siteLimit > 0 ? Math.max(0, siteLimit - activeSites.length) : 'Unlimited',
        sites: usageResult.rows.map(site => ({
          domain: site.site_domain,
          url: site.site_url,
          status: site.status,
          registered_at: site.registered_at,
          last_seen: site.last_seen
        }))
      }
    });

  } catch (error) {
    console.error('License usage error:', error);
    res.json({
      success: false,
      message: 'Failed to get license usage'
    });
  }
});

// Admin endpoint to remove a site from a license
router.post('/admin/remove-site', async (req, res) => {
  try {
    const { licenseKey, siteSignature, adminKey } = req.body;

    // Simple admin key check (replace with proper authentication)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await db.query(
      'UPDATE site_usage SET status = $1, deactivated_at = NOW() WHERE license_key = $2 AND site_signature = $3',
      ['removed_by_admin', licenseKey, siteSignature]
    );

    res.json({
      success: true,
      message: 'Site removed successfully'
    });

  } catch (error) {
    console.error('Admin remove site error:', error);
    res.json({
      success: false,
      message: 'Failed to remove site'
    });
  }
});

// Admin endpoint to reset site usage for a license
router.post('/admin/reset-site-usage', async (req, res) => {
  try {
    const { licenseKey, adminKey } = req.body;

    // Simple admin key check (replace with proper authentication)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await db.query(
      'UPDATE site_usage SET status = $1, deactivated_at = NOW() WHERE license_key = $2',
      ['reset_by_admin', licenseKey]
    );

    res.json({
      success: true,
      message: 'Site usage reset successfully'
    });

  } catch (error) {
    console.error('Admin reset usage error:', error);
    res.json({
      success: false,
      message: 'Failed to reset site usage'
    });
  }
});

// Admin endpoint to update license details
router.post('/admin/update-license', async (req, res) => {
  try {
    const { licenseKey, updates, adminKey } = req.body;

    // Simple admin key check (replace with proper authentication)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.json({
        success: false,
        message: 'Unauthorized'
      });
    }

    // Build update query dynamically
    const allowedFields = ['license_type', 'status', 'customer_email', 'customer_name', 'site_limit', 'trial_expires'];
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

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

    updateValues.push(licenseKey);
    const query = `UPDATE licenses SET ${updateFields.join(', ')} WHERE license_key = $${paramIndex}`;

    await db.query(query, updateValues);

    res.json({
      success: true,
      message: 'License updated successfully'
    });

  } catch (error) {
    console.error('Admin update license error:', error);
    res.json({
      success: false,
      message: 'Failed to update license'
    });
  }
});

// Admin endpoint to list all licenses
router.get('/admin/licenses', async (req, res) => {
  try {
    const { adminKey } = req.query;

    // Simple admin key check (replace with proper authentication)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const result = await db.query(`
      SELECT 
        l.*,
        COUNT(su.id) FILTER (WHERE su.status = 'active') as active_sites
      FROM licenses l
      LEFT JOIN site_usage su ON l.license_key = su.license_key
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `);

    res.json({
      success: true,
      data: result.rows.map(license => ({
        ...license,
        site_limit: getSiteLimit(license),
        active_sites: parseInt(license.active_sites) || 0
      }))
    });

  } catch (error) {
    console.error('Admin list licenses error:', error);
    res.json({
      success: false,
      message: 'Failed to list licenses'
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
    // Fix any missing columns or constraints
    await db.query(`
      ALTER TABLE licenses 
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()
    `);
    
    await db.query(`
      UPDATE licenses 
      SET created_at = NOW() 
      WHERE created_at IS NULL
    `);

    res.json({
      success: true,
      message: 'Database structure fixed'
    });

  } catch (error) {
    console.error('Database fix error:', error);
    res.json({
      success: false,
      message: 'Failed to fix database: ' + error.message
    });
  }
});

// Helper function to track plugin installations
async function trackInstallation(licenseKey, siteUrl, installationData = {}) {
  try {
    const domain = new URL(siteUrl).hostname;
    
    await db.query(`
      INSERT INTO plugin_installations (
        license_key, site_url, site_domain, wp_version, plugin_version
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (license_key, site_url) 
      DO UPDATE SET last_heartbeat = NOW()
    `, [
      licenseKey,
      siteUrl,
      domain,
      installationData.wpVersion || null,
      installationData.pluginVersion || null
    ]);

  } catch (error) {
    console.error('Installation tracking error:', error);
    // Don't fail the main request for tracking errors
  }
}

module.exports = router;