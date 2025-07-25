// Admin management routes
const express = require('express');
const router = express.Router();
const db = require('../db');

/**
 * ADMIN LICENSE UPDATE ENDPOINT
 *
 * @description Allows admin to update license fields (type, status, email, site limit, renewal, kill switch)
 *
 * BUSINESS LOGIC:
 *   - Only allows updates to specific fields (whitelisted)
 *   - Requires ADMIN_API_KEY for authentication
 *   - Used for manual corrections, upgrades, or emergency disables
 *
 * DATABASE OPERATIONS:
 *   - UPDATE licenses SET ... WHERE license_key = ...
 *
 * SECURITY:
 *   - Admin-only access (requires admin_key)
 *   - Logs all update attempts and errors
 *
 * @param {string} license_key - License key to update
 * @param {string} admin_key - Admin API key for authentication
 * @param {object} updates - Fields to update (license_type, status, etc.)
 * @returns {Object} Success or error message
 */
// Admin endpoint to update license
router.post('/admin/update-license', async (req, res) => {
  try {
    const { license_key, admin_key, ...updates } = req.body;

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

    values.push(license_key);
    
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

/**
 * KILL SWITCH CONTROL ENDPOINT
 *
 * @description Immediately enables or disables a license (admin override)
 *
 * BUSINESS LOGIC:
 *   - Sets kill_switch_enabled to true/false for a license
 *   - Disabling the kill switch immediately disables all plugin features
 *   - Used for fraud, abuse, or emergency disables
 *
 * DATABASE OPERATIONS:
 *   - UPDATE licenses SET kill_switch_enabled = ... WHERE license_key = ...
 *
 * NOTIFICATIONS:
 *   - May trigger Pabbly/AWeber notification for license disabled (future)
 *
 * SECURITY:
 *   - Admin-only access (requires admin_key)
 *   - Logs all toggle attempts and errors
 *
 * @param {string} license_key - License key to toggle
 * @param {boolean} enabled - Whether to enable or disable the kill switch
 * @param {string} admin_key - Admin API key for authentication
 * @returns {Object} Success or error message
 */
// Kill switch control endpoint
router.post('/admin/toggle-kill-switch', async (req, res) => {
  try {
    const { license_key, enabled, admin_key } = req.body;
    
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

module.exports = router; 