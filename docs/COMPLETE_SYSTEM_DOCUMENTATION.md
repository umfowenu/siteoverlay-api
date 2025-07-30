# SiteOverlay Pro - Complete System Documentation

## 🎯 SYSTEM OVERVIEW

SiteOverlay Pro is a WordPress plugin with a complete licensing and payment system built on Railway infrastructure. The system handles trial requests, paid license generation, Stripe payments, and AWeber email automation.

## 🏗️ ARCHITECTURE

### Core Components
- **Railway API**: Node.js/Express backend hosted on Railway
- **PostgreSQL Database**: License and user data storage
- **Stripe Integration**: Payment processing and subscription management
- **Pabbly Integration**: Webhook automation for AWeber
- **WordPress Plugin**: Client-side license validation and activation

### Data Flow
1. **Trial Request**: Plugin → API → Database → Pabbly → AWeber
2. **Purchase**: Stripe → API → Database → Pabbly → AWeber
3. **License Request**: Plugin → API → Database → Email Delivery
4. **Validation**: Plugin → API → Database → Plugin Activation

## 🗄️ DATABASE SCHEMA

### Licenses Table
```sql
CREATE TABLE licenses (
  id SERIAL PRIMARY KEY,
  license_key VARCHAR(255) UNIQUE NOT NULL,
  license_type VARCHAR(100) NOT NULL,
  status VARCHAR(50) DEFAULT 'active',
  customer_email VARCHAR(255),
  customer_name VARCHAR(255),
  purchase_date TIMESTAMP,
  trial_end_date TIMESTAMP,
  renewal_date TIMESTAMP,
  subscription_id VARCHAR(255),
  subscription_status VARCHAR(100),
  stripe_price_id VARCHAR(255),
  amount_paid DECIMAL(10,2),
  payment_processor VARCHAR(50) DEFAULT 'stripe',
  purchase_source VARCHAR(100),
  site_limit INTEGER,
  kill_switch_enabled BOOLEAN DEFAULT true,
  resale_monitoring BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Site Usage Table
```sql
CREATE TABLE site_usage (
  id SERIAL PRIMARY KEY,
  license_key VARCHAR(255) NOT NULL,
  site_signature VARCHAR(255) NOT NULL,
  site_domain VARCHAR(255),
  site_url TEXT,
  site_license_key VARCHAR(255),
  customer_email VARCHAR(255),
  customer_name VARCHAR(255),
  site_data JSONB,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Purchase History Table
```sql
CREATE TABLE purchase_history (
  id SERIAL PRIMARY KEY,
  license_id INTEGER REFERENCES licenses(id),
  customer_email VARCHAR(255),
  transaction_type VARCHAR(100),
  new_license_type VARCHAR(100),
  new_license_key VARCHAR(255),
  amount_paid DECIMAL(10,2),
  purchase_date TIMESTAMP,
  payment_processor VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Email Collection Table
```sql
CREATE TABLE email_collection (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  license_key VARCHAR(255),
  collection_source VARCHAR(100),
  license_type VARCHAR(100),
  customer_name VARCHAR(255),
  site_url TEXT,
  sent_to_autoresponder BOOLEAN DEFAULT false,
  collected_at TIMESTAMP DEFAULT NOW()
);
```

## 🔑 LICENSE KEY SYSTEM

### License Key Types
1. **Trial Keys**: `TRIAL-XXXX-XXXX-XXXX`
   - Stored in: `licenses` table
   - Valid for: 14 days
   - Purpose: Free trial access

2. **Master Keys**: `D532BC1D62AE55D6` (from purchases)
   - Stored in: `licenses` table
   - Purpose: Purchase tracking and site-specific license generation
   - **NOT valid for plugin activation**

3. **Site-Specific Keys**: `SITE-XXXX-XXXX-XXXX`
   - Stored in: `site_usage.site_license_key`
   - Purpose: Plugin activation for specific sites
   - Generated from: Master license via license request

### License Validation Logic
```javascript
if (licenseKey.startsWith('SITE-')) {
  // Check site_usage table for site-specific keys
} else if (licenseKey.startsWith('TRIAL-')) {
  // Check licenses table for trial keys
} else {
  // Reject master keys for plugin activation
}
```

## 💳 STRIPE INTEGRATION

### Products
1. **Professional Monthly**: $35/month - 5 sites
2. **Annual Unlimited**: $197/year - Unlimited sites
3. **Lifetime Unlimited**: $497 - Unlimited sites

### Webhook Events
- `checkout.session.completed`: Initial purchase
- `invoice.payment_succeeded`: Subscription renewal
- `customer.subscription.deleted`: Cancellation

### Environment Variables
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_TEST_MODE=true
STRIPE_TEST_MODE_ALLOW_EMAILS=true
```

## 📧 PABBLY/AWEBER INTEGRATION

### Webhook Endpoints
1. **Trial Webhook**: `PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY`
   - Purpose: Create trial subscribers in AWeber
   - Data: Trial license info, expiration dates

2. **Purchase Webhook**: `PABBLY_WEBHOOK_URL_PURCHASE`
   - Purpose: Create new buyer subscribers
   - Data: Purchase info, license type

3. **License Install Webhook**: `PABBLY_WEBHOOK_URL_LICENSE_INSTALL`
   - Purpose: Update existing buyers with license data
   - Data: License key, site info, usage data

### AWeber Custom Fields
- `license_key`: The actual license key
- `installs_remaining`: Number of sites left
- `sites_active`: Current active sites
- `next_renewal`: Renewal date

### Tag System
- `trial-active`: Trial subscriber
- `subscription-active`: Paid subscriber
- `new_license`: License installed
- `subscription_ending`: Renewal reminder
- `clear-tags`: Automated cleanup

## 🔌 WORDPRESS PLUGIN INTEGRATION

### Plugin Endpoints
- `/api/start-trial`: Request trial license
- `/api/request-paid-license`: Request site-specific license
- `/api/validate-license`: Validate license for activation

### Background Validation
- Runs every 30 seconds
- Checks license status in database
- Automatically deactivates invalid licenses
- Clears cached license data on failure

### License Activation Flow
1. Plugin sends license key to `/api/validate-license`
2. API validates key and returns status
3. Plugin activates if validation successful
4. Background checks continue every 30 seconds

## 🧪 TESTING PROCEDURES

### Test Cards
- **Visa**: 4242 4242 4242 4242
- **Mastercard**: 5555 5555 5555 4444
- **American Express**: 3782 822463 10005

### Test Endpoints
```bash
# Test API health
curl https://siteoverlay-api-production.up.railway.app/api/test

# Test license validation
curl -X POST https://siteoverlay-api-production.up.railway.app/api/debug-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "SITE-XXXX-XXXX-XXXX"}'

# Test Pabbly webhooks
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-license-install
```

### Complete Test Flow
1. **Trial Test**: Request trial → Check email delivery
2. **Purchase Test**: Complete Stripe purchase → Check AWeber
3. **License Test**: Request site license → Check email delivery
4. **Validation Test**: Enter license key → Check plugin activation

## 🚨 TROUBLESHOOTING

### Common Issues

#### License Validation Failing
- **Cause**: License key not found in database
- **Solution**: Check if key exists in correct table
- **Debug**: Use `/api/debug-license` endpoint

#### Email Not Delivered
- **Cause**: AWeber workflow or template issues
- **Solution**: Check AWeber delivery reports
- **Debug**: Test with different email address

#### Plugin Not Deactivating
- **Cause**: Background validation not running
- **Solution**: Wait 30 seconds or deactivate/reactivate plugin
- **Debug**: Check Railway logs for validation attempts

#### Database Errors
- **Cause**: Missing columns or schema issues
- **Solution**: Run ALTER TABLE commands
- **Debug**: Check PostgreSQL error logs

### Emergency Procedures

#### License System Down
1. Check Railway deployment status
2. Verify database connectivity
3. Check environment variables
4. Review recent code changes

#### Payment System Issues
1. Check Stripe dashboard
2. Verify webhook endpoints
3. Test with sandbox mode
4. Check payment logs

#### Email System Failure
1. Check Pabbly webhook status
2. Verify AWeber list settings
3. Test webhook endpoints manually
4. Check email delivery reports

## 🚀 PRODUCTION DEPLOYMENT

### Pre-Launch Checklist
- [ ] All tests passing
- [ ] Database schema complete
- [ ] Environment variables configured
- [ ] Stripe webhooks active
- [ ] AWeber workflows tested
- [ ] Plugin integration verified

### Production Settings
```bash
STRIPE_TEST_MODE=false
STRIPE_TEST_MODE_ALLOW_EMAILS=false
NODE_ENV=production
```

### Monitoring
- Railway logs for API errors
- Stripe dashboard for payment issues
- AWeber reports for email delivery
- Database performance metrics

### Backup Procedures
- Database backups (Railway handles)
- Code version control (GitHub)
- Configuration backups (environment variables)

## 📞 SUPPORT CONTACTS

- **Railway Team**: API development and deployment
- **Stripe Support**: Payment processing issues
- **AWeber Support**: Email automation problems
- **WordPress Plugin Team**: Client-side integration

## 🔄 MAINTENANCE

### Regular Tasks
- Monitor Railway logs for errors
- Check Stripe webhook health
- Verify AWeber email delivery
- Review license usage statistics
- Update documentation as needed

### Security Considerations
- License key validation
- Database access controls
- API rate limiting
- Webhook signature verification
- Environment variable security

---

**Last Updated**: July 30, 2025  
**Version**: 1.0  
**Created By**: Railway Team  
**Purpose**: Complete system reference and troubleshooting guide 