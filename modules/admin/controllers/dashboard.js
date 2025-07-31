const db = require('../../../db');

class DashboardController {
  static async getStats(req, res) {
    try {
      const stats = await db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE license_type = 'trial') as trial_count,
          COUNT(*) FILTER (WHERE license_type = '5_site_license') as five_site_count,
          COUNT(*) FILTER (WHERE license_type = 'annual_unlimited') as annual_count,
          COUNT(*) FILTER (WHERE license_type = 'lifetime_unlimited') as lifetime_count,
          COUNT(*) FILTER (WHERE status = 'active') as active_licenses,
          COUNT(*) FILTER (WHERE kill_switch_enabled = false) as killed_licenses,
          SUM(amount_paid) as total_revenue,
          COUNT(*) as total_licenses
        FROM licenses
      `);

      const recentLicenses = await db.query(`
        SELECT license_key, license_type, customer_email, customer_name, 
               status, kill_switch_enabled, created_at, amount_paid
        FROM licenses 
        ORDER BY created_at DESC 
        LIMIT 10
      `);

      const siteUsage = await db.query(`
        SELECT COUNT(*) as total_sites,
               COUNT(DISTINCT customer_email) as unique_customers
        FROM site_usage
      `);

      res.json({
        success: true,
        stats: {
          ...stats.rows[0],
          ...siteUsage.rows[0]
        },
        recent_licenses: recentLicenses.rows
      });
    } catch (error) {
      console.error('Dashboard stats error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to load dashboard stats' 
      });
    }
  }

  static async getSystemHealth(req, res) {
    try {
      // Check database connection
      await db.query('SELECT 1');
      
      // Check recent activity
      const recentActivity = await db.query(`
        SELECT COUNT(*) as recent_purchases
        FROM licenses 
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `);

      res.json({
        success: true,
        health: {
          database: 'connected',
          recent_purchases_24h: recentActivity.rows[0].recent_purchases,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        health: {
          database: 'error',
          error: error.message
        }
      });
    }
  }
}

module.exports = DashboardController; 