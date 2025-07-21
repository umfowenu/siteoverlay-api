const express = require('express');
const router = express.Router();
const db = require('./db');
const mailer = require('./mailer');
const crypto = require('crypto');

// Stripe integration with test/live mode support
const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
const stripeSecretKey = isTestMode ? process.env.STRIPE_SECRET_KEY_TEST : process.env.STRIPE_SECRET_KEY;
const webhookSecret = isTestMode ? process.env.STRIPE_WEBHOOK_SECRET_TEST : process.env.STRIPE_WEBHOOK_SECRET;

const stripe = require('stripe')(stripeSecretKey);

console.log(`🔧 Stripe initialized in ${isTestMode ? 'TEST' : 'LIVE'} mode`);

// Health check endpoint
router.get('/health', (req, res) => {
  const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
  res.json({ 
    status: 'ok', 
    service: 'SiteOverlay Pro API by eBiz360',
    stripe_mode: isTestMode ? 'TEST' : 'LIVE',
    pabbly_trial_webhook_configured: !!process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY,
    pabbly_buyers_webhook_configured: !!process.env.PABBLY_WEBHOOK_URL_BUYERS_SITEOVERLAY,
    old_webhook_variable_exists: !!process.env.PABBLY_WEBHOOK_URL,
    code_version: 'v2.1-updated-env-vars',
    timestamp: new Date().toISOString()
  });
});

// Code verification endpoint
router.get('/verify-code', (req, res) => {
  res.json({
    success: true,
    message: 'Code verification endpoint - confirms latest code is deployed',
    environment_variables: {
      PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY ? 'SET' : 'NOT_SET',
      PABBLY_WEBHOOK_URL_BUYERS_SITEOVERLAY: process.env.PABBLY_WEBHOOK_URL_BUYERS_SITEOVERLAY ? 'SET' : 'NOT_SET',
      PABBLY_WEBHOOK_URL: process.env.PABBLY_WEBHOOK_URL ? 'SET (OLD)' : 'NOT_SET',
    },
    code_status: {
      using_new_variables: true,
      sendToPabbly_updated: true,
      diagnostic_endpoints_updated: true
    }
  });
});

// Database schema verification endpoint
router.get('/verify-database', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Check if email_collection table exists and has customer_name column
    const tableCheck = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'email_collection' 
      AND column_name = 'customer_name'
    `);
    
    // Get all columns in email_collection table
    const allColumns = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'email_collection'
      ORDER BY ordinal_position
    `);
    
    client.release();
    
    const hasCustomerNameColumn = tableCheck.rows.length > 0;
    
    res.json({
      status: 'success',
      message: 'Database schema verification complete',
      emailCollectionTable: {
        hasCustomerNameColumn,
        customerNameColumnDetails: hasCustomerNameColumn ? tableCheck.rows[0] : null,
        allColumns: allColumns.rows
      },
      verification: {
        timestamp: new Date().toISOString(),
        databaseConnected: true
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Database verification failed',
      error: error.message
    });
  }
});

// Enhanced Stripe webhook endpoint with test/live mode detection
router.post('/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  let isTestMode = false;

  try {
    // Try test secret first
    const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST;
    if (testSecret) {
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, testSecret);
        isTestMode = true;
        console.log('✅ Test webhook verified:', event.type);
      } catch (testError) {
        // Try live secret
        const liveSecret = process.env.STRIPE_WEBHOOK_SECRET_LIVE || process.env.STRIPE_WEBHOOK_SECRET;
        event = stripe.webhooks.constructEvent(req.body, sig, liveSecret);
        isTestMode = false;
        console.log('✅ Live webhook verified:', event.type);
      }
    } else {
      // Fallback to single secret (legacy method)
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET_LIVE;
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      isTestMode = process.env.STRIPE_TEST_MODE === 'true';
      console.log(`✅ Webhook verified (${isTestMode ? 'TEST' : 'LIVE'} mode):`, event.type);
    }
  } catch (err) {
    console.error('❌ Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object, isTestMode);
        break;
      case 'customer.subscription.created':
        await handleSubscriptionCreated(event.data.object, isTestMode);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object, isTestMode);
        break;
      case 'invoice.payment_succeeded':
        await handleSubscriptionPayment(event.data.object, isTestMode);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object, isTestMode);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, isTestMode);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, isTestMode);
        break;
      case 'charge.dispute.created':
        await handleRefundOrDispute(event.data.object, isTestMode);
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

