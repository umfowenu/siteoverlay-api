const db = require('../../../db');

class CustomerController {
  static async getCustomerData(req, res) {
    try {
      const { customer_email } = req.body;

      // Get all licenses for customer
      const licenses = await db.query(`
        SELECT * FROM licenses 
        WHERE customer_email = $1 
        ORDER BY created_at DESC
      `, [customer_email]);

      // Get all site usage for customer
      const sites = await db.query(`
        SELECT * FROM site_usage 
        WHERE customer_email = $1 
        ORDER BY created_at DESC
      `, [customer_email]);

      // Get purchase history if table exists
      let purchases = { rows: [] };
      try {
        purchases = await db.query(`
          SELECT * FROM purchase_history 
          WHERE customer_email = $1 
          ORDER BY purchase_date DESC
        `, [customer_email]);
      } catch (e) {
        // Table might not exist, that's okay
      }

      // Calculate customer stats
      const totalSpent = licenses.rows.reduce((sum, license) => 
        sum + (parseFloat(license.amount_paid) || 0), 0);
      const activeLicenses = licenses.rows.filter(l => l.status === 'active').length;
      const totalSites = sites.rows.length;

      res.json({
        success: true,
        customer: {
          email: customer_email,
          name: licenses.rows[0]?.customer_name || 'Unknown',
          total_spent: totalSpent,
          active_licenses: activeLicenses,
          total_sites: totalSites,
          first_purchase: licenses.rows[licenses.rows.length - 1]?.created_at,
          last_activity: Math.max(
            ...licenses.rows.map(l => new Date(l.created_at).getTime()),
            ...sites.rows.map(s => new Date(s.created_at).getTime())
          )
        },
        licenses: licenses.rows,
        sites: sites.rows,
        purchases: purchases.rows
      });
    } catch (error) {
      console.error('Customer data error:', error);
      res.status(500).json({ success: false, error: 'Failed to load customer data' });
    }
  }

  static async killCustomerLicenses(req, res) {
    try {
      const { customer_email, action } = req.body;
      const enabled = action === 'enable';
      
      const result = await db.query(`
        UPDATE licenses 
        SET kill_switch_enabled = $1, updated_at = NOW()
        WHERE customer_email = $2
        RETURNING license_key
      `, [enabled, customer_email]);

      res.json({ 
        success: true, 
        message: `Kill switch ${enabled ? 'enabled' : 'disabled'} for ${result.rowCount} licenses`,
        affected_licenses: result.rows.map(r => r.license_key)
      });
    } catch (error) {
      console.error('Kill customer licenses error:', error);
      res.status(500).json({ success: false, error: 'Customer kill switch failed' });
    }
  }
}

module.exports = CustomerController; 