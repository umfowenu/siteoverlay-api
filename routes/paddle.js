const express = require('express');
const router = express.Router();
const db = require('../db');
const crypto = require('crypto');
const { 
  generateLicenseKey,
  getSiteLimitFromLicenseType 
} = require('../utils/license-mappings');
const { sendPurchaseToPabbly } = require('../utils/pabbly-utils');

// Get Paddle mode from database (same pattern as Stripe)
async function getPaddleTestMode() {
  try {
    const result = await db.query('SELECT setting_value FROM system_settings WHERE setting_key = $1', ['PADDLE_TEST_MODE']);
    if (result.rows.length > 0) {
      return result.rows[0].setting_value === 'true';
    }
  } catch (error) {
    console.log('⚠️ Database read failed, using environment fallback');
  }
  return process.env.PADDLE_TEST_MODE === 'true';
}

// Verify Paddle webhook signature
function verifyPaddleSignature(body, signature, secret) {
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('Paddle signature verification error:', error);
    return false;
  }
}

// Map Paddle product IDs to license types
function getLicenseTypeFromPaddleProduct(productId, isTestMode) {
  const professionalId = isTestMode ? 
    process.env.PADDLE_PRODUCT_ID_PROFESSIONAL_SANDBOX : 
    process.env.PADDLE_PRODUCT_ID_PROFESSIONAL_LIVE;
  
  const annualId = isTestMode ? 
    process.env.PADDLE_PRODUCT_ID_ANNUAL_SANDBOX : 
    process.env.PADDLE_PRODUCT_ID_ANNUAL_LIVE;
  
  const lifetimeId = isTestMode ? 
    process.env.PADDLE_PRODUCT_ID_LIFETIME_SANDBOX : 
    process.env.PADDLE_PRODUCT_ID_LIFETIME_LIVE;

  if (productId === professionalId) return 'professional';
  if (productId === annualId) return 'annual';
  if (productId === lifetimeId) return 'lifetime';
  
  console.warn(`Unknown Paddle product ID: ${productId}`);
  return 'professional'; // Default fallback
}

// Paddle webhook handler
router.post('/paddle/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const isTestMode = await getPaddleTestMode();
    const webhookSecret = isTestMode ? 
      process.env.PADDLE_WEBHOOK_SECRET_SANDBOX : 
      process.env.PADDLE_WEBHOOK_SECRET_LIVE;
    
    // Verify Paddle webhook signature
    const signature = req.headers['paddle-signature'];
    const body = req.body.toString();
    
    if (!verifyPaddleSignature(body, signature, webhookSecret)) {
      console.error('❌ Paddle webhook signature verification failed');
      return res.status(400).json({error: 'Invalid signature'});
    }
    
    const event = JSON.parse(body);
    console.log(`🏛️ Paddle webhook verified (${isTestMode ? 'SANDBOX' : 'LIVE'}):`, event.event_type);
    
    switch (event.event_type) {
      case 'subscription_created':
        await handlePaddleSubscriptionCreated(event.data);
        break;
      case 'subscription_payment_succeeded':
        await handlePaddlePaymentSucceeded(event.data);
        break;
      case 'subscription_cancelled':
        await handlePaddleSubscriptionCancelled(event.data);
        break;
      case 'payment_succeeded':
        await handlePaddleOneTimePayment(event.data);
        break;
      default:
        console.log(`ℹ️ Unhandled Paddle event: ${event.event_type}`);
    }
    
    res.status(200).json({status: 'success'});
  } catch (error) {
    console.error('❌ Paddle webhook error:', error);
    res.status(500).json({error: 'Paddle webhook failed'});
  }
});