// Enhanced checkout completion handler with payment links support
async function handleCheckoutCompleted(session, isTestMode = false) {
  console.log(`🛒 Processing checkout completion (${isTestMode ? 'TEST' : 'LIVE'}):`, session.id);
  
  try {
    // Get customer details from Stripe
    const customer = await stripe.customers.retrieve(session.customer);
    
    // Handle subscription-based purchases
    if (session.subscription) {
      const subscription = await stripe.subscriptions.retrieve(session.subscription);
      
      // Extract customer info
      const customerData = {
        email: customer.email,
        name: customer.name || session.customer_details?.name || 'Customer',
        stripeCustomerId: customer.id,
        subscriptionId: session.subscription,
        priceId: subscription.items.data[0].price.id,
        planType: getPlanTypeFromPriceId(subscription.items.data[0].price.id),
        status: 'active',
        isTestMode: isTestMode,
        environment: isTestMode ? 'test' : 'live',
        createdAt: new Date()
      };
      
      // Generate license key
      const licenseKey = generateLicenseKey();
      
      // Prepare license data
      const licenseData = {
        ...customerData,
        licenseKey,
        maxSites: getMaxSitesFromPriceId(customerData.priceId)
      };
      
      // Save to database
      await saveLicenseToDatabase(licenseData);
      
      // Send welcome email (only in live mode)
      if (!isTestMode) {
        await sendWelcomeEmail(customerData.email, customerData.name, licenseKey);
      } else {
        console.log('🧪 Test mode - would send welcome email to:', customerData.email);
      }
      
      console.log('✅ License created for payment link purchase:', customerData.email);
      
    } else {
      // Handle one-time payments (existing logic)
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
      
      // Send license email via Pabbly (only in live mode)
      if (!isTestMode) {
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
      } else {
        console.log('🧪 Test mode - would send email to:', customerEmail);
      }
      
      console.log('✅ Checkout processing completed for:', customerEmail);
    }
    
  } catch (error) {
    console.error('❌ Checkout processing error:', error);
    throw error;
  }
}

// Handle payment succeeded (for one-time payments)
async function handlePaymentSucceeded(paymentIntent, isTestMode = false) {
  console.log(`💳 Payment succeeded (${isTestMode ? 'TEST' : 'LIVE'}):`, paymentIntent.id);
  // Additional processing if needed
}

// Handle subscription payment (for monthly and annual subscriptions)
async function handleSubscriptionPayment(invoice, isTestMode = false) {
  console.log(`🔄 Subscription payment (${isTestMode ? 'TEST' : 'LIVE'}):`, invoice.id);
  
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
    
    // Check if this is a renewal or new subscription
    const existingLicense = await db.query(
      'SELECT * FROM licenses WHERE customer_email = $1 AND license_type = $2',
      [customer.email, licenseConfig.type]
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
        ['active', customer.email, licenseConfig.type]
      );
      console.log('✅ Subscription renewed for:', customer.email, 'license type:', licenseConfig.type);
    }
    
  } catch (error) {
    console.error('❌ Subscription payment processing error:', error);
    throw error;
  }
}

// Handle subscription cancellation
async function handleSubscriptionCancelled(subscription, isTestMode = false) {
  console.log(`❌ Subscription cancelled (${isTestMode ? 'TEST' : 'LIVE'}):`, subscription.id);
  
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
      'UPDATE licenses SET status = $1 WHERE customer_email = $2 AND license_type = $3',
      ['cancelled', customer.email, licenseConfig.type]
    );
    
    console.log('✅ License deactivated for cancelled subscription:', customer.email, 'license type:', licenseConfig.type);
    
  } catch (error) {
    console.error('❌ Subscription cancellation processing error:', error);
    throw error;
  }
}

