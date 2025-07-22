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
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
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

    // Get subscription data if this is a subscription purchase
    let subscriptionData = null;
    if (session.mode === 'subscription' && session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      subscriptionData = {
        subscription_id: subscription.id,
        subscription_status: subscription.status,
        renewal_date: new Date(subscription.current_period_end * 1000)
      };
    }

    // Calculate renewal date
    let renewalDate = null;
    if (subscriptionData) {
      renewalDate = subscriptionData.renewal_date;
    } else if (licenseConfig.type === 'annual_unlimited') {
      renewalDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }

    // Create license in database with new schema
    const licenseResult = await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_date, renewal_date, subscription_id, subscription_status,
        stripe_price_id, amount_paid, payment_processor, purchase_source, 
        site_limit, kill_switch_enabled, resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
      RETURNING id
    `, [
      licenseKey,
      licenseConfig.type,
      'active',
      customerEmail,
      customerName,
      new Date(),                                    // purchase_date
      renewalDate,                                   // renewal_date (from Stripe)
      subscriptionData?.subscription_id || null,     // subscription_id
      subscriptionData?.subscription_status || null, // subscription_status
      priceId,                                       // stripe_price_id
      session.amount_total / 100,                    // amount_paid (convert from cents)
      'stripe',                                      // payment_processor
      'stripe_checkout',                             // purchase_source
      licenseConfig.siteLimit,
      true,
      true
    ]);

    // Record in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, stripe_session_id, stripe_subscription_id,
        stripe_price_id, amount_paid, purchase_date, renewal_date,
        payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      licenseResult.rows[0].id,
      customerEmail,
      'purchase',
      licenseConfig.type,
      licenseKey,
      session.id,
      subscriptionData?.subscription_id || null,
      priceId,
      session.amount_total / 100,
      new Date(),
      renewalDate,
      'stripe',
      'Stripe checkout purchase'
    ]);

    console.log('✅ License created in database');

    // Send license email via Pabbly with enhanced AWeber data
    const pabblySuccess = await sendToPabbly(customerEmail, licenseKey, licenseConfig.type, {
      customer_name: customerName,
      purchase_amount: session.amount_total / 100,
      currency: session.currency,
      stripe_session_id: session.id,
      subscription_id: subscriptionData?.subscription_id,
      renewal_date: renewalDate,
      site_limit: licenseConfig.siteLimit
    });

    console.log('📧 License email sent via Pabbly:', pabblySuccess);

    // Track license creation for analytics
    console.log('📊 License Analytics:', {
      license_key: licenseKey,
      license_type: licenseConfig.type,
      customer_email: customerEmail,
      amount: session.amount_total / 100,
      currency: session.currency,
      source: 'stripe_checkout',
      pabblySuccess
    });

  } catch (error) {
    console.error('❌ Checkout completion processing error:', error);
    throw error;
  }
}

// Handle payment succeeded
async function handlePaymentSucceeded(paymentIntent) {
  console.log('💰 Payment succeeded:', paymentIntent.id);
  // Additional payment processing if needed
}

// Handle subscription payment (renewals)
async function handleSubscriptionPayment(invoice) {
  console.log('🔄 Subscription payment:', invoice.id);
  
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const customer = await stripe.customers.retrieve(subscription.customer);

    // Get the price ID to determine license type
    const priceId = subscription.items.data[0]?.price?.id;
    const productId = subscription.items.data[0]?.price?.product?.id;

    // Determine license type based on price/product
    const licenseConfig = getLicenseConfig(priceId, productId);
    if (!licenseConfig) {
      console.error('❌ Unknown subscription product:', { priceId, productId });
      return;
    }

    console.log('📦 Processing subscription for license type:', licenseConfig.type);

    // Update existing license with new renewal date
    await db.query(`
      UPDATE licenses 
      SET renewal_date = $1, subscription_status = $2, last_seen = NOW()
      WHERE customer_email = $3 AND subscription_id = $4
    `, [
      new Date(subscription.current_period_end * 1000), // Use actual Stripe renewal date
      subscription.status,
      customer.email,
      subscription.id
    ]);

    // Record renewal in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        customer_email, transaction_type, stripe_subscription_id,
        stripe_price_id, amount_paid, purchase_date, renewal_date,
        payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      customer.email,
      'renewal',
      subscription.id,
      priceId,
      invoice.amount_paid / 100,
      new Date(),
      new Date(subscription.current_period_end * 1000),
      'stripe',
      'Subscription renewal payment'
    ]);

    console.log('✅ Subscription renewed for:', customer.email);

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

    // Get the price ID to determine license type
    const priceId = subscription.items.data[0]?.price?.id;
    const productId = subscription.items.data[0]?.price?.product?.id;

    // Determine license type based on price/product
    const licenseConfig = getLicenseConfig(priceId, productId);
    if (!licenseConfig) {
      console.error('❌ Unknown subscription product for cancellation:', { priceId, productId });
      return;
    }

    console.log('📦 Cancelling subscription for license type:', licenseConfig.type);

    // Deactivate license
    await db.query(
      'UPDATE licenses SET status = $1, subscription_status = $2 WHERE customer_email = $3 AND subscription_id = $4',
      ['cancelled', 'cancelled', customer.email, subscription.id]
    );

    // Record cancellation in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        customer_email, transaction_type, stripe_subscription_id,
        purchase_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      customer.email,
      'cancellation',
      subscription.id,
      new Date(),
      'stripe',
      'Subscription cancelled'
    ]);

    console.log('✅ License deactivated for cancelled subscription:', customer.email, 'license type:', licenseConfig.type);

  } catch (error) {
    console.error('❌ Subscription cancellation processing error:', error);
    throw error;
  }
}

// Handle subscription updates (plan changes, upgrades, downgrades)
async function handleSubscriptionUpdated(subscription) {
  console.log('🔄 Subscription updated:', subscription.id);
  
  try {
    const customer = await stripe.customers.retrieve(subscription.customer);

    // Get the price ID to determine license type
    const priceId = subscription.items.data[0]?.price?.id;
    const productId = subscription.items.data[0]?.price?.product?.id;

    // Determine license type based on price/product
    const licenseConfig = getLicenseConfig(priceId, productId);
    if (!licenseConfig) {
      console.error('❌ Unknown subscription product for update:', { priceId, productId });
      return;
    }

    console.log('📦 Updating subscription for license type:', licenseConfig.type);

    // Update license status and renewal date
    if (subscription.status === 'active') {
      await db.query(`
        UPDATE licenses 
        SET status = $1, subscription_status = $2, renewal_date = $3
        WHERE customer_email = $4 AND subscription_id = $5
      `, [
        'active',
        subscription.status,
        new Date(subscription.current_period_end * 1000),
        customer.email,
        subscription.id
      ]);

      console.log('✅ License updated for subscription:', customer.email, 'license type:', licenseConfig.type);
    }

  } catch (error) {
    console.error('❌ Subscription update processing error:', error);
    throw error;
  }
}

// Handle payment failures
async function handlePaymentFailed(invoice) {
  console.log('💳 Payment failed:', invoice.id);
  
  try {
    const customer = await stripe.customers.retrieve(invoice.customer);

    // Record failed payment in purchase history
    await db.query(`
      INSERT INTO purchase_history (
        customer_email, transaction_type, stripe_subscription_id,
        purchase_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      customer.email,
      'payment_failed',
      invoice.subscription,
      new Date(),
      'stripe',
      'Payment failed for invoice: ' + invoice.id
    ]);

    console.log('⚠️ Payment failure recorded for:', customer.email);

  } catch (error) {
    console.error('❌ Payment failure processing error:', error);
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
  if (productId && (productId.includes('professional') || productId.includes('5site'))) {
    return priceConfigs['price_professional_monthly'];
  } else if (productId && (productId.includes('lifetime') || productId.includes('297'))) {
    return priceConfigs['price_lifetime_unlimited'];
  } else if (productId && (productId.includes('annual') || productId.includes('197'))) {
    return priceConfigs['price_annual_unlimited'];
  }

  console.error('❌ No license config found for:', { priceId, productId });
  return null;
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
    'lifetime_unlimited': -1
  };
  
  return limits[license.license_type] || 5;
}

