// src/db/migrations.js
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS licenses (
      id SERIAL PRIMARY KEY,
      license_key VARCHAR(255) NOT NULL UNIQUE,
      license_type VARCHAR(50) NOT NULL DEFAULT 'trial',
      status VARCHAR(20) NOT NULL DEFAULT 'trial',
      xagio_affiliate_url VARCHAR(500),
      dynamic_content_version INT DEFAULT 1,
      last_content_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      customer_name VARCHAR(255),
      customer_company VARCHAR(255),
      purchase_source VARCHAR(100) DEFAULT 'direct',
      referral_code VARCHAR(50),
      total_revenue DECIMAL(10,2) DEFAULT 0.00,
      mrr_contribution DECIMAL(10,2) DEFAULT 0.00,
      ltv_estimate DECIMAL(10,2) DEFAULT 0.00,
      churn_risk_score INT DEFAULT 0,
      last_email_sent TIMESTAMP,
      email_opens INT DEFAULT 0,
      email_clicks INT DEFAULT 0,
      support_tickets INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS plugin_installations (
      id SERIAL PRIMARY KEY,
      license_key VARCHAR(255) NOT NULL,
      site_url VARCHAR(500) NOT NULL,
      site_title VARCHAR(255),
      wp_version VARCHAR(50),
      php_version VARCHAR(50),
      plugin_version VARCHAR(50),
      theme_name VARCHAR(255),
      installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      activation_count INT DEFAULT 1,
      is_active BOOLEAN DEFAULT TRUE,
      site_language VARCHAR(10),
      site_timezone VARCHAR(50),
      estimated_traffic VARCHAR(50),
      site_category VARCHAR(100),
      overlay_count INT DEFAULT 0,
      total_views INT DEFAULT 0,
      last_overlay_created TIMESTAMP,
      UNIQUE(license_key, site_url)
    );

    CREATE TABLE IF NOT EXISTS dynamic_content (
      id SERIAL PRIMARY KEY,
      content_key VARCHAR(100) NOT NULL UNIQUE,
      content_value TEXT,
      content_type VARCHAR(20) DEFAULT 'text',
      license_type VARCHAR(50) DEFAULT 'all',
      plugin_version_min VARCHAR(50),
      plugin_version_max VARCHAR(50),
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Create indexes for dynamic_content table
    CREATE INDEX IF NOT EXISTS idx_dynamic_content_content_key ON dynamic_content(content_key);
    CREATE INDEX IF NOT EXISTS idx_dynamic_content_license_type ON dynamic_content(license_type);
    CREATE INDEX IF NOT EXISTS idx_dynamic_content_active ON dynamic_content(is_active);

    CREATE TABLE IF NOT EXISTS email_collection (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      license_key VARCHAR(255),
      site_url VARCHAR(500),
      collection_source VARCHAR(50) DEFAULT 'plugin_signup',
      license_type VARCHAR(50),
      sent_to_autoresponder BOOLEAN DEFAULT FALSE,
      autoresponder_id VARCHAR(100),
      tags JSON,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_email_sent TIMESTAMP,
      conversion_status VARCHAR(50) DEFAULT 'lead',
      UNIQUE(email, license_key)
    );

    CREATE TABLE IF NOT EXISTS customer_analytics (
      id SERIAL PRIMARY KEY,
      license_key VARCHAR(255) NOT NULL UNIQUE,
      total_installations INT DEFAULT 0,
      active_installations INT DEFAULT 0,
      total_overlays_created INT DEFAULT 0,
      total_overlay_views INT DEFAULT 0,
      days_since_last_login INT DEFAULT 0,
      feature_usage_score INT DEFAULT 0,
      support_satisfaction_score INT DEFAULT 0,
      months_active INT DEFAULT 0,
      upgrade_probability DECIMAL(3,2) DEFAULT 0.00,
      churn_probability DECIMAL(3,2) DEFAULT 0.00,
      first_install_date DATE,
      last_activity_date DATE,
      calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Pre-populate dynamic_content table
  await client.query(`
    INSERT INTO dynamic_content (content_key, content_value, content_type)
    VALUES
      ('xagio_affiliate_url', 'https://xagio.com/?ref=PENDING', 'url'),
      ('upgrade_message', 'Limited Time: Save $100 on Unlimited License!', 'text'),
      ('support_url', 'https://siteoverlaypro.com/support', 'url'),
      ('training_url', 'https://siteoverlaypro.com/training', 'url')
    ON CONFLICT (content_key) DO NOTHING;
  `);

  await client.end();
  console.log('Migration complete!');
}

migrate();