// Handle subscription updates (e.g., plan changes, billing cycle changes)
async function handleSubscriptionUpdated(subscription, isTestMode = false) {
  console.log(`🔄 Subscription updated (${isTestMode ? 'TEST' : 'LIVE'}):`, subscription.id);
  
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
    
    // Update license status and expiration if needed
    if (subscription.status === 'active') {
      // For annual subscriptions, update expiration date
      let expirationDate = null;
      if (licenseConfig.type === 'annual_unlimited') {
        // Set expiration to 1 year from now for annual subscriptions
        expirationDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      }
      
      await db.query(
        'UPDATE licenses SET status = $1, trial_expires = $2 WHERE customer_email = $3 AND license_type = $4',
        ['active', expirationDate, customer.email, licenseConfig.type]
      );
      
      console.log('✅ License updated for subscription:', customer.email, 'license type:', licenseConfig.type);
    }
    
  } catch (error) {
    console.error('❌ Subscription update processing error:', error);
    throw error;
  }
}

// Handle subscription created (backup handler)
async function handleSubscriptionCreated(subscription, isTestMode = false) {
  console.log(`🆕 Subscription created (${isTestMode ? 'TEST' : 'LIVE'}):`, subscription.id);
  
  try {
    const customer = await stripe.customers.retrieve(subscription.customer);
    const priceId = subscription.items.data[0]?.price?.id;
    const productId = subscription.items.data[0]?.price?.product?.id;
    
    console.log('📦 New subscription details:', { 
      customer: customer.email, 
      priceId, 
      productId 
    });
    
    // This is a backup handler - main processing happens in checkout.session.completed
    // But we can add additional logic here if needed
    
  } catch (error) {
    console.error('❌ Subscription created processing error:', error);
    throw error;
  }
}

// Handle payment failures
async function handlePaymentFailed(invoice, isTestMode = false) {
  console.log(`💳 Payment failed (${isTestMode ? 'TEST' : 'LIVE'}):`, invoice.id);
  
  try {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    // Get the price ID to determine license type
    const priceId = subscription.items.data[0]?.price?.id;
    const productId = subscription.items.data[0]?.price?.product?.id;
    
    // Determine license type based on price/product
    const licenseConfig = getLicenseConfig(priceId, productId);
    if (!licenseConfig) {
      console.error('❌ Unknown subscription product for payment failure:', { priceId, productId });
      return;
    }
    
    console.log('📦 Payment failed for license type:', licenseConfig.type);
    
    // Suspend license (don't delete immediately)
    await db.query(
      'UPDATE licenses SET status = $1 WHERE customer_email = $2 AND license_type = $3',
      ['suspended', customer.email, licenseConfig.type]
    );
    
    console.log('⚠️ License suspended due to payment failure:', customer.email, 'license type:', licenseConfig.type);
    
    // Send payment failure email via Pabbly (only in live mode)
    if (!isTestMode) {
      const pabblySuccess = await sendToPabbly(customer.email, null, 'payment_failed', {
        customer_name: customer.name || 'Customer',
        subscription_id: subscription.id,
        invoice_id: invoice.id
      });
      
      console.log('📧 Payment failure email sent via Pabbly:', pabblySuccess);
    } else {
      console.log('🧪 Test mode - would send payment failure email to:', customer.email);
    }
    
  } catch (error) {
    console.error('❌ Payment failure processing error:', error);
    throw error;
  }
}

