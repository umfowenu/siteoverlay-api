# SiteOverlay Pro - Pabbly AWeber Integration Documentation

## 🎯 OVERVIEW

This document explains the complete Pabbly → AWeber integration for SiteOverlay Pro, including all workflows, data structures, and the reasoning behind each design decision.

## 🔄 COMPLETE WORKFLOW ARCHITECTURE

### **TRIAL WORKFLOW (Separate System)**

Plugin Trial Request → API /start-trial → sendTrialToPabbly() → TRIAL webhook → AWeber Trial List

### **PURCHASE WORKFLOW (3-Stage System)**

Stage 1: Stripe Purchase → sendPurchaseToPabbly() → PURCHASE webhook → AWeber Buyers List
Stage 2: License Install → sendLicenseUpdateToPabbly() → BUYERS UPDATER webhook → AWeber Update
Stage 3: Renewal Reminder → sendRenewalReminderToPabbly() → BUYERS UPDATER webhook → AWeber Update

## 📡 WEBHOOK ENDPOINTS

### **1. Trial Webhook (Separate System)**
- **URL**: `PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY`
- **Purpose**: Create new trial subscribers
- **Function**: `sendTrialToPabbly()`
- **AWeber List**: Trial Users List

### **2. Purchase Webhook (Stage 1 Only)**
- **URL**: `PABBLY_WEBHOOK_URL_PURCHASE`
- **Value**: `https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNTA0MzA1MjZjNTUzYzUxMzQi_pc`
- **Purpose**: Initial purchase notification
- **Function**: `sendPurchaseToPabbly()`
- **AWeber List**: SiteOverlay Pro Buyers

### **3. Buyers Email Updater Webhook (Stages 2 & 3)**
- **URL**: `PABBLY_WEBHOOK_URL_LICENSE_INSTALL`
- **Value**: `https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNTA0MzI1MjZmNTUzYzUxMzYi_pc`
- **Purpose**: Update existing buyer with license/renewal data
- **Functions**: `sendLicenseUpdateToPabbly()`, `sendRenewalReminderToPabbly()`
- **AWeber List**: SiteOverlay Pro Buyers (updates existing subscribers)

## 📋 DATA STRUCTURES BY STAGE

### **Stage 1: Initial Purchase Data**
```json
{
  "email": "customer@email.com",
  "customer_name": "Customer Name",
  "support_email": "support@ebiz360.ca",
  "sales_page": "https://siteoverlay.24hr.pro",
  "next_renewal": "2025-12-31",
  "license_type": "professional_5site|annual_unlimited|lifetime_unlimited",
  "aweber_tags": "subscription-active"
}
```

### **Stage 2: License Install Data**
```json
{
  "email": "customer@email.com",
  "customer_name": "Customer Name",
  "installs_remaining": "4",
  "sites_active": "1",
  "site_url": "https://customer-site.com",
  "sales_page": "https://siteoverlay.24hr.pro",
  "license_key": "SITE-A1B2-C3D4-E5F6",
  "next_renewal": "2025-12-31",
  "support_email": "support@ebiz360.ca",
  "aweber_tags": "new_license,clear-tags"
}
```

### **Stage 3: Renewal Reminder Data**
```json
{
  "email": "customer@email.com", 
  "customer_name": "Customer Name",
  "installs_remaining": "3",
  "sites_active": "2",
  "site_url": "https://customer-site.com",
  "sales_page": "https://siteoverlay.24hr.pro",
  "license_key": "SITE-A1B2-C3D4-E5F6",
  "next_renewal": "2025-12-31",
  "support_email": "support@ebiz360.ca",
  "aweber_tags": "subscription_ending,clear-tags"
}
```

## 🏷️ AWEBER TAG SYSTEM

