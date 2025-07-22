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

// (All old utility function definitions are now removed from the bottom of the file, only initializeDatabase and module.exports = router remain)

// Payment processor integrations
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'SiteOverlay Pro API by eBiz360',
    timestamp: new Date().toISOString()
  });
});

// Register route modules
router.use('/', trialsRoutes);
router.use('/', newsletterRoutes);
router.use('/', adminRoutes);

// ============================================================================
// STRIPE WEBHOOK HANDLING
// ============================================================================

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
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }

    res.json({received: true});
  } catch (error) {
    console.error('❌ Stripe webhook handling error:', error);
    res.status(500).json({error: 'Webhook handling failed'});
  }
});

// ============================================================================
// PAYPAL WEBHOOK HANDLING
// ============================================================================

router.post('/paypal/webhook', express.json(), async (req, res) => {
  try {
    console.log('🎯 PayPal webhook received:', req.body.event_type);

    const event = req.body;
    
    // Verify PayPal webhook signature (implement based on PayPal docs)
    // For now, we'll process without verification (add verification in production)

    switch (event.event_type) {
      case 'PAYMENT.SALE.COMPLETED':
        await handlePayPalPayment(event.resource);
        break;
      case 'BILLING.SUBSCRIPTION.CREATED':
        await handlePayPalSubscriptionCreated(event.resource);
        break;
      case 'BILLING.SUBSCRIPTION.CANCELLED':
        await handlePayPalSubscriptionCancelled(event.resource);
        break;
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED':
        await handlePayPalPaymentFailed(event.resource);
        break;
      default:
        console.log(`Unhandled PayPal event: ${event.event_type}`);
    }

    res.status(200).json({status: 'success'});
  } catch (error) {
    console.error('❌ PayPal webhook error:', error);
    res.status(500).json({error: 'PayPal webhook failed'});
  }
});

// ============================================================================
// WARRIORPLUS IPN HANDLING
// ============================================================================

router.post('/warriorplus/ipn', express.urlencoded({extended: true}), async (req, res) => {
  try {
    console.log('⚔️ WarriorPlus IPN received:', req.body);

    // Verify IPN with WarriorPlus (implement verification)
    // For now, we'll process without verification (add verification in production)

    const ipnData = req.body;

    switch (ipnData.transaction_type) {
      case 'SALE':
        await handleWarriorPlusSale(ipnData);
        break;
      case 'REFUND':
        await handleWarriorPlusRefund(ipnData);
        break;
      case 'REBILL':
        await handleWarriorPlusRebill(ipnData);
        break;
      case 'CANCEL':
        await handleWarriorPlusCancel(ipnData);
        break;
      default:
        console.log(`Unhandled WarriorPlus transaction: ${ipnData.transaction_type}`);
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('❌ WarriorPlus IPN error:', error);
    res.status(500).send('Error');
  }
});

// ============================================================================
// STRIPE WEBHOOK HANDLERS
// ============================================================================

async function handleCheckoutCompleted(session) {
  try {
    console.log('💳 Processing Stripe checkout completion:', session.id);

    const customer = await stripe.customers.retrieve(session.customer);
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const priceId = lineItems.data[0]?.price?.id;

    // Determine license type from price ID
    const licenseType = getLicenseTypeFromStripePrice(priceId);
    const siteLimit = getSiteLimitFromLicenseType(licenseType);
    
    // Calculate renewal date
    let renewalDate = null;
    if (licenseType.includes('annual')) {
      renewalDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    }

    // Generate license key
    const licenseKey = generateLicenseKey();

    // Insert license
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
      licenseType,
      'active',
      customer.email,
      customer.name || session.customer_details?.name || 'Stripe Customer',
      new Date(),
      renewalDate,
      session.subscription || null,
      session.subscription ? 'active' : null,
      priceId,
      session.amount_total / 100, // Convert from cents
      'stripe',
      'stripe_checkout',
      siteLimit,
      true,
      true
    ]);

    // Record purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, stripe_session_id, stripe_price_id, amount_paid,
        purchase_date, renewal_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      licenseResult.rows[0].id,
      customer.email,
      'purchase',
      licenseType,
      licenseKey,
      session.id,
      priceId,
      session.amount_total / 100,
      new Date(),
      renewalDate,
      'stripe',
      'Initial purchase via Stripe checkout'
    ]);

    // Send to Pabbly/AWeber
    await sendToPabbly(customer.email, licenseKey, licenseType, {
      customer_name: customer.name || session.customer_details?.name,
      purchase_amount: (session.amount_total / 100).toString(),
      currency: session.currency?.toUpperCase() || 'USD',
      payment_processor: 'stripe',
      renewal_date: renewalDate
    });

    console.log('✅ Stripe purchase processed:', licenseKey);

  } catch (error) {
    console.error('❌ Stripe checkout handling error:', error);
  }
}