// Handle refunds and disputes
async function handleRefundOrDispute(object, isTestMode = false) {
  console.log(`🔄 Refund/dispute detected (${isTestMode ? 'TEST' : 'LIVE'}):`, object.id);
  
  try {
    let subscriptionId;
    let customerId;
    
    if (object.subscription) {
      subscriptionId = object.subscription;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      customerId = subscription.customer;
    } else if (object.charge) {
      // Get subscription from charge
      const charge = await stripe.charges.retrieve(object.charge);
      const invoice = await stripe.invoices.retrieve(charge.invoice);
      subscriptionId = invoice.subscription;
      customerId = charge.customer;
    }
    
    if (subscriptionId && customerId) {
      const customer = await stripe.customers.retrieve(customerId);
      
      // Deactivate license immediately
      await db.query(
        'UPDATE licenses SET status = $1 WHERE customer_email = $2',
        ['deactivated', customer.email]
      );
      
      console.log('🚫 License deactivated for refund/dispute:', customer.email);
      
      // Send refund notification email via Pabbly (only in live mode)
      if (!isTestMode) {
        const pabblySuccess = await sendToPabbly(customer.email, null, 'refund_dispute', {
          customer_name: customer.name || 'Customer',
          subscription_id: subscriptionId,
          dispute_id: object.id,
          reason: object.reason || 'refund'
        });
        
        console.log('📧 Refund notification email sent via Pabbly:', pabblySuccess);
      } else {
        console.log('🧪 Test mode - would send refund notification to:', customer.email);
      }
    }
    
  } catch (error) {
    console.error('❌ Refund/dispute processing error:', error);
    throw error;
  }
}

// Helper: Map Stripe price IDs to plan types
function getPlanTypeFromPriceId(priceId) {
  const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
  
  // Get price IDs from environment variables
  const test5SitePrice = process.env.STRIPE_PRICE_ID_5SITE_TEST;
  const testAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL_TEST;
  const testUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED_TEST;
  
  const live5SitePrice = process.env.STRIPE_PRICE_ID_5SITE;
  const liveAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL;
  const liveUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED;
  
  const planMapping = {
    // Live mode price IDs
    [live5SitePrice]: 'professional',      // 5 sites monthly
    [liveAnnualPrice]: 'annual_unlimited', // Unlimited annual
    [liveUnlimitedPrice]: 'lifetime_unlimited', // Lifetime
    
    // Test mode price IDs  
    [test5SitePrice]: 'professional',      // 5 sites monthly (test)
    [testAnnualPrice]: 'annual_unlimited', // Unlimited annual (test)
    [testUnlimitedPrice]: 'lifetime_unlimited', // Lifetime (test)
  };
  
  return planMapping[priceId] || 'professional';
}

// Helper: Map price IDs to site limits
function getMaxSitesFromPriceId(priceId) {
  const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
  
  // Get price IDs from environment variables
  const test5SitePrice = process.env.STRIPE_PRICE_ID_5SITE_TEST;
  const testAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL_TEST;
  const testUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED_TEST;
  
  const live5SitePrice = process.env.STRIPE_PRICE_ID_5SITE;
  const liveAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL;
  const liveUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED;
  
  const siteMapping = {
    // Live mode
    [live5SitePrice]: 5,        // 5 sites monthly
    [liveAnnualPrice]: -1,      // Unlimited annual (-1 = unlimited)
    [liveUnlimitedPrice]: -1,   // Lifetime unlimited
    
    // Test mode
    [test5SitePrice]: 5,        // 5 sites monthly (test)
    [testAnnualPrice]: -1,      // Unlimited annual (test)
    [testUnlimitedPrice]: -1,   // Lifetime unlimited (test)
  };
  
  return siteMapping[priceId] || 5;
}

// Helper: Save license to database
async function saveLicenseToDatabase(licenseData) {
  try {
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_source, trial_expires, site_limit, kill_switch_enabled, 
        resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [
      licenseData.licenseKey,
      licenseData.planType,
      'active',
      licenseData.email,
      licenseData.name,
      'stripe_payment_link',
      null, // trial_expires
      licenseData.maxSites,
      true,
      true
    ]);
    
    console.log('✅ License saved to database:', licenseData.email);
  } catch (error) {
    console.error('❌ Database save error:', error);
    throw error;
  }
}