### **Tag Behavior Issues Solved**
- **Problem**: AWeber tags are persistent (don't get removed automatically)
- **Problem**: AWeber custom fields get overwritten (previous data lost)
- **Solution**: Automated tag cleanup + complete data preservation

### **Tag Strategy**
- **subscription-active**: Customer has active subscription
- **new_license**: Customer installed new license (triggers welcome email)
- **subscription_ending**: Customer renewal due tomorrow (triggers renewal email)
- **clear-tags**: Special tag that triggers AWeber workflow to remove all tags after 1 minute

### **Custom Field Preservation Strategy**
- **Issue**: AWeber overwrites ALL custom fields with each update
- **Solution**: Send ALL custom field data with EVERY update (Stages 2 & 3)
- **Fields Preserved**: license_key, installs_remaining, sites_active, next_renewal, support_email, site_url, sales_page

## 🔧 IMPLEMENTATION FUNCTIONS

### **Function: sendPurchaseToPabbly()**
- **File**: utils/pabbly-utils.js
- **Purpose**: Send initial purchase data
- **Webhook**: PABBLY_WEBHOOK_URL_PURCHASE
- **Called From**: Stripe webhook handler
- **Data**: Basic purchase info only

### **Function: sendLicenseUpdateToPabbly()**
- **File**: utils/pabbly-utils.js
- **Purpose**: Send license install data + preserve all fields
- **Webhook**: PABBLY_WEBHOOK_URL_LICENSE_INSTALL
- **Called From**: Plugin license request endpoint
- **Data**: Complete customer data including license key

### **Function: sendRenewalReminderToPabbly()**
- **File**: utils/pabbly-utils.js
- **Purpose**: Send renewal reminder + preserve all fields
- **Webhook**: PABBLY_WEBHOOK_URL_LICENSE_INSTALL (same as license install)
- **Called From**: Scheduled renewal check (future implementation)
- **Data**: Complete customer data with renewal reminder tag

## 🧪 TESTING ENDPOINTS

### **Test Purchase Webhook**
```bash
curl -X POST https://siteoverlay-api-production.up.railway.app/api/stripe/test-purchase-webhook -H "Content-Type: application/json"
```

### **Test License Install Webhook**
```bash
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-license-install-webhook -H "Content-Type: application/json"
```

### **Test Renewal Reminder Webhook**
```bash
curl -X POST https://siteoverlay-api-production.up.railway.app/api/test-renewal-reminder-webhook -H "Content-Type: application/json"
```

## 🚨 CRITICAL DESIGN DECISIONS

### **Why Separate Webhooks for Purchase vs Updates?**
- Purchase webhook creates NEW subscriber in AWeber
- Updater webhook modifies EXISTING subscriber (no duplicates)
- Different Pabbly workflows handle different AWeber operations

### **Why Send All Fields in Stages 2 & 3?**
- AWeber overwrites custom fields completely with each update
- Must preserve purchase data (next_renewal, support_email)
- Must preserve license data (license_key, site_url)
- Only way to prevent data loss

### **Why clear-tags System?**
- AWeber tags are persistent (don't auto-remove)
- Need fresh tag triggers for email automation
- Automated cleanup prevents workflow conflicts
- 1-minute delay allows email triggers to fire first

### **Why Reuse License Install Webhook for Renewals?**
- Same AWeber operation (update existing subscriber)
- Same data preservation requirements
- Tags differentiate the workflow triggers
- Simpler webhook management

## 🔄 ENVIRONMENT VARIABLES

```bash
# Purchase Workflow
PABBLY_WEBHOOK_URL_PURCHASE=https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNTA0MzA1MjZjNTUzYzUxMzQi_pc

# Buyers Email Updater Workflow
PABBLY_WEBHOOK_URL_LICENSE_INSTALL=https://connect.pabbly.com/workflow/sendwebhookdata/IjU3NjYwNTZhMDYzNTA0MzI1MjZmNTUzYzUxMzYi_pc

# Supporting Data
SUPPORT_EMAIL=support@ebiz360.ca
SALES_PAGE_URL=https://siteoverlay.24hr.pro

# Trial System (Separate)
PABBLY_WEBHOOK_URL_TRIAL_SITEOVERLAY=[trial webhook URL]
```

## 📅 FUTURE IMPLEMENTATION

### **Automated Renewal Reminders**
- Implement scheduled job to check renewal dates
- Call sendRenewalReminderToPabbly() for customers with renewal_date = tomorrow
- Trigger "subscription_ending" email workflow

### **Subscription Status Updates**
- Handle subscription cancellations
- Handle subscription reactivations
- Update AWeber custom fields accordingly

---

**Last Updated**: July 27, 2025  
**Created By**: Railway Team  
**Coordination Session Purpose**: Prevent knowledge loss and enable quick team onboarding 