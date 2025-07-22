// PayPal payment processing routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { 
  getLicenseTypeFromPayPalAmount,
  getSiteLimitFromLicenseType,
  generateLicenseKey
} = require('../utils/license-mappings');
const { sendToPabbly } = require('../utils/pabbly-utils');

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

module.exports = router; 