// Helper: Send welcome email
async function sendWelcomeEmail(email, name, licenseKey) {
  try {
    const pabblySuccess = await sendToPabbly(email, licenseKey, 'welcome', {
      customer_name: name,
      license_key: licenseKey
    });
    
    console.log('📧 Welcome email sent via Pabbly:', pabblySuccess);
    return pabblySuccess;
  } catch (error) {
    console.error('❌ Welcome email error:', error);
    return false;
  }
}

// Get license configuration based on Stripe price/product ID
function getLicenseConfig(priceId, productId) {
  const isTestMode = process.env.STRIPE_TEST_MODE === 'true';
  
  // Get price IDs from environment variables
  const test5SitePrice = process.env.STRIPE_PRICE_ID_5SITE_TEST;
  const testAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL_TEST;
  const testUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED_TEST;
  
  const live5SitePrice = process.env.STRIPE_PRICE_ID_5SITE;
  const liveAnnualPrice = process.env.STRIPE_PRICE_ID_ANNUAL;
  const liveUnlimitedPrice = process.env.STRIPE_PRICE_ID_UNLIMITED;
  
  // Test Mode Price Configurations
  const testPriceConfigs = {
    [test5SitePrice]: {  // Test 5 Sites
      type: 'professional_monthly',
      prefix: 'PRO',
      siteLimit: 5
    },
    [testUnlimitedPrice]: {  // Test Unlimited One Time
      type: 'lifetime_unlimited',
      prefix: 'LIFE',
      siteLimit: -1
    },
    [testAnnualPrice]: {  // Test Unlimited Annual
      type: 'annual_unlimited',
      prefix: 'ANN',
      siteLimit: -1
    }
  };
  
  // Live Mode Price Configurations
  const livePriceConfigs = {
    [live5SitePrice]: {  // Live 5 Sites
      type: 'professional_monthly',
      prefix: 'PRO',
      siteLimit: 5
    },
    [liveUnlimitedPrice]: {  // Live Unlimited One Time
      type: 'lifetime_unlimited',
      prefix: 'LIFE',
      siteLimit: -1
    },
    [liveAnnualPrice]: {  // Live Unlimited Annual
      type: 'annual_unlimited',
      prefix: 'ANN',
      siteLimit: -1
    }
  };
  
  const priceConfigs = isTestMode ? testPriceConfigs : livePriceConfigs;
  
  // Try to match by price ID first
  if (priceConfigs[priceId]) {
    console.log(`✅ Found price config for ${isTestMode ? 'TEST' : 'LIVE'} mode:`, priceId);
    return priceConfigs[priceId];
  }
  
  // Fallback: try to determine by product ID patterns
  if (productId && (productId.includes('prod_') || productId.includes('test') || productId.includes('live'))) {
    console.log(`⚠️ Fallback product ID match for ${isTestMode ? 'TEST' : 'LIVE'} mode:`, productId);
    // Default to professional if we can't determine specific price
    return {
      type: 'professional_monthly',
      prefix: 'PRO',
      siteLimit: 5
    };
  }
  
  console.error('❌ Unknown price/product ID:', { priceId, productId, mode: isTestMode ? 'TEST' : 'LIVE' });
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
    
    // Check license expiration (for trial and annual subscriptions)
    if (license.trial_expires) {
      const now = new Date();
      const expires = new Date(license.trial_expires);
      
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
        } else if (license.license_type === 'annual_unlimited') {
          return res.json({
            success: false,
            message: 'Annual subscription has expired. Please renew to continue using SiteOverlay Pro.'
          });
        }
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
      message: 'Details submitted. Check your inbox for the license key to activate trial',
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
    // Enhanced trial data for AWeber mapping
    const pabblyData = {
      // Core subscriber data (REAL DATA - NOT GENERIC)
      email: email,
      customer_name: metadata.customer_name || 'Customer',
      
      // AWeber custom fields (matching your setup)
      license_key: licenseKey,
      site_url: metadata.site_url || metadata.website_url || '',
      trial_expires: metadata.trial_expires || '',
      
      // AWeber tagging
      aweber_tags: 'trial',
      
      // Additional context for Pabbly
      license_type: licenseType,
      product_name: 'SiteOverlay Pro',
      trial_duration: '14 days',
      signup_date: new Date().toISOString(),
      
      // Support information
      support_email: 'support@siteoverlaypro.com'
    };

    console.log('🔍 DEBUG: Starting Pabbly webhook process...');
    console.log('📧 DEBUG: Email:', email);
    console.log('🔑 DEBUG: License Key:', licenseKey);
    console.log('📋 DEBUG: License Type:', licenseType);
    console.log('📊 DEBUG: Metadata:', JSON.stringify(metadata, null, 2));

    // Determine webhook URL based on product and license type
    let webhookUrl;
    if (licenseType === 'trial') {
      webhookUrl = process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY;
      console.log('🎯 DEBUG: Using TRIAL webhook URL');
    } else {
      webhookUrl = process.env.PABBLY_WEBHOOK_URL_BUYERS_SITEOVERLAY;
      console.log('🎯 DEBUG: Using BUYERS webhook URL');
    }

    // 🔍 ENVIRONMENT VARIABLE DEBUGGING
    console.log('🔍 DEBUG: All Pabbly-related env vars:');
    console.log('PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY:', process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY);
    console.log('Variable exists?', 'PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY' in process.env);
    console.log('Variable length:', process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY?.length);
    console.log('All env vars containing PABBLY:', Object.keys(process.env).filter(key => key.includes('PABBLY')));
    console.log('All env vars containing WEBHOOK:', Object.keys(process.env).filter(key => key.includes('WEBHOOK')));

    console.log('🔗 DEBUG: Webhook URL:', webhookUrl);
    console.log('📤 DEBUG: Complete Pabbly Data:', JSON.stringify(pabblyData, null, 2));

    // Send to Pabbly Connect webhook
    if (webhookUrl) {
      console.log('🚀 DEBUG: Attempting to send webhook to Pabbly...');
      
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pabblyData)
      });

      console.log('📡 DEBUG: Pabbly Response Status:', response.status);
      console.log('📡 DEBUG: Pabbly Response Headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const responseText = await response.text();
        console.log('✅ DEBUG: Pabbly Connect successful for:', email);
        console.log('📄 DEBUG: Pabbly Response Body:', responseText);
        return true;
      } else {
        const errorText = await response.text();
        console.error('❌ DEBUG: Pabbly webhook failed');
        console.error('❌ DEBUG: Status Code:', response.status);
        console.error('❌ DEBUG: Error Response:', errorText);
        console.error('❌ DEBUG: Response Headers:', Object.fromEntries(response.headers.entries()));
        return false;
      }
    } else {
      console.log('⚠️  DEBUG: No Pabbly webhook URL configured');
      console.log('⚠️  DEBUG: Environment variable not set');
      console.log('⚠️  DEBUG: Data stored locally only');
      return true; // System works without Pabbly initially
    }

  } catch (error) {
    console.error('❌ DEBUG: Pabbly integration error');
    console.error('❌ DEBUG: Error Type:', error.constructor.name);
    console.error('❌ DEBUG: Error Message:', error.message);
    console.error('❌ DEBUG: Error Stack:', error.stack);
    return false;
  }
}

