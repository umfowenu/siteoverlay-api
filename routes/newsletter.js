// Newsletter signup routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { generateLicenseKey } = require('../utils/license-mappings');
const { sendToPabbly } = require('../utils/pabbly-utils');

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
      email, licenseKey, 'newsletter', 'newsletter',
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

module.exports = router; 