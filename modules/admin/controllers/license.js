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

  static async getAllPurchasers(req, res) {
    try {
      console.log('🔍 DEBUG: getAllPurchasers called');
      const { sort_by = 'created_at', sort_order = 'desc' } = req.query;
      console.log('🔍 DEBUG: Sort params:', { sort_by, sort_order });
      
      // Validate sort column to prevent SQL injection
      const validColumns = [
        'license_key', 'license_type', 'customer_email', 'customer_name', 
        'status', 'created_at', 'amount_paid', 'renewal_date', 'site_limit',
        'kill_switch_enabled', 'subscription_status'
      ];
      
      const sortColumn = validColumns.includes(sort_by) ? sort_by : 'created_at';
      const sortDirection = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      console.log('🔍 DEBUG: Executing query with filter: license_type != trial');
      const purchasers = await db.query(`
        SELECT 
          license_key, license_type, customer_email, customer_name,
          status, kill_switch_enabled, created_at, renewal_date,
          amount_paid, site_limit, subscription_status, subscription_id,
          trial_end_date, stripe_price_id
        FROM licenses 
        WHERE license_type != 'trial'
        ORDER BY ${sortColumn} ${sortDirection}
      `);

      console.log('🔍 DEBUG: Found purchasers:', purchasers.rows.length);
      purchasers.rows.forEach(p => {
        console.log(`🔍 DEBUG: Purchaser - ${p.customer_email} (${p.license_type}) - ${p.customer_name}`);
      });

      // Get site usage counts for each license
      const licenseKeys = purchasers.rows.map(p => p.license_key);
      let siteUsage = { rows: [] };
      
      if (licenseKeys.length > 0) {
        console.log('🔍 DEBUG: Getting site usage for licenses:', licenseKeys);
        siteUsage = await db.query(`
          SELECT license_key, COUNT(*) as sites_used
          FROM site_usage 
          WHERE license_key = ANY($1)
          GROUP BY license_key
        `, [licenseKeys]);
        console.log('🔍 DEBUG: Site usage results:', siteUsage.rows);
      }

      // Merge site usage data
      const siteUsageMap = {};
      siteUsage.rows.forEach(su => {
        siteUsageMap[su.license_key] = parseInt(su.sites_used);
      });

      const enrichedPurchasers = purchasers.rows.map(p => ({
        ...p,
        sites_used: siteUsageMap[p.license_key] || 0
      }));

      console.log('🔍 DEBUG: Returning enriched purchasers:', enrichedPurchasers.length);
      res.json({
        success: true,
        purchasers: enrichedPurchasers,
        total: enrichedPurchasers.length,
        sort_by: sortColumn,
        sort_order: sortDirection.toLowerCase()
      });
    } catch (error) {
      console.error('Get all purchasers error:', error);
      res.status(500).json({ success: false, error: 'Failed to load purchasers' });
    }
  }

  static async getAllTrials(req, res) {
    try {
      const { sort_by = 'created_at', sort_order = 'desc' } = req.query;
      
      const validColumns = [
        'license_key', 'customer_email', 'customer_name', 'status',
        'created_at', 'trial_end_date', 'kill_switch_enabled'
      ];
      
      const sortColumn = validColumns.includes(sort_by) ? sort_by : 'created_at';
      const sortDirection = sort_order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

      const trials = await db.query(`
        SELECT 
          license_key, customer_email, customer_name, status,
          kill_switch_enabled, created_at, trial_end_date,
          CASE 
            WHEN trial_end_date > NOW() THEN 'active'
            WHEN trial_end_date <= NOW() THEN 'expired'
            ELSE 'unknown'
          END as trial_status,
          EXTRACT(DAYS FROM (trial_end_date - NOW())) as days_remaining
        FROM licenses 
        WHERE license_type = 'trial'
        ORDER BY ${sortColumn} ${sortDirection}
      `);

      // Get site usage for trials
      const licenseKeys = trials.rows.map(t => t.license_key);
      let siteUsage = { rows: [] };
      
      if (licenseKeys.length > 0) {
        siteUsage = await db.query(`
          SELECT license_key, COUNT(*) as sites_used
          FROM site_usage 
          WHERE license_key = ANY($1)
          GROUP BY license_key
        `, [licenseKeys]);
      }

      const siteUsageMap = {};
      siteUsage.rows.forEach(su => {
        siteUsageMap[su.license_key] = parseInt(su.sites_used);
      });

      const enrichedTrials = trials.rows.map(t => ({
        ...t,
        sites_used: siteUsageMap[t.license_key] || 0,
        days_remaining: Math.max(0, Math.floor(t.days_remaining || 0))
      }));

      res.json({
        success: true,
        trials: enrichedTrials,
        total: enrichedTrials.length,
        sort_by: sortColumn,
        sort_order: sortDirection.toLowerCase()
      });
    } catch (error) {
      console.error('Get all trials error:', error);
      res.status(500).json({ success: false, error: 'Failed to load trials' });
    }
  }

  static async toggleLicenseStatus(req, res) {
    try {
      const { license_key, action } = req.body;
      const enabled = action === 'enable';
      
      const result = await db.query(`
        UPDATE licenses 
        SET status = $1, updated_at = NOW()
        WHERE license_key = $2
        RETURNING license_key, status
      `, [enabled ? 'active' : 'inactive', license_key]);

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          message: 'License not found' 
        });
      }

      res.json({ 
        success: true, 
        message: `License ${license_key} ${enabled ? 'enabled' : 'disabled'}`,
        license: result.rows[0]
      });
    } catch (error) {
      console.error('Toggle license status error:', error);
      res.status(500).json({ success: false, error: 'Toggle operation failed' });
    }
  }

  // Debug endpoint to check license types and Joe Smith's data
  static async debugLicenseTypes(req, res) {
    try {
      // Get all unique license types
      const licenseTypes = await db.query(`
        SELECT DISTINCT license_type, COUNT(*) as count
        FROM licenses 
        GROUP BY license_type
        ORDER BY count DESC
      `);

      // Get Joe Smith's licenses specifically
      const joeSmithLicenses = await db.query(`
        SELECT license_key, license_type, customer_email, customer_name, status, created_at, amount_paid
        FROM licenses 
        WHERE customer_email ILIKE '%joe%' OR customer_name ILIKE '%joe%' OR customer_name ILIKE '%smith%'
        ORDER BY created_at DESC
      `);

      // Get all purchasers with their license types
      const allPurchasers = await db.query(`
        SELECT license_key, license_type, customer_email, customer_name, status, created_at, amount_paid
        FROM licenses 
        WHERE license_type != 'trial'
        ORDER BY created_at DESC
        LIMIT 20
      `);

      res.json({
        success: true,
        license_types: licenseTypes.rows,
        joe_smith_licenses: joeSmithLicenses.rows,
        all_purchasers_sample: allPurchasers.rows,
        debug_info: {
          current_filter: "license_type IN ('5_site_license', 'annual_unlimited', 'lifetime_unlimited')",
          total_licenses: (await db.query('SELECT COUNT(*) FROM licenses')).rows[0].count,
          non_trial_licenses: (await db.query("SELECT COUNT(*) FROM licenses WHERE license_type != 'trial'")).rows[0].count
        }
      });
    } catch (error) {
      console.error('Debug license types error:', error);
      res.status(500).json({ success: false, error: 'Debug failed' });
    }
  }
}

module.exports = LicenseController; 