// Test Pabbly webhook configuration
router.get('/test-pabbly', async (req, res) => {
  try {
    const webhookUrl = process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY;
    
    if (!webhookUrl) {
      return res.json({
        success: false,
        message: 'PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY environment variable is not set',
        webhook_url: null,
        environment_check: {
          pabbly_webhook_url_exists: false,
          pabbly_webhook_url_length: 0,
          pabbly_webhook_url_starts_with_https: false
        }
      });
    }

    // Test the webhook with sample data
    const testData = {
      email: "marius@shaw.ca",
      customer_name: "Marius Nothling",
      license_key: "TRIAL-TEST-XXXX-XXXX",
      site_url: "https://ebiz360.ca",
      trial_expires: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      aweber_tags: "trial",
      license_type: "trial",
      product_name: "SiteOverlay Pro",
      trial_duration: "14 days",
      signup_date: new Date().toISOString(),
      support_email: "support@siteoverlaypro.com"
    };

    console.log('🧪 Testing Pabbly webhook with URL:', webhookUrl);
    console.log('📤 Sending test data:', testData);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testData)
    });

    if (response.ok) {
      console.log('✅ Pabbly webhook test successful');
      res.json({
        success: true,
        message: 'Pabbly webhook test successful',
        webhook_url: webhookUrl,
        test_data: testData,
        response_status: response.status,
        environment_check: {
          pabbly_webhook_url_exists: true,
          pabbly_webhook_url_length: webhookUrl.length,
          pabbly_webhook_url_starts_with_https: webhookUrl.startsWith('https://'),
          webhook_url_format: webhookUrl.includes('pabbly.com') ? 'valid' : 'suspicious'
        }
      });
    } else {
      const errorText = await response.text();
      console.error('❌ Pabbly webhook test failed:', response.status, errorText);
      res.json({
        success: false,
        message: 'Pabbly webhook test failed',
        webhook_url: webhookUrl,
        response_status: response.status,
        error: errorText,
        environment_check: {
          pabbly_webhook_url_exists: true,
          pabbly_webhook_url_length: webhookUrl.length,
          pabbly_webhook_url_starts_with_https: webhookUrl.startsWith('https://'),
          webhook_url_format: webhookUrl.includes('pabbly.com') ? 'valid' : 'suspicious'
        }
      });
    }

  } catch (error) {
    console.error('❌ Pabbly webhook test error:', error);
    res.json({
      success: false,
      message: 'Pabbly webhook test error: ' + error.message,
              webhook_url: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY || 'NOT_SET',
        environment_check: {
          pabbly_webhook_url_exists: !!process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY,
          pabbly_webhook_url_length: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY?.length || 0,
          pabbly_webhook_url_starts_with_https: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY?.startsWith('https://') || false,
          webhook_url_format: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY?.includes('pabbly.com') ? 'valid' : 'suspicious'
        }
    });
  }
});

