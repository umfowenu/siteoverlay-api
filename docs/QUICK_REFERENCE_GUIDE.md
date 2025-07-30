# SiteOverlay Pro - Quick Reference Guide

## 🚀 ESSENTIAL URLS

### Production API
- **Railway API**: https://siteoverlay-api-production.up.railway.app
- **GitHub Repository**: https://github.com/umfowenu/siteoverlay-api
- **Sales Page**: https://siteoverlay.24hr.pro

### Test Endpoints
- **API Health**: `/api/test`
- **License Debug**: `/api/debug-license`
- **License Install Test**: `/api/test-license-install`
- **Renewal Test**: `/api/test-renewal-reminder-webhook`

## 🔑 LICENSE KEY TYPES

| Type | Format | Location | Purpose |
|------|--------|----------|---------|
| **Trial** | `TRIAL-XXXX-XXXX-XXXX` | `licenses` table | 14-day free trial |
| **Master** | `D532BC1D62AE55D6` | `licenses` table | Purchase tracking only |
| **Site-Specific** | `SITE-XXXX-XXXX-XXXX` | `site_usage.site_license_key` | Plugin activation |

## ⚙️ ENVIRONMENT VARIABLES

### Required Variables
```bash
DATABASE_URL=postgresql://...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY=https://...
PABBLY_WEBHOOK_URL_PURCHASE=https://...
PABBLY_WEBHOOK_URL_LICENSE_INSTALL=https://...
SUPPORT_EMAIL=support@ebiz360.ca
SALES_PAGE_URL=https://siteoverlay.24hr.pro
```

### Test Mode Variables
```bash
STRIPE_TEST_MODE=true
STRIPE_TEST_MODE_ALLOW_EMAILS=true
```

## 🧪 TESTING COMMANDS

### API Health Check
```bash
curl https://siteoverlay-api-production.up.railway.app/api/test
```

### License Validation Test
```bash
curl -X POST https://siteoverlay-api-production.up.railway.app/api/debug-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "SITE-52A3B862D1CD6F01"}'
```

### Pabbly Webhook Tests
```bash
# Test license install webhook
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-license-install

# Test renewal reminder webhook
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-renewal-reminder-webhook
```

### Stripe Test Cards
- **Visa**: 4242 4242 4242 4242
- **Mastercard**: 5555 5555 5555 4444
- **Amex**: 3782 822463 10005

## 🚨 COMMON FIXES

### Database Schema Issues
```sql
-- Add missing columns to site_usage table
ALTER TABLE site_usage ADD COLUMN IF NOT EXISTS site_license_key VARCHAR(255);
ALTER TABLE site_usage ADD COLUMN IF NOT EXISTS customer_email VARCHAR(255);
ALTER TABLE site_usage ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
```

### License Validation Issues
```sql
-- Check license key in database
SELECT * FROM licenses WHERE license_key = 'YOUR_LICENSE_KEY';
SELECT * FROM site_usage WHERE site_license_key = 'SITE-XXXX-XXXX-XXXX';
```

### Email Delivery Issues
1. Check spam folder
2. Verify AWeber subscriber status
3. Test with different email address
4. Check AWeber delivery reports

## 🔧 EMERGENCY PROCEDURES

### Plugin Not Deactivating
1. Wait 30 seconds for background check
2. Deactivate/reactivate plugin
3. Clear browser cache
4. Check Railway logs for validation attempts

### License System Down
1. Check Railway deployment status
2. Verify database connectivity
3. Check environment variables
4. Review recent code changes

### Payment System Issues
1. Check Stripe dashboard
2. Verify webhook endpoints
3. Test with sandbox mode
4. Check payment logs

## 📊 MONITORING

### Railway Logs
- Check for API errors
- Monitor license validation attempts
- Watch for database connection issues

### Stripe Dashboard
- Monitor webhook delivery
- Check payment success rates
- Review subscription status

### AWeber Reports
- Check email delivery rates
- Monitor subscriber growth
- Verify workflow triggers

## 🔄 DEPLOYMENT

### Git Commands
```bash
git add .
git commit -m "Description of changes"
git push origin master
```

### Railway Deployment
- Automatic deployment on push to master
- Check deployment status in Railway dashboard
- Monitor logs for deployment success

### Production Checklist
- [ ] All tests passing
- [ ] Environment variables set
- [ ] Database schema complete
- [ ] Webhooks configured
- [ ] Email workflows tested

## 📞 SUPPORT CONTACTS

- **Railway Team**: API development and deployment
- **Stripe Support**: Payment processing issues
- **AWeber Support**: Email automation problems
- **WordPress Plugin Team**: Client-side integration

## 🚀 QUICK TROUBLESHOOTING

### "Invalid License Key"
1. Check if key exists in correct table
2. Verify key format (SITE-, TRIAL-, etc.)
3. Use `/api/debug-license` endpoint
4. Check Railway logs for validation details

### "Failed to Process License Request"
1. Check database schema (missing columns)
2. Verify environment variables
3. Check Railway logs for specific errors
4. Test with debug endpoint

### "Plugin Not Activating"
1. Verify license validation response
2. Check plugin logs
3. Clear plugin cache
4. Deactivate/reactivate plugin

### "Email Not Received"
1. Check spam folder
2. Verify AWeber subscriber status
3. Test with different email
4. Check AWeber delivery reports

---

**Last Updated**: July 30, 2025  
**Version**: 1.0  
**Created By**: Railway Team  
**Purpose**: Quick reference for common tasks and troubleshooting 