async function handleSubscriptionPayment(invoice) {
  try {
    console.log('🔄 Processing Stripe subscription payment:', invoice.id);

    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    const customer = await stripe.customers.retrieve(subscription.customer);

    // Find existing license
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE subscription_id = $1',
      [subscription.id]
    );

    if (licenseResult.rows.length > 0) {
      const license = licenseResult.rows[0];
      
      // Update renewal date
      const newRenewalDate = new Date(subscription.current_period_end * 1000);
      
      await db.query(
        'UPDATE licenses SET renewal_date = $1, subscription_status = $2 WHERE id = $3',
        [newRenewalDate, subscription.status, license.id]
      );

      // Record renewal in purchase history
      await db.query(`
        INSERT INTO purchase_history (
          license_id, customer_email, transaction_type, new_license_type,
          new_license_key, stripe_subscription_id, amount_paid, purchase_date,
          renewal_date, payment_processor, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        license.id,
        customer.email,
        'renewal',
        license.license_type,
        license.license_key,
        subscription.id,
        invoice.amount_paid / 100,
        new Date(),
        newRenewalDate,
        'stripe',
        'Subscription renewal payment'
      ]);

      console.log('✅ Subscription renewal processed:', license.license_key);
    }

  } catch (error) {
    console.error('❌ Subscription payment handling error:', error);
  }
}

async function handleSubscriptionUpdated(subscription) {
  try {
    console.log('🔄 Processing subscription update:', subscription.id);

    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE subscription_id = $1',
      [subscription.id]
    );

    if (licenseResult.rows.length > 0) {
      const license = licenseResult.rows[0];
      const newRenewalDate = new Date(subscription.current_period_end * 1000);

      // Handle plan changes (upgrades/downgrades)
      const currentPriceId = subscription.items.data[0]?.price?.id;
      const newLicenseType = getLicenseTypeFromStripePrice(currentPriceId);

      if (newLicenseType !== license.license_type) {
        // This is a plan change
        await db.query(`
          UPDATE licenses SET 
            license_type = $1, 
            renewal_date = $2, 
            subscription_status = $3,
            stripe_price_id = $4
          WHERE id = $5
        `, [newLicenseType, newRenewalDate, subscription.status, currentPriceId, license.id]);

        // Record plan change
        await db.query(`
          INSERT INTO purchase_history (
            license_id, customer_email, transaction_type, old_license_type,
            new_license_type, new_license_key, stripe_subscription_id,
            purchase_date, renewal_date, payment_processor, notes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
          license.id,
          license.customer_email,
          newLicenseType > license.license_type ? 'upgrade' : 'downgrade',
          license.license_type,
          newLicenseType,
          license.license_key,
          subscription.id,
          new Date(),
          newRenewalDate,
          'stripe',
          `Plan changed from ${license.license_type} to ${newLicenseType}`
        ]);
      } else {
        // Just update renewal date and status
        await db.query(
          'UPDATE licenses SET renewal_date = $1, subscription_status = $2 WHERE id = $3',
          [newRenewalDate, subscription.status, license.id]
        );
      }

      console.log('✅ Subscription update processed:', license.license_key);
    }

  } catch (error) {
    console.error('❌ Subscription update handling error:', error);
  }
}

