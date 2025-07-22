// Pabbly Connect integration with enhanced AWeber data
const db = require('../db');

async function sendToPabbly(email, licenseKey, licenseType, metadata = {}) {
  try {
    // Get current site usage for AWeber fields
    let sitesActive = 0;
    let sitesRemaining = 'Unknown';
    
    if (licenseKey && licenseKey !== 'newsletter') {
      try {
        const usageResult = await db.query(
          'SELECT COUNT(*) as count FROM site_usage WHERE license_key = $1 AND status = $2',
          [licenseKey, 'active']
        );
        sitesActive = parseInt(usageResult.rows[0].count) || 0;
        
        // Get license to determine site limit
        const licenseResult = await db.query(
          'SELECT site_limit FROM licenses WHERE license_key = $1',
          [licenseKey]
        );
        
        if (licenseResult.rows.length > 0) {
          const siteLimit = licenseResult.rows[0].site_limit;
          if (siteLimit === -1) {
            sitesRemaining = 'Unlimited';
          } else {
            sitesRemaining = Math.max(0, siteLimit - sitesActive).toString();
          }
        }
      } catch (usageError) {
        console.log('⚠️ Could not get site usage for AWeber data:', usageError.message);
      }
    }

    // Prepare enhanced data for Pabbly Connect webhook
    const pabblyData = {
      // Core data
      email: email,
      license_key: licenseKey,
      license_type: licenseType,
      
      // AWeber custom fields (your 4 fields)
      installs_remaining: sitesRemaining,
      sites_active: sitesActive.toString(),
      next_renewal: metadata.renewal_date ? 
        (typeof metadata.renewal_date === 'string' ? metadata.renewal_date.split('T')[0] : metadata.renewal_date.toISOString().split('T')[0]) :
        (licenseType === 'lifetime_unlimited' ? 'Never' : 'Unknown'),
      
      // Customer context
      customer_name: metadata.customer_name || '',
      website_url: metadata.website_url || '',
      site_url: metadata.site_url || '',
      
      // Purchase data
      purchase_amount: metadata.purchase_amount || '0',
      currency: metadata.currency || 'USD',
      payment_processor: metadata.payment_processor || 'stripe',
      
      // Timing data
      signup_date: new Date().toISOString(),
      trial_expires: metadata.trial_expires || '',
      
      // AWeber list and tagging
      aweber_list: 'siteoverlay-pro-buyers',
      aweber_tags: [
        'SiteOverlay Pro',
        licenseType === 'trial' ? 'Trial User' : 'Paying Customer',
        licenseType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
        metadata.payment_processor ? metadata.payment_processor.toUpperCase() : 'STRIPE'
      ].join(','),
      
      // Email template variables
      product_name: 'SiteOverlay Pro',
      trial_duration: '14 days',
      support_email: 'support@siteoverlaypro.com',
      login_instructions: 'Go to WordPress Admin → Settings → SiteOverlay Pro'
    };

    console.log('Sending to Pabbly Connect:', { email, licenseKey, licenseType, sitesActive, sitesRemaining });

    // Send to Pabbly Connect webhook
    if (process.env.PABBLY_WEBHOOK_URL) {
      const response = await fetch(process.env.PABBLY_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pabblyData)
      });

      if (response.ok) {
        console.log('✅ Pabbly webhook sent successfully');
        return true;
      } else {
        console.error('❌ Pabbly webhook failed:', response.status, response.statusText);
        return false;
      }
    } else {
      console.log('⚠️ No Pabbly webhook URL configured');
      return false;
    }

  } catch (error) {
    console.error('❌ Pabbly webhook error:', error);
    return false;
  }
}

module.exports = {
  sendToPabbly
}; 