// Initialize database tables
async function initializeDatabase() {
  try {
    console.log('🗄️ Initializing database tables...');
    
    // Create licenses table with enhanced schema
    await db.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id SERIAL PRIMARY KEY,
        license_key VARCHAR(255) UNIQUE NOT NULL,
        license_type VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        customer_email VARCHAR(255),
        customer_name VARCHAR(255),
        purchase_date TIMESTAMP,
        renewal_date TIMESTAMP,
        trial_end_date TIMESTAMP,
        subscription_id VARCHAR(255),
        subscription_status VARCHAR(50),
        stripe_price_id VARCHAR(255),
        amount_paid DECIMAL(10,2),
        payment_processor VARCHAR(50) DEFAULT 'stripe',
        purchase_source VARCHAR(100),
        site_limit INTEGER DEFAULT 5,
        kill_switch_enabled BOOLEAN DEFAULT true,
        resale_monitoring BOOLEAN DEFAULT true,
        is_upgrade BOOLEAN DEFAULT false,
        previous_license_id INTEGER,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        last_seen TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create site_usage table
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
        amount_paid DECIMAL(10,2),
        purchase_date TIMESTAMP DEFAULT NOW(),
        renewal_date TIMESTAMP,
        payment_processor VARCHAR(50),
        sites_migrated INTEGER DEFAULT 0,
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
        sent_to_autoresponder BOOLEAN DEFAULT false,
        collected_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
}

// License validation endpoint with kill switch
router.post('/validate-license', async (req, res) => {
  try {
    const { licenseKey, siteUrl, pluginVersion, action = 'check' } = req.body;
    
    if (!licenseKey) {
      return res.json({
        success: false,
        message: 'License key is required'
      });
    }

    console.log('🔍 Validating license:', licenseKey, 'for site:', siteUrl);

    // Get license from database
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
    console.log('📋 License found:', license.license_type, license.status);

    // KILL SWITCH CHECK
    if (!license.kill_switch_enabled) {
      return res.json({
        success: false,
        message: 'This license has been disabled. Please contact support.'
      });
    }
    
    // Check license status
    if (license.status === 'cancelled' || license.status === 'expired') {
      return res.json({
        success: false,
        message: `License is ${license.status}`
      });
    }

    // Check license expiration (for trial and annual subscriptions)
    if (license.trial_end_date) {
      const now = new Date();
      const expires = new Date(license.trial_end_date);
      
      if (now > expires) {
        await db.query(
          'UPDATE licenses SET status = $1 WHERE license_key = $2',
          ['expired', licenseKey]
        );
        
        if (license.license_type === 'trial') {
          return res.json({
            success: false,
            message: 'Trial license has expired'
          });
        }
      }
    }

    // Check annual subscription renewal
    if (license.renewal_date && license.license_type === 'annual_unlimited') {
      const now = new Date();
      const renewalDate = new Date(license.renewal_date);
      
      if (now > renewalDate) {
        await db.query(
          'UPDATE licenses SET status = $1 WHERE license_key = $2',
          ['expired', licenseKey]
        );
        
        return res.json({
          success: false,
          message: 'Annual subscription has expired. Please renew to continue using SiteOverlay Pro.'
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
            message: `Site limit exceeded. This license allows ${siteLimit} sites, but ${currentUsage} are already registered. To install on this site: Uninstall SiteOverlay Pro from an existing site to free up an installation slot, then try activating again.`
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

    // Get current usage for response
    const usageResult = await db.query(
      'SELECT * FROM site_usage WHERE license_key = $1',
      [licenseKey]
    );
    
    const activeSites = usageResult.rows.filter(site => site.status === 'active');
    const currentUsage = activeSites.length;

    // Update license last seen
    await db.query(
      'UPDATE licenses SET last_seen = NOW() WHERE license_key = $1',
      [licenseKey]
    );

    // Return enhanced license data
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
        expires: license.renewal_date || license.annual_expires || 'Never',
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
      message: 'Validation failed - please contact support'
    });
  }
});

// Start trial endpoint with enhanced database integration
router.post('/start-trial', async (req, res) => {
  try {
    const { siteUrl, pluginVersion, productCode } = req.body;
    const { full_name, email } = req.body;

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
    try {
      const licenseResult = await db.query(`
        INSERT INTO licenses (
          license_key, license_type, status, customer_email, customer_name,
          purchase_date, trial_end_date, subscription_id, subscription_status,
          stripe_price_id, amount_paid, payment_processor, purchase_source, 
          site_limit, kill_switch_enabled, resale_monitoring, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        RETURNING id
      `, [
        trialLicenseKey, 
        'trial', 
        'trial', 
        email,
        full_name,
        new Date(),              // purchase_date
        trialExpires,           // trial_end_date
        null,                   // subscription_id
        null,                   // subscription_status
        null,                   // stripe_price_id
        0,                      // amount_paid (trials are free)
        'trial',                // payment_processor
        'email_trial_request',  // purchase_source
        5,                      // Trial gets 5 sites
        true,
        true
      ]);

      // Record trial in purchase history
      await db.query(`
        INSERT INTO purchase_history (
          license_id, customer_email, transaction_type, new_license_type,
          new_license_key, amount_paid, purchase_date, payment_processor, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        licenseResult.rows[0].id,
        email,
        'trial',
        'trial',
        trialLicenseKey,
        0,
        new Date(),
        'trial',
        'Free trial request'
      ]);

      console.log('✅ License inserted successfully');
    } catch (dbError) {
      console.error('❌ Database insert error (licenses):', dbError);
      return res.json({
        success: false,
        message: 'Database error creating trial license'
      });
    }

    // Send to Pabbly Connect
    console.log('🔗 Attempting Pabbly webhook...');
    let pabblySuccess = false;
    try {
      pabblySuccess = await sendToPabbly(email, trialLicenseKey, 'trial', {
        customer_name: full_name,
        website_url: siteUrl,
        trial_expires: trialExpires.toISOString(),
        site_limit: 5
      });
      
      console.log('📨 Pabbly webhook result:', pabblySuccess);
    } catch (pabblyError) {
      console.error('❌ Pabbly webhook error:', pabblyError);
      // Continue despite Pabbly error
      console.log('⚠️ Continuing despite Pabbly error...');
    }

    // Store in email collection table
    try {
      await db.query(`
        INSERT INTO email_collection (
          email, license_key, collection_source, license_type, customer_name,
          website_url, sent_to_autoresponder, collected_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [
        email, 
        trialLicenseKey, 
        'trial_request', 
        'trial', 
        full_name,
        siteUrl || '',
        pabblySuccess ? 'sent' : 'pending'
      ]);
    } catch (emailError) {
      console.error('❌ Email collection error:', emailError);
      // Continue despite error
    }

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

// Get license usage statistics
router.post('/license-usage', async (req, res) => {
  try {
    const { licenseKey } = req.body;

    if (!licenseKey) {
      return res.json({
        success: false,
        message: 'License key is required'
      });
    }

    // Get license details
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE license_key = $1',
      [licenseKey]
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
      [licenseKey]
    );

    const activeSites = usageResult.rows.filter(site => site.status === 'active');

    res.json({
      success: true,
      data: {
        license_key: licenseKey,
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

// Newsletter signup endpoint
router.post('/newsletter-signup', async (req, res) => {
  try {
    const { email, source = 'website' } = req.body;

    if (!email) {
      return res.json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log('📧 Newsletter signup:', email, 'Source:', source);

    // Check if already subscribed
    const existing = await db.query(
      'SELECT * FROM email_collection WHERE email = $1 AND collection_source = $2',
      [email, 'newsletter']
    );

    if (existing.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Already subscribed to newsletter'
      });
    }

    // Generate a newsletter "license key" for tracking
    const licenseKey = 'NEWS-' + generateLicenseKey();

    // Send to Pabbly Connect for newsletter
    const pabblySuccess = await sendToPabbly(email, licenseKey, 'newsletter', {
      source: source,
      signup_date: new Date().toISOString()
    });

    // Store in email collection
    await db.query(`
      INSERT INTO email_collection (
        email, license_key, collection_source, license_type,
        sent_to_autoresponder, collected_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [
      email, 
      licenseKey, 
      'newsletter', 
      'newsletter',
      pabblySuccess ? 'sent' : 'pending'
    ]);

    res.json({
      success: true,
      message: 'Successfully subscribed to newsletter'
    });

  } catch (error) {
    console.error('Newsletter signup error:', error);
    res.json({
      success: false,
      message: 'Failed to subscribe to newsletter'
    });
  }
});

// Admin endpoint to update license (for testing/management)
router.post('/admin/update-license', async (req, res) => {
  try {
    const { license_key, admin_key, ...updates } = req.body;

    // Simple admin authentication (replace with proper auth)
    if (admin_key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!license_key) {
      return res.json({ success: false, message: 'License key required' });
    }

    // Build update query dynamically
    const allowedFields = ['license_type', 'status', 'customer_email', 'customer_name', 'site_limit', 'renewal_date', 'kill_switch_enabled'];
    const updateFields = [];
    const values = [];
    let paramIndex = 1;

    for (const [field, value] of Object.entries(updates)) {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramIndex}`);
        values.push(value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return res.json({ success: false, message: 'No valid fields to update' });
    }

    values.push(license_key); // Add license_key as last parameter
    
    await db.query(
      `UPDATE licenses SET ${updateFields.join(', ')} WHERE license_key = $${paramIndex}`,
      values
    );

    res.json({ success: true, message: 'License updated successfully' });

  } catch (error) {
    console.error('Admin update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

// Kill switch control endpoint
router.post('/admin/toggle-kill-switch', async (req, res) => {
  try {
    const { license_key, enabled, admin_key } = req.body;
    
    // Verify admin access
    if (admin_key !== process.env.ADMIN_API_KEY) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    await db.query(
      'UPDATE licenses SET kill_switch_enabled = $1 WHERE license_key = $2',
      [enabled, license_key]
    );
    
    res.json({
      success: true,
      message: `Kill switch ${enabled ? 'enabled' : 'disabled'} for license ${license_key}`
    });
  } catch (error) {
    console.error('Kill switch toggle error:', error);
    res.status(500).json({ error: 'Failed to toggle kill switch' });
  }
});

// Pabbly Connect integration function with enhanced AWeber data
async function sendToPabbly(email, licenseKey, licenseType, metadata = {}) {
  try {
    // Get current site usage for AWeber fields
    let sitesActive = 0;
    let sitesRemaining = 'Unknown';
    
    if (licenseKey && licenseKey !== 'newsletter') {
      try {
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        sitesActive = parseInt(usageResult.rows[0].count) || 0;
        
        // Get license to determine site limit
        const licenseResult = await db.query(
          'SELECT site_limit FROM licenses WHERE license_key = $1',
          [licenseKey]
        );
        
        if (licenseResult.rows.length > 0) {
          const siteLimit = licenseResult.rows[0].site_limit;
          if (siteLimit === -1) {
            sitesRemaining = 'Unlimited';
          } else {
            sitesRemaining = Math.max(0, siteLimit - sitesActive).toString();
          }
        }
      } catch (usageError) {
        console.log('⚠️ Could not get site usage for AWeber data:', usageError.message);
      }
    }

    // Prepare enhanced data for Pabbly Connect webhook
    const pabblyData = {
      // Core data
      email: email,
      license_key: licenseKey,
      license_type: licenseType,
      
      // AWeber custom fields (your 4 fields)
      installs_remaining: sitesRemaining,
      sites_active: sitesActive.toString(),
      next_renewal: metadata.renewal_date ? 
        (typeof metadata.renewal_date === 'string' ? metadata.renewal_date.split('T')[0] : metadata.renewal_date.toISOString().split('T')[0]) : 
        (licenseType === 'lifetime_unlimited' ? 'Never' : 'Unknown'),
      
      // Customer context
      customer_name: metadata.customer_name || '',
      website_url: metadata.website_url || '',
      site_url: metadata.site_url || '',
      
      // Purchase data
      purchase_amount: metadata.purchase_amount || '0',
      currency: metadata.currency || 'USD',
      payment_processor: metadata.payment_processor || 'stripe',
      
      // Timing data
      signup_date: new Date().toISOString(),
      trial_expires: metadata.trial_expires || '',
      
      // AWeber list and tagging
      aweber_list: 'siteoverlay-pro-buyers',
      aweber_tags: [
        'SiteOverlay Pro',
        licenseType === 'trial' ? 'Trial User' : 'Paying Customer',
        licenseType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())
      ].join(','),
      
      // Email template variables
      product_name: 'SiteOverlay Pro',
      trial_duration: '14 days',
      support_email: 'support@siteoverlaypro.com',
      login_instructions: 'Go to WordPress Admin → Settings → SiteOverlay Pro'
    };

    console.log('Sending to Pabbly Connect:', { email, licenseKey, licenseType, sitesActive, sitesRemaining });

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

// Generate license key
function generateLicenseKey() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// Generate site signature for unique identification
function generateSiteSignature(siteData) {
  const signatureData = `${siteData.site_domain}${siteData.site_path}${siteData.abspath}`;
  return crypto.createHash('md5').update(signatureData).digest('hex');
}

// Initialize database on startup
initializeDatabase();

module.exports = router;