// License type mapping utilities
const crypto = require('crypto');

// Get license type from Stripe price ID
function getLicenseTypeFromStripePrice(priceId) {
  const priceMapping = {
    // Production/Live Price IDs
    'price_1RkGCpBnsFQAR5m9DrXgUzoU': '5_site_license',           // Live: 5 Sites
    'price_1RmEjHBnsFQAR5m9D9zBFmJf': 'annual_unlimited',        // Live: Annual Unlimited  
    'price_1RkGEXBnsFQAR5m9tYO2qQ6v': 'lifetime_unlimited',      // Live: Lifetime Unlimited
    
    // Test/Sandbox Price IDs
    'price_1RkFGwBnsFQAR5m9Mqu8gTJQ': '5_site_license',           // Test: 5 Sites
    'price_1RmEsBBnsFQAR5m9CcwlIovq': 'annual_unlimited',        // Test: Annual Unlimited
    'price_1RkFIiBnsFQAR5m9qNGDmIxN': 'lifetime_unlimited'       // Test: Lifetime Unlimited
  };
  return priceMapping[priceId] || '5_site_license';
}

// Get license type from PayPal amount
function getLicenseTypeFromPayPalAmount(amount) {
  if (amount >= 297) return 'lifetime_unlimited';     // $297+ = Lifetime
  if (amount >= 97) return 'annual_unlimited';        // $97+ = Annual  
  return '5_site_license';                            // Under $97 = 5 Sites
}

// Get license type from WarriorPlus product ID
function getLicenseTypeFromWarriorPlusProduct(productId) {
  const productMapping = {
    'WP001': '5_site_license',
    'WP002': 'annual_unlimited',
    'WP003': 'lifetime_unlimited'
  };
  return productMapping[productId] || '5_site_license';
}

// Get site limit from license type
function getSiteLimitFromLicenseType(licenseType) {
  switch (licenseType) {
    case 'trial':
    case '5_site_license':
      return 5;
    case 'annual_unlimited':
    case 'lifetime_unlimited':
      return -1; // Unlimited
    default:
      return 5;
  }
}

// Generate license key
function generateLicenseKey() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

// Generate site signature for unique identification
function generateSiteSignature(siteData) {
  const signatureData = `${siteData.site_domain}${siteData.site_path}${siteData.abspath}`;
  return crypto.createHash('md5').update(signatureData).digest('hex');
}

module.exports = {
  getLicenseTypeFromStripePrice,
  getLicenseTypeFromPayPalAmount,
  getLicenseTypeFromWarriorPlusProduct,
  getSiteLimitFromLicenseType,
  generateLicenseKey,
  generateSiteSignature
}; 