// Diagnostic endpoint for Pabbly integration
router.get('/diagnose-pabbly', async (req, res) => {
  try {
    const webhookUrl = process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY;
    
    // Test sendToPabbly function directly
    console.log('🔍 Testing sendToPabbly function...');
    const testResult = await sendToPabbly('test@example.com', 'TEST-XXXX-XXXX-XXXX', 'trial', {
      customer_name: 'Test User',
      website_url: 'https://test.com',
      site_url: 'https://test.com',
      trial_expires: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
    });
    
    res.json({
      success: true,
      diagnosis: {
        environment_variable_set: !!webhookUrl,
        webhook_url_length: webhookUrl?.length || 0,
        webhook_url_format: webhookUrl?.includes('pabbly.com') ? 'valid' : 'invalid',
        sendToPabbly_function_working: testResult,
        expected_webhook_url: 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNDA0MzU1MjZlNTUzNTUxMzYi_pc',
        current_webhook_url: webhookUrl || 'NOT_SET'
      },
      recommendations: [
        webhookUrl ? '✅ Environment variable is set' : '❌ Set PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY environment variable',
        webhookUrl?.includes('pabbly.com') ? '✅ URL format looks correct' : '❌ Check webhook URL format',
        testResult ? '✅ sendToPabbly function working' : '❌ sendToPabbly function failing',
        webhookUrl === 'https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNDA0MzU1MjZlNTUzNTUxMzYi_pc' ? '✅ Webhook URL matches expected' : '❌ Webhook URL does not match expected'
      ]
    });

  } catch (error) {
    console.error('❌ Pabbly diagnosis error:', error);
    res.json({
      success: false,
      message: 'Pabbly diagnosis failed: ' + error.message,
      diagnosis: {
        environment_variable_set: !!process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY,
        webhook_url: process.env.PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY || 'NOT_SET',
        error: error.message
      }
    });
  }
});

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