async function handleSubscriptionCancelled(subscription) {
  try {
    console.log('❌ Processing subscription cancellation:', subscription.id);

    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE subscription_id = $1',
      [subscription.id]
    );

    if (licenseResult.rows.length > 0) {
      const license = licenseResult.rows[0];

      await db.query(
        'UPDATE licenses SET subscription_status = $1 WHERE id = $2',
        ['cancelled', license.id]
      );

      // Record cancellation
      await db.query(`
        INSERT INTO purchase_history (
          license_id, customer_email, transaction_type, new_license_type,
          new_license_key, stripe_subscription_id, purchase_date,
          payment_processor, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        license.id,
        license.customer_email,
        'cancellation',
        license.license_type,
        license.license_key,
        subscription.id,
        new Date(),
        'stripe',
        'Subscription cancelled'
      ]);

      console.log('✅ Subscription cancellation processed:', license.license_key);
    }

  } catch (error) {
    console.error('❌ Subscription cancellation handling error:', error);
  }
}

async function handlePaymentSucceeded(paymentIntent) {
  console.log('💰 Payment succeeded:', paymentIntent.id);
  // Additional processing if needed
}

async function handlePaymentFailed(invoice) {
  console.log('💥 Payment failed:', invoice.id);
  // Handle failed payment (notify customer, etc.)
}

// ============================================================================
// PAYPAL WEBHOOK HANDLERS
// ============================================================================

async function handlePayPalPayment(payment) {
  try {
    console.log('💰 Processing PayPal payment:', payment.id);

    // Extract customer info from PayPal payment
    const customerEmail = payment.payer?.payer_info?.email;
    const customerName = payment.payer?.payer_info?.first_name + ' ' + payment.payer?.payer_info?.last_name;
    const amount = parseFloat(payment.amount?.total);

    // Determine license type from PayPal custom field or amount
    const licenseType = getLicenseTypeFromPayPalAmount(amount);
    const siteLimit = getSiteLimitFromLicenseType(licenseType);

    // Calculate renewal date
    let renewalDate = null;
    if (licenseType.includes('annual')) {
      renewalDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }

    const licenseKey = generateLicenseKey();

    // Insert license
    const licenseResult = await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_date, renewal_date, paypal_transaction_id, amount_paid,
        payment_processor, purchase_source, site_limit, kill_switch_enabled,
        resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING id
    `, [
      licenseKey, licenseType, 'active', customerEmail, customerName,
      new Date(), renewalDate, payment.id, amount, 'paypal',
      'paypal_payment', siteLimit, true, true
    ]);

    // Record purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, paypal_transaction_id, amount_paid, purchase_date,
        renewal_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      licenseResult.rows[0].id, customerEmail, 'purchase', licenseType,
      licenseKey, payment.id, amount, new Date(), renewalDate, 'paypal',
      'PayPal payment processed'
    ]);

    // Send to Pabbly/AWeber
    await sendToPabbly(customerEmail, licenseKey, licenseType, {
      customer_name: customerName,
      purchase_amount: amount.toString(),
      currency: payment.amount?.currency || 'USD',
      payment_processor: 'paypal',
      renewal_date: renewalDate
    });

    console.log('✅ PayPal purchase processed:', licenseKey);

  } catch (error) {
    console.error('❌ PayPal payment handling error:', error);
  }
}

async function handlePayPalSubscriptionCreated(subscription) {
  console.log('🔄 PayPal subscription created:', subscription.id);
  // Handle PayPal subscription creation
}

async function handlePayPalSubscriptionCancelled(subscription) {
  console.log('❌ PayPal subscription cancelled:', subscription.id);
  // Handle PayPal subscription cancellation
}

async function handlePayPalPaymentFailed(payment) {
  console.log('💥 PayPal payment failed:', payment.id);
  // Handle PayPal payment failure
}

// ============================================================================
// WARRIORPLUS IPN HANDLERS
// ============================================================================

