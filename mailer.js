const nodemailer = require('nodemailer');
const db = require('./db');

// Create SMTP transporter
function createTransporter() {
  return nodemailer.createTransporter({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

// Send license delivery email
async function sendLicenseEmail(customerEmail, customerName, licenseKey, licenseType) {
  const transporter = createTransporter();

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your SiteOverlay Pro License</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .license-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #28a745; }
            .button { display: inline-block; background: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>ðŸŽ‰ Welcome to SiteOverlay Pro!</h1>
                <p>Your license is ready to activate</p>
            </div>

            <div class="content">
                <h2>Hi ${customerName || 'Valued Customer'},</h2>

                <p>Thank you for purchasing SiteOverlay Pro from <strong>eBiz360</strong>! Your ${licenseType} license is now ready to use.</p>

                <div class="license-box">
                    <h3>ðŸ“‹ Your License Details</h3>
                    <p><strong>License Key:</strong> <code style="background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${licenseKey}</code></p>
                    <p><strong>License Type:</strong> ${licenseType}</p>
                    <p><strong>Status:</strong> Active</p>
                </div>

                <h3>ðŸš€ Next Steps:</h3>
                <ol>
                    <li>Download the SiteOverlay Pro plugin from your account area</li>
                    <li>Install the plugin on your WordPress site</li>
                    <li>Go to Settings â†’ SiteOverlay License in your WordPress admin</li>
                    <li>Enter your license key above to activate</li>
                </ol>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://siteoverlaypro.com/my-account" class="button">Access Your Account</a>
                    <a href="https://siteoverlaypro.com/documentation" class="button" style="background: #6c757d;">View Documentation</a>
                </div>

                <h3>ðŸ’¡ Need Help?</h3>
                <p>Our support team at eBiz360 is here to help:</p>
                <ul>
                    <li>ðŸ“§ Email: <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></li>
                    <li>ðŸ“š Documentation: <a href="https://siteoverlaypro.com/docs">siteoverlaypro.com/docs</a></li>
                    <li>ðŸŽ¥ Video Tutorials: <a href="https://siteoverlaypro.com/tutorials">siteoverlaypro.com/tutorials</a></li>
                </ul>

                <p>Thank you for choosing SiteOverlay Pro by eBiz360!</p>
            </div>

            <div class="footer">
                <p><strong>eBiz360</strong><br>
                Professional WordPress Solutions<br>
                <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></p>
                <p><small>This email was sent because you purchased SiteOverlay Pro. If you have questions, please contact our support team.</small></p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"eBiz360 Support" <support@ebiz360.com>',
    to: customerEmail,
    subject: 'Your SiteOverlay Pro License Key - Ready to Activate!',
    html: htmlTemplate
  };

  try {
    await transporter.sendMail(mailOptions);

    // Log email activity
    await db.query(
      'UPDATE licenses SET last_email_sent = NOW(), email_opens = email_opens + 1 WHERE license_key = $1',
      [licenseKey]
    );

    console.log('License email sent successfully to:', customerEmail);
    return { success: true };
  } catch (error) {
    console.error('Error sending license email:', error);
    return { success: false, error: error.message };
  }
}

// Send trial start notification
async function sendTrialStartEmail(customerEmail, trialLicenseKey) {
  const transporter = createTransporter();

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your SiteOverlay Pro Trial Started</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ffc107 0%, #ff8c00 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .trial-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
            .button { display: inline-block; background: #007cba; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>ðŸš€ Your 14-Day Trial Started!</h1>
                <p>Welcome to SiteOverlay Pro</p>
            </div>

            <div class="content">
                <h2>Hi there!</h2>

                <p>Great news! Your 14-day free trial of SiteOverlay Pro from <strong>eBiz360</strong> has started successfully.</p>

                <div class="trial-box">
                    <h3>â° Trial Details</h3>
                    <p><strong>Trial License:</strong> <code style="background: #e9ecef; padding: 4px 8px; border-radius: 4px; font-family: monospace;">${trialLicenseKey}</code></p>
                    <p><strong>Duration:</strong> 14 days</p>
                    <p><strong>Features:</strong> Full access to all SiteOverlay Pro features</p>
                </div>

                <h3>ðŸŽ¯ Make the Most of Your Trial:</h3>
                <ul>
                    <li>âœ… Create your first overlay in under 5 minutes</li>
                    <li>âœ… Test the rank & rent functionality</li>
                    <li>âœ… Try the lead generation features</li>
                    <li>âœ… Explore the client management tools</li>
                </ul>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://siteoverlaypro.com/quick-start" class="button">Quick Start Guide</a>
                    <a href="https://siteoverlaypro.com/tutorials" class="button" style="background: #6c757d;">Watch Tutorials</a>
                </div>

                <h3>ðŸ’° Ready to Upgrade?</h3>
                <p>When you're ready to continue beyond the trial, choose from our plans:</p>
                <ul>
                    <li><strong>Professional:</strong> $35/month - Up to 5 sites</li>
                    <li><strong>Unlimited:</strong> $297 one-time - Unlimited sites, lifetime access</li>
                </ul>

                <div style="text-align: center; margin: 20px 0;">
                    <a href="https://siteoverlaypro.com/upgrade" class="button" style="background: #28a745;">Upgrade Now</a>
                </div>

                <h3>ðŸ†˜ Need Help?</h3>
                <p>Our eBiz360 support team is here to help you succeed:</p>
                <ul>
                    <li>ðŸ“§ Email: <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></li>
                    <li>ðŸ“š Documentation: <a href="https://siteoverlaypro.com/docs">siteoverlaypro.com/docs</a></li>
                </ul>

                <p>Enjoy your trial!</p>
            </div>

            <div class="footer">
                <p><strong>eBiz360</strong><br>
                Professional WordPress Solutions<br>
                <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"eBiz360 Support" <support@ebiz360.com>',
    to: customerEmail,
    subject: 'ðŸš€ Your SiteOverlay Pro Trial Started - 14 Days of Full Access!',
    html: htmlTemplate
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Trial start email sent successfully to:', customerEmail);
    return { success: true };
  } catch (error) {
    console.error('Error sending trial start email:', error);
    return { success: false, error: error.message };
  }
}

// Send trial expiration reminder (3 days before)
async function sendTrialReminderEmail(customerEmail, daysLeft) {
  const transporter = createTransporter();

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your SiteOverlay Pro Trial Expires Soon</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .warning-box { background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107; }
            .button { display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>â° Trial Ending Soon!</h1>
                <p>Don't lose access to SiteOverlay Pro</p>
            </div>

            <div class="content">
                <h2>Hi there!</h2>

                <p>Your SiteOverlay Pro trial from <strong>eBiz360</strong> expires in <strong>${daysLeft} days</strong>.</p>

                <div class="warning-box">
                    <h3>âš ï¸ Action Required</h3>
                    <p><strong>Trial ends in:</strong> ${daysLeft} days</p>
                    <p><strong>What happens next:</strong> Plugin will be deactivated unless you upgrade</p>
                </div>

                <h3>ðŸš€ Continue Your Success</h3>
                <p>Don't let your progress stop! Upgrade now to keep using SiteOverlay Pro:</p>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                        <div style="flex: 1; margin-right: 10px; padding: 15px; border: 2px solid #007cba; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #007cba;">Professional</h4>
                            <p style="font-size: 24px; font-weight: bold; margin: 0; color: #007cba;">$35/month</p>
                            <p style="margin: 5px 0 0 0; color: #666;">Up to 5 sites</p>
                        </div>
                        <div style="flex: 1; margin-left: 10px; padding: 15px; border: 2px solid #28a745; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #28a745;">Unlimited</h4>
                            <p style="font-size: 24px; font-weight: bold; margin: 0; color: #28a745;">$297 once</p>
                            <p style="margin: 5px 0 0 0; color: #666;">Unlimited sites, lifetime</p>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://siteoverlaypro.com/upgrade" class="button" style="background: #28a745; font-size: 18px; padding: 15px 30px;">Upgrade Now - Don't Lose Access!</a>
                </div>

                <h3>â“ Questions?</h3>
                <p>Our eBiz360 team is here to help:</p>
                <ul>
                    <li>ðŸ“§ Email: <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></li>
                    <li>ðŸ’¬ We're here to answer any questions about upgrading</li>
                </ul>

                <p>Don't wait - secure your license today!</p>
            </div>

            <div class="footer">
                <p><strong>eBiz360</strong><br>
                Professional WordPress Solutions<br>
                <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"eBiz360 Support" <support@ebiz360.com>',
    to: customerEmail,
    subject: `â° Your SiteOverlay Pro Trial Expires in ${daysLeft} Days - Upgrade Now!`,
    html: htmlTemplate
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Trial reminder email sent successfully to:', customerEmail);
    return { success: true };
  } catch (error) {
    console.error('Error sending trial reminder email:', error);
    return { success: false, error: error.message };
  }
}

// Send trial expired notification
async function sendTrialExpiredEmail(customerEmail) {
  const transporter = createTransporter();

  const htmlTemplate = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your SiteOverlay Pro Trial Has Expired</title>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #6c757d 0%, #495057 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 8px 8px; }
            .expired-box { background: #f8d7da; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc3545; }
            .button { display: inline-block; background: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 10px 0; }
            .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>Trial Expired</h1>
                <p>Reactivate SiteOverlay Pro today</p>
            </div>

            <div class="content">
                <h2>Hi there!</h2>

                <p>Your 14-day trial of SiteOverlay Pro from <strong>eBiz360</strong> has expired.</p>

                <div class="expired-box">
                    <h3>ðŸ”’ Plugin Deactivated</h3>
                    <p>Your SiteOverlay Pro plugin has been automatically deactivated. To continue using all the powerful features, please upgrade to a full license.</p>
                </div>

                <h3>ðŸš€ Reactivate in Minutes</h3>
                <p>Get back to growing your business with SiteOverlay Pro:</p>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                        <div style="flex: 1; margin-right: 10px; padding: 15px; border: 2px solid #007cba; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #007cba;">Professional</h4>
                            <p style="font-size: 24px; font-weight: bold; margin: 0; color: #007cba;">$35/month</p>
                            <p style="margin: 5px 0 0 0; color: #666;">Up to 5 sites</p>
                        </div>
                        <div style="flex: 1; margin-left: 10px; padding: 15px; border: 2px solid #28a745; border-radius: 8px;">
                            <h4 style="margin: 0 0 10px 0; color: #28a745;">Unlimited</h4>
                            <p style="font-size: 24px; font-weight: bold; margin: 0; color: #28a745;">$297 once</p>
                            <p style="margin: 5px 0 0 0; color: #666;">Unlimited sites, lifetime</p>
                        </div>
                    </div>
                </div>

                <div style="text-align: center; margin: 30px 0;">
                    <a href="https://siteoverlaypro.com/upgrade" class="button" style="background: #28a745; font-size: 18px; padding: 15px 30px;">Reactivate Now</a>
                </div>

                <h3>ðŸ’¡ Why Customers Love SiteOverlay Pro</h3>
                <ul>
                    <li>âœ… Professional overlay system for any website</li>
                    <li>âœ… Perfect for rank & rent businesses</li>
                    <li>âœ… Advanced lead generation tools</li>
                    <li>âœ… Easy client management</li>
                    <li>âœ… Works on any platform</li>
                </ul>

                <h3>ðŸ†˜ Need Help?</h3>
                <p>Our eBiz360 support team is ready to assist:</p>
                <ul>
                    <li>ðŸ“§ Email: <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></li>
                    <li>ðŸ’¬ Questions about upgrading? We're here to help!</li>
                </ul>

                <p>Thank you for trying SiteOverlay Pro. We hope to see you back soon!</p>
            </div>

            <div class="footer">
                <p><strong>eBiz360</strong><br>
                Professional WordPress Solutions<br>
                <a href="mailto:support@ebiz360.com">support@ebiz360.com</a></p>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"eBiz360 Support" <support@ebiz360.com>',
    to: customerEmail,
    subject: 'ðŸ”’ Your SiteOverlay Pro Trial Has Expired - Reactivate Today',
    html: htmlTemplate
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Trial expired email sent successfully to:', customerEmail);
    return { success: true };
  } catch (error) {
    console.error('Error sending trial expired email:', error);
    return { success: false, error: error.message };
  }
}

// Monitor and send trial emails automatically
async function monitorTrials() {
  try {
    // Find trials expiring in 3 days
    const threeDayReminders = await db.query(`
      SELECT DISTINCT ec.email, l.license_key 
      FROM email_collection ec
      JOIN licenses l ON ec.license_key = l.license_key
      WHERE l.status = 'trial' 
      AND l.created_at <= NOW() - INTERVAL '11 days'
      AND l.created_at > NOW() - INTERVAL '12 days'
      AND l.last_email_sent IS NULL OR l.last_email_sent < NOW() - INTERVAL '1 day'
    `);

    for (const row of threeDayReminders.rows) {
      await sendTrialReminderEmail(row.email, 3);
    }

    // Find trials expiring in 1 day
    const oneDayReminders = await db.query(`
      SELECT DISTINCT ec.email, l.license_key 
      FROM email_collection ec
      JOIN licenses l ON ec.license_key = l.license_key
      WHERE l.status = 'trial' 
      AND l.created_at <= NOW() - INTERVAL '13 days'
      AND l.created_at > NOW() - INTERVAL '14 days'
      AND (l.last_email_sent IS NULL OR l.last_email_sent < NOW() - INTERVAL '1 day')
    `);

    for (const row of oneDayReminders.rows) {
      await sendTrialReminderEmail(row.email, 1);
    }

    // Find expired trials
    const expiredTrials = await db.query(`
      SELECT DISTINCT ec.email, l.license_key 
      FROM email_collection ec
      JOIN licenses l ON ec.license_key = l.license_key
      WHERE l.status = 'trial' 
      AND l.created_at <= NOW() - INTERVAL '14 days'
      AND (l.last_email_sent IS NULL OR l.last_email_sent < NOW() - INTERVAL '1 day')
    `);

    for (const row of expiredTrials.rows) {
      await sendTrialExpiredEmail(row.email);
      // Update license status to expired
      await db.query('UPDATE licenses SET status = $1 WHERE license_key = $2', ['expired', row.license_key]);
    }

    console.log('Trial monitoring completed');
  } catch (error) {
    console.error('Error monitoring trials:', error);
  }
}

// Test email configuration
async function testEmailConfig() {
  const transporter = createTransporter();

  try {
    await transporter.verify();
    console.log('âœ… Email configuration is valid');
    return { success: true };
  } catch (error) {
    console.error('âŒ Email configuration error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendLicenseEmail,
  sendTrialStartEmail,
  sendTrialReminderEmail,
  sendTrialExpiredEmail,
  monitorTrials,
  testEmailConfig
};