// Handle Paddle subscription creation
async function handlePaddleSubscriptionCreated(data) {
  try {
    console.log('🏛️ Processing Paddle subscription creation:', data.subscription_id);
    
    const isTestMode = await getPaddleTestMode();
    const licenseType = getLicenseTypeFromPaddleProduct(data.product_id, isTestMode);
    const siteLimit = getSiteLimitFromLicenseType(licenseType);
    const licenseKey = generateLicenseKey();
    
    // Calculate renewal date
    let renewalDate = null;
    if (data.next_payment && data.next_payment.date) {
      renewalDate = new Date(data.next_payment.date);
    }
    
    // Store license in database
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        site_limit, subscription_id, created_at, renewal_date, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8, $9, $10)
    `, [
      licenseKey,
      licenseType,
      'active',
      data.user_email,
      data.user_name || 'Paddle Customer',
      siteLimit,
      data.subscription_id,
      renewalDate,
      'paddle',
      'Subscription created via Paddle'
    ]);
    
    // Send to Pabbly (respecting test mode settings)
    const allowEmailsInTestMode = process.env.PADDLE_TEST_MODE_ALLOW_EMAILS === 'true';
    if (!isTestMode || (isTestMode && allowEmailsInTestMode)) {
      await sendPurchaseToPabbly(data.user_email, licenseType, {
        customer_name: data.user_name || 'Paddle Customer',
        next_renewal: renewalDate ? renewalDate.toISOString().split('T')[0] : 'Subscription'
      });
      console.log(`✅ Paddle subscription data sent to Pabbly (${isTestMode ? 'SANDBOX with emails' : 'LIVE'})`);
    } else {
      console.log('🏛️ Sandbox mode: Skipping Pabbly webhook (no emails sent)');
    }
    
    console.log('✅ Paddle subscription processed:', licenseKey);
    
  } catch (error) {
    console.error('❌ Paddle subscription creation error:', error);
  }
}

// Handle Paddle payment success
async function handlePaddlePaymentSucceeded(data) {
  try {
    console.log('🏛️ Processing Paddle payment success:', data.payment_id || data.order_id);
    
    // Update renewal date for existing subscription
    if (data.subscription_id) {
      let renewalDate = null;
      if (data.next_payment && data.next_payment.date) {
        renewalDate = new Date(data.next_payment.date);
      }
      
      await db.query(`
        UPDATE licenses 
        SET renewal_date = $1, updated_at = NOW(), notes = CONCAT(COALESCE(notes, ''), '; Payment renewed via Paddle')
        WHERE subscription_id = $2
      `, [renewalDate, data.subscription_id]);
      
      console.log('✅ Paddle subscription renewed:', data.subscription_id);
    }
    
  } catch (error) {
    console.error('❌ Paddle payment success error:', error);
  }
}

// Handle Paddle one-time payment (for lifetime licenses)
async function handlePaddleOneTimePayment(data) {
  try {
    console.log('🏛️ Processing Paddle one-time payment:', data.order_id);
    
    const isTestMode = await getPaddleTestMode();
    const licenseType = getLicenseTypeFromPaddleProduct(data.product_id, isTestMode);
    const siteLimit = getSiteLimitFromLicenseType(licenseType);
    const licenseKey = generateLicenseKey();
    
    // Store license in database (no renewal date for one-time payments)
    await db.query(`
      INSERT INTO licenses (
        license_key, license_type, status, customer_email, customer_name,
        site_limit, created_at, payment_processor, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8)
    `, [
      licenseKey,
      licenseType,
      'active',
      data.email,
      data.customer_name || 'Paddle Customer',
      siteLimit,
      'paddle',
      'One-time payment via Paddle'
    ]);
    
    // Send to Pabbly (respecting test mode settings)
    const allowEmailsInTestMode = process.env.PADDLE_TEST_MODE_ALLOW_EMAILS === 'true';
    if (!isTestMode || (isTestMode && allowEmailsInTestMode)) {
      await sendPurchaseToPabbly(data.email, licenseType, {
        customer_name: data.customer_name || 'Paddle Customer',
        next_renewal: 'One-time payment'
      });
      console.log(`✅ Paddle payment data sent to Pabbly (${isTestMode ? 'SANDBOX with emails' : 'LIVE'})`);
    } else {
      console.log('🏛️ Sandbox mode: Skipping Pabbly webhook (no emails sent)');
    }
    
    console.log('✅ Paddle one-time payment processed:', licenseKey);
    
  } catch (error) {
    console.error('❌ Paddle one-time payment error:', error);
  }
}

// Handle Paddle subscription cancellation
async function handlePaddleSubscriptionCancelled(data) {
  try {
    console.log('🏛️ Processing Paddle subscription cancellation:', data.subscription_id);
    
    // Mark license as inactive
    await db.query(`
      UPDATE licenses 
      SET status = 'inactive', updated_at = NOW(), notes = CONCAT(COALESCE(notes, ''), '; Subscription cancelled via Paddle')
      WHERE subscription_id = $1
    `, [data.subscription_id]);
    
    console.log('✅ Paddle subscription cancelled:', data.subscription_id);
    
  } catch (error) {
    console.error('❌ Paddle subscription cancellation error:', error);
  }
}

module.exports = router;