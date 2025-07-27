// Stripe payment processing routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { 
  getLicenseTypeFromStripePrice,
  getSiteLimitFromLicenseType,
  generateLicenseKey
} = require('../utils/license-mappings');
const { sendToPabbly, sendPurchaseToPabbly } = require('../utils/pabbly-utils');

// Payment processor integrations
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    // Send purchase data to Pabbly/AWeber
    await sendPurchaseToPabbly(customer.email, licenseType, {
      customer_name: customer.name || session.customer_details?.name,
      next_renewal: renewalDate ? renewalDate.toISOString().split('T')[0] : 'Never'
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
// TEST ENDPOINTS (TEMPORARY - FOR TESTING ONLY)
// ============================================================================

router.post('/test-purchase-webhook', async (req, res) => {
  try {
    const { sendPurchaseToPabbly } = require('../utils/pabbly-utils');
    
    // Send mock data with EXACT values for Pabbly mapping
    const result = await sendPurchaseToPabbly('marius@shaw.ca', 'professional_5site', {
      customer_name: 'Marius Nothing',
      next_renewal: '2025-12-31'
    });
    
    if (result) {
      res.json({ 
        success: true, 
        message: 'Mock purchase data sent to Pabbly webhook successfully',
        data: {
          email: 'marius@shaw.ca',
          customer_name: 'Marius Nothing',
          license_type: 'professional_5site',
          next_renewal: '2025-12-31',
          aweber_tags: 'subscription-active'
        }
      });
    } else {
      res.json({ 
        success: false, 
        message: 'Failed to send to Pabbly webhook' 
      });
    }
    
  } catch (error) {
    console.error('❌ Test webhook error:', error);
    res.json({ 
      success: false, 
      message: 'Error sending test data',
      error: error.message 
    });
  }
});

router.post('/test-license-install-webhook', async (req, res) => {
  try {
    // Mock license install data (Stage 2 of purchase flow)
    const mockLicenseData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothling',
      installs_remaining: '4',
      sites_active: '1', 
      site_url: 'https://test-customer-site.com',
      sales_page: 'https://siteoverlay.24hr.pro',
      license_key: 'SITE-A1B2-C3D4-E5F6'
    };

    // Send to new license install webhook
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockLicenseData)
      });

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Mock license install data sent to Pabbly webhook successfully',
          data: mockLicenseData
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

// GET version for browser testing
router.get('/test-license-install-webhook', async (req, res) => {
  try {
    // Mock license install data (Stage 2 of purchase flow)
    const mockLicenseData = {
      email: 'marius@shaw.ca',
      customer_name: 'Marius Nothling',
      installs_remaining: '4',
      sites_active: '1', 
      site_url: 'https://test-customer-site.com',
      sales_page: 'https://siteoverlay.24hr.pro',
      license_key: 'SITE-A1B2-C3D4-E5F6'
    };

    // Send to new license install webhook
    if (process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL_LICENSE_INSTALL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockLicenseData)
      });

      if (response.ok) {
        res.json({ 
          success: true, 
          message: 'Mock license install data sent to Pabbly webhook successfully',
          data: mockLicenseData
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

module.exports = router; 