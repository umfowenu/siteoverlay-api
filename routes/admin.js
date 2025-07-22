// Admin management routes
const express = require('express');
const router = express.Router();
const db = require('../db');

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