async function handleWarriorPlusSale(ipnData) {
  try {
    console.log('⚔️ Processing WarriorPlus sale:', ipnData.transaction_id);

    const customerEmail = ipnData.buyer_email;
    const customerName = ipnData.buyer_name;
    const amount = parseFloat(ipnData.amount);
    const productId = ipnData.product_id;

    // Determine license type from WarriorPlus product ID
    const licenseType = getLicenseTypeFromWarriorPlusProduct(productId);
    const siteLimit = getSiteLimitFromLicenseType(licenseType);

    // Calculate renewal date
    let renewalDate = null;
    if (licenseType.includes('annual')) {
      renewalDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    }

    const licenseKey = generateLicenseKey();

    // Insert license
    const licenseResult = await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        purchase_date, renewal_date, warriorplus_transaction_id, 
        warriorplus_product_id, affiliate_id, affiliate_commission,
        amount_paid, payment_processor, purchase_source, site_limit,
        kill_switch_enabled, resale_monitoring, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
      RETURNING id
    `, [
      licenseKey, licenseType, 'active', customerEmail, customerName,
      new Date(), renewalDate, ipnData.transaction_id, productId,
      ipnData.affiliate_id || null, ipnData.affiliate_commission || null,
      amount, 'warriorplus', 'warriorplus_sale', siteLimit, true, true
    ]);

    // Record purchase history
    await db.query(`
      INSERT INTO purchase_history (
        license_id, customer_email, transaction_type, new_license_type,
        new_license_key, warriorplus_transaction_id, warriorplus_product_id,
        amount_paid, purchase_date, renewal_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      licenseResult.rows[0].id, customerEmail, 'purchase', licenseType,
      licenseKey, ipnData.transaction_id, productId, amount, new Date(),
      renewalDate, 'warriorplus', 'WarriorPlus sale processed'
    ]);

    // Send to Pabbly/AWeber
    await sendToPabbly(customerEmail, licenseKey, licenseType, {
      customer_name: customerName,
      purchase_amount: amount.toString(),
      currency: 'USD',
      payment_processor: 'warriorplus',
      renewal_date: renewalDate,
      affiliate_id: ipnData.affiliate_id
    });

    console.log('✅ WarriorPlus sale processed:', licenseKey);

  } catch (error) {
    console.error('❌ WarriorPlus sale handling error:', error);
  }
}

async function handleWarriorPlusRefund(ipnData) {
  try {
    console.log('💸 Processing WarriorPlus refund:', ipnData.transaction_id);

    // Find license by transaction ID
    const licenseResult = await db.query(
      'SELECT * FROM licenses WHERE warriorplus_transaction_id = $1',
      [ipnData.original_transaction_id || ipnData.transaction_id]
    );

    if (licenseResult.rows.length > 0) {
      const license = licenseResult.rows[0];

      // Deactivate license
      await db.query(
        'UPDATE licenses SET status = $1, kill_switch_enabled = $2 WHERE id = $3',
        ['refunded', true, license.id]
      );

      // Record refund
      await db.query(`
        INSERT INTO purchase_history (
          license_id, customer_email, transaction_type, new_license_type,
          new_license_key, warriorplus_transaction_id, amount_paid,
          purchase_date, payment_processor, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        license.id, license.customer_email, 'refund', license.license_type,
        license.license_key, ipnData.transaction_id, 
        -parseFloat(ipnData.amount || 0), new Date(), 'warriorplus',
        'WarriorPlus refund processed'
      ]);

      console.log('✅ WarriorPlus refund processed:', license.license_key);
    }

  } catch (error) {
    console.error('❌ WarriorPlus refund handling error:', error);
  }
}

async function handleWarriorPlusRebill(ipnData) {
  console.log('🔄 WarriorPlus rebill:', ipnData.transaction_id);
  // Handle recurring billing
}

async function handleWarriorPlusCancel(ipnData) {
  console.log('❌ WarriorPlus cancellation:', ipnData.transaction_id);
  // Handle subscription cancellation
}

// ============================================================================
// LICENSE VALIDATION AND MANAGEMENT
// ============================================================================

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