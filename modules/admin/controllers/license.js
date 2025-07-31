const db = require('../../../db');

class LicenseController {
  static async search(req, res) {
    try {
      const { query, type, limit = 50 } = req.body;
      let searchQuery = '';
      let params = [];

      switch (type) {
        case 'email':
          searchQuery = 'WHERE customer_email ILIKE $1';
          params = [`%${query}%`];
          break;
        case 'license':
          searchQuery = 'WHERE license_key ILIKE $1';
          params = [`%${query}%`];
          break;
        case 'domain':
          const siteResults = await db.query(`
            SELECT DISTINCT l.* 
            FROM licenses l 
            JOIN site_usage su ON l.license_key = su.license_key 
            WHERE su.site_domain ILIKE $1
            ORDER BY l.created_at DESC
            LIMIT $2
          `, [`%${query}%`, limit]);
          return res.json({ success: true, licenses: siteResults.rows });
        default:
          searchQuery = 'WHERE customer_email ILIKE $1 OR customer_name ILIKE $1 OR license_key ILIKE $1';
          params = [`%${query}%`];
      }

      const results = await db.query(`
        SELECT * FROM licenses ${searchQuery} 
        ORDER BY created_at DESC 
        LIMIT $${params.length + 1}
      `, [...params, limit]);

      res.json({ success: true, licenses: results.rows });
    } catch (error) {
      console.error('License search error:', error);
      res.status(500).json({ success: false, error: 'Search failed' });
    }
  }

  static async toggleKillSwitch(req, res) {
    try {
      const { license_key, action } = req.body;
      const enabled = action === 'enable';
      
      const result = await db.query(`
        UPDATE licenses 
        SET kill_switch_enabled = $1, updated_at = NOW()
        WHERE license_key = $2
        RETURNING license_key, kill_switch_enabled
      `, [enabled, license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'License not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `Kill switch ${enabled ? 'enabled' : 'disabled'} for license ${license_key}`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Kill switch error:', error);
      res.status(500).json({ success: false, error: 'Kill switch operation failed' });
    }
  }

  static async updateInstalls(req, res) {
    try {
      const { license_key, new_limit } = req.body;
      
      const result = await db.query(`
        UPDATE licenses 
        SET site_limit = $1, updated_at = NOW()
        WHERE license_key = $2
        RETURNING license_key, site_limit
      `, [new_limit, license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'License not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `Updated license ${license_key} to ${new_limit === -1 ? 'unlimited' : new_limit} installs`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Update installs error:', error);
      res.status(500).json({ success: false, error: 'Install limit update failed' });
    }
  }

  static async extendTrial(req, res) {
    try {
      const { license_key, days } = req.body;
      
      const result = await db.query(`
        UPDATE licenses 
        SET trial_end_date = COALESCE(trial_end_date, NOW()) + INTERVAL '${days} days',
            updated_at = NOW()
        WHERE license_key = $1 AND license_type = 'trial'
        RETURNING license_key, trial_end_date
      `, [license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'Trial license not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `Extended trial ${license_key} by ${days} days`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Extend trial error:', error);
      res.status(500).json({ success: false, error: 'Trial extension failed' });
    }
  }

  static async convertToLifetime(req, res) {
    try {
      const { license_key } = req.body;
      
      const result = await db.query(`
        UPDATE licenses 
        SET license_type = 'lifetime_unlimited', 
            site_limit = -1, 
            renewal_date = NULL,
            status = 'active',
            kill_switch_enabled = true,
            updated_at = NOW()
        WHERE license_key = $1
        RETURNING *
      `, [license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'License not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `Converted license ${license_key} to lifetime unlimited`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Convert lifetime error:', error);
      res.status(500).json({ success: false, error: 'Lifetime conversion failed' });
    }
  }

  static async enableLicense(req, res) {
    try {
      const { license_key } = req.body;
      
      const result = await db.query(`
        UPDATE licenses 
        SET status = 'active', 
            kill_switch_enabled = true,
            updated_at = NOW()
        WHERE license_key = $1
        RETURNING *
      `, [license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'License not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `Re-enabled license ${license_key}`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Enable license error:', error);
      res.status(500).json({ success: false, error: 'License enable failed' });
    }
  }
}

module.exports = LicenseController; 