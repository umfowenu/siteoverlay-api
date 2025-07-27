# SiteOverlay Pro - Pabbly AWeber Troubleshooting Guide

## 🚨 COMMON ISSUES

### **AWeber Custom Fields Missing Data**
- **Cause**: AWeber overwrites ALL custom fields with each update
- **Solution**: Ensure ALL functions send complete data structure
- **Check**: Verify next_renewal and support_email in Stages 2&3

### **Email Workflows Not Triggering**  
- **Cause**: Tags already exist from previous actions
- **Solution**: Verify clear-tags system is working
- **Check**: AWeber tags should be removed 1 minute after each update

### **Duplicate AWeber Subscribers**
- **Cause**: Using wrong webhook for updates
- **Solution**: Use PURCHASE webhook only for Stage 1, UPDATER webhook for Stages 2&3

## 🧪 TESTING PROCEDURES

### **Test Complete Purchase Flow**
1. Test Stage 1: Purchase webhook creates subscriber
2. Test Stage 2: License webhook updates subscriber (no duplicate)  
3. Test Stage 3: Renewal webhook updates subscriber (preserves all data)
4. Verify AWeber has complete data after each stage

### **Test Tag Cleanup**
1. Send test data with clear-tags
2. Verify tags appear in AWeber
3. Wait 1 minute
4. Verify tags are automatically removed

## 🔧 DEBUGGING COMMANDS

```bash
# Test all webhooks
curl -X POST https://siteoverlay-api-production.up.railway.app/api/stripe/test-purchase-webhook -H "Content-Type: application/json"
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-license-install-webhook -H "Content-Type: application/json"  
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-renewal-reminder-webhook -H "Content-Type: application/json"

# Test browser endpoints
https://siteoverlay-api-production.up.railway.app/api/test-license-install
https://siteoverlay-api-production.up.railway.app/api/test-renewal-reminder
```

## 🔍 DEBUGGING STEPS

### **Step 1: Check Environment Variables**
```bash
# Verify all webhook URLs are set in Railway
PABBLY_WEBHOOK_URL_PURCHASE
PABBLY_WEBHOOK_URL_LICENSE_INSTALL
PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY
SUPPORT_EMAIL
SALES_PAGE_URL
```

### **Step 2: Check Webhook Responses**
- All test endpoints should return `success: true`
- Check Railway logs for any error messages
- Verify Pabbly receives the data correctly

### **Step 3: Check AWeber Data**
- Verify subscriber exists in correct list
- Check all custom fields are populated
- Verify tags are applied and then removed

## 🚨 ERROR MESSAGES

### **"PABBLY_WEBHOOK_URL_LICENSE_INSTALL not configured"**
- **Cause**: Environment variable missing in Railway
- **Solution**: Add the webhook URL to Railway environment variables

### **"Failed to send to Pabbly webhook"**
- **Cause**: Pabbly webhook URL invalid or Pabbly service down
- **Solution**: Verify webhook URL and check Pabbly status

### **"Cannot POST /api/test-license-install-webhook"**
- **Cause**: Endpoint not deployed or route not found
- **Solution**: Check if Railway has redeployed with latest changes

## 📊 DATA VERIFICATION

### **Stage 1 Data Check**
```json
{
  "email": "marius@shaw.ca",
  "customer_name": "Marius Nothling",
  "support_email": "support@ebiz360.ca",
  "sales_page": "https://siteoverlay.24hr.pro",
  "next_renewal": "2025-12-31",
  "license_type": "professional_5site",
  "aweber_tags": "subscription-active"
}
```

### **Stage 2 Data Check**
```json
{
  "email": "marius@shaw.ca",
  "customer_name": "Marius Nothling",
  "installs_remaining": "4",
  "sites_active": "1",
  "site_url": "https://test-customer-site.com",
  "sales_page": "https://siteoverlay.24hr.pro",
  "license_key": "SITE-A1B2-C3D4-E5F6",
  "next_renewal": "2025-12-31",
  "support_email": "support@ebiz360.ca",
  "aweber_tags": "new_license,clear-tags"
}
```

### **Stage 3 Data Check**
```json
{
  "email": "marius@shaw.ca",
  "customer_name": "Marius Nothling",
  "installs_remaining": "3",
  "sites_active": "2",
  "site_url": "https://test-customer-site.com",
  "sales_page": "https://siteoverlay.24hr.pro",
  "license_key": "SITE-A1B2-C3D4-E5F6",
  "next_renewal": "2025-12-31",
  "support_email": "support@ebiz360.ca",
  "aweber_tags": "subscription_ending,clear-tags"
}
```

## 🔄 WORKFLOW VERIFICATION

### **Purchase Workflow**
1. ✅ Stripe purchase completes
2. ✅ sendPurchaseToPabbly() called
3. ✅ New subscriber created in AWeber
4. ✅ subscription-active tag applied

### **License Install Workflow**
1. ✅ Plugin requests license
2. ✅ sendLicenseUpdateToPabbly() called
3. ✅ Existing subscriber updated (no duplicate)
4. ✅ All custom fields preserved
5. ✅ new_license tag applied
6. ✅ clear-tags removes tags after 1 minute

### **Renewal Reminder Workflow**
1. ✅ Scheduled check finds renewal due
2. ✅ sendRenewalReminderToPabbly() called
3. ✅ Existing subscriber updated
4. ✅ All custom fields preserved
5. ✅ subscription_ending tag applied
6. ✅ clear-tags removes tags after 1 minute

## 📞 SUPPORT CONTACTS

- **Railway Team**: API development and deployment
- **Pabbly Support**: Webhook configuration and troubleshooting
- **AWeber Support**: Email automation and custom fields

---

**Last Updated**: July 27, 2025  
**Created By**: Railway Team  
**Purpose**: Quick troubleshooting reference for integration issues 