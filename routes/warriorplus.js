// WarriorPlus payment processing routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { 
  getLicenseTypeFromWarriorPlusProduct,
  getSiteLimitFromLicenseType,
  generateLicenseKey
} = require('../utils/license-mappings');
const { sendToPabbly } = require('../utils/pabbly-utils');

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

module.exports = router; 