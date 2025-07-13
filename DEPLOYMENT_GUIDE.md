# SiteOverlay Pro - Deployment Guide

## ðŸš€ Complete Deployment Steps

### Phase 1: Railway Backend Deployment

#### 1. Update Your GitHub Repository
```bash
# Replace these files in your siteoverlay-api repository:
- routes.js (updated with all new endpoints)
- mailer.js (complete email system)
- class-license-manager.php (updated WordPress plugin)

# Keep existing files:
- index.js (no changes needed)
- db.js (no changes needed)  
- package.json (no changes needed)
- src/db/migrations.js (already has enhanced schema)
```

#### 2. Configure Environment Variables in Railway
Add these new environment variables to your Railway project:

```env
# Email Configuration (REQUIRED)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
EMAIL_FROM=SiteOverlay Pro <your_email@gmail.com>

# Security
CRON_SECRET=generate_random_secret_here

# Existing variables (keep as-is)
DATABASE_URL=postgresql://... (already configured)
STRIPE_SECRET_KEY=sk_live_... (already configured)
STRIPE_WEBHOOK_SECRET=whsec_... (already configured)
```

#### 3. Deploy to Railway
```bash
# Railway will automatically deploy when you push to GitHub
git add .
git commit -m "Complete SiteOverlay Pro licensing system"
git push origin main

# Railway will build and deploy automatically
# Check Railway dashboard for deployment status
```

#### 4. Verify API Deployment
Test your Railway API endpoints:

```bash
# Health check
curl https://your-railway-app.up.railway.app/api/health

# Test email configuration
curl https://your-railway-app.up.railway.app/api/test-email

# Expected response: {"success": true, "message": "Email configuration is valid"}
```

### Phase 2: WordPress Plugin Update

#### Option A: Replace Plugin File (Recommended)
1. Download the updated `class-license-manager.php` from the output
2. Replace the existing file in your plugin:
   ```
   /wp-content/plugins/siteoverlay-pro/includes/class-license-manager.php
   ```
3. Update the API URL if your Railway endpoint is different:
   ```php
   private $license_server_url = 'https://YOUR-RAILWAY-APP.up.railway.app/api/validate-license';
   ```

#### Option B: Manual URL Update
If you prefer to update just the URL in your existing plugin:
1. Edit `class-license-manager.php`
2. Find this line:
   ```php
   private $license_server_url = 'https://soft.24hr.pro/api/validate-license.php';
   ```
3. Replace with:
   ```php
   private $license_server_url = 'https://YOUR-RAILWAY-APP.up.railway.app/api/validate-license';
   ```

### Phase 3: Email System Setup

#### 1. Configure SMTP Provider
**For Gmail:**
1. Enable 2-factor authentication
2. Generate an App Password
3. Use the App Password in `SMTP_PASS`

**For Other Providers:**
- Update `SMTP_HOST` and `SMTP_PORT` accordingly
- Ensure SMTP credentials are correct

#### 2. Test Email System
```bash
# Test email configuration
curl -X GET https://your-railway-app.up.railway.app/api/test-email

# Test trial start email (replace with real email)
curl -X POST https://your-railway-app.up.railway.app/api/start-trial \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "siteUrl": "https://test-site.com"}'
```

### Phase 4: Stripe Integration Testing

#### 1. Test Webhook Processing
1. Go to your Stripe Dashboard
2. Navigate to Webhooks
3. Find your Railway webhook endpoint
4. Send a test event
5. Check Railway logs for processing

#### 2. Test Payment Flow
1. Create a test payment in Stripe
2. Verify license is generated in database
3. Check that license email is sent
4. Confirm license works in WordPress plugin

### Phase 5: Trial System Setup

#### 1. Set Up Automated Trial Monitoring
Add a cron job or scheduled task to check expiring trials:

```bash
# Example cron job (runs daily at 9 AM)
0 9 * * * curl -X POST https://your-railway-app.up.railway.app/api/cron/check-trials \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

#### 2. Test Trial Flow
1. Start a trial via WordPress plugin
2. Verify trial email is sent
3. Check license validation works
4. Test trial expiration warnings

## ðŸ§ª Testing Checklist

### âœ… API Endpoints
- [ ] Health check responds
- [ ] License validation works (check/activate/deactivate)
- [ ] Trial start creates license and sends email
- [ ] Dynamic content returns data
- [ ] Email collection stores data
- [ ] Stripe webhook processes payments

### âœ… WordPress Plugin
- [ ] License activation works
- [ ] Trial start works
- [ ] License status displays correctly
- [ ] Site limit enforcement works
- [ ] Daily license checks function

### âœ… Email System
- [ ] SMTP configuration valid
- [ ] License delivery emails send
- [ ] Trial start emails send
- [ ] Trial expiration reminders work
- [ ] Email templates display correctly

### âœ… Database
- [ ] All tables exist and populated
- [ ] License records created correctly
- [ ] Installation tracking works
- [ ] Email collection functions
- [ ] Analytics data populates

## ðŸš¨ Troubleshooting

### Common Issues

**1. Email Not Sending**
- Check SMTP credentials in Railway environment
- Verify email provider allows SMTP
- Test with `/api/test-email` endpoint

**2. License Validation Fails**
- Verify Railway API URL in WordPress plugin
- Check database connection
- Confirm license exists in database

**3. Stripe Webhook Not Working**
- Verify webhook URL in Stripe dashboard
- Check webhook secret in Railway environment
- Review Railway logs for errors

**4. Trial System Issues**
- Confirm email collection works
- Check trial license generation
- Verify trial expiration logic

### Debug Commands

```bash
# Check Railway logs
railway logs

# Test database connection
railway run node -e "require('./db').query('SELECT NOW()')"

# Test email configuration
curl https://your-app.up.railway.app/api/test-email

# Check license validation
curl -X POST https://your-app.up.railway.app/api/validate-license \
  -H "Content-Type: application/json" \
  -d '{"licenseKey": "TEST", "siteUrl": "https://test.com", "action": "check", "productCode": "siteoverlay-pro"}'
```

## ðŸŽ¯ Go-Live Checklist

- [ ] All tests pass
- [ ] Email system working
- [ ] Stripe webhooks processing
- [ ] WordPress plugin updated
- [ ] Trial system functional
- [ ] Monitoring set up
- [ ] Backup procedures in place

---

**Ready for Production!** ðŸš€

Your SiteOverlay Pro licensing system is now complete and ready for live deployment.
