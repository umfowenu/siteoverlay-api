const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const DashboardController = require('../controllers/dashboard');
const LicenseController = require('../controllers/license');
const CustomerController = require('../controllers/customer');

// Dashboard routes
router.get('/dashboard', adminAuth, DashboardController.getStats);
router.get('/health', adminAuth, DashboardController.getSystemHealth);

// License management routes
router.post('/search', adminAuth, LicenseController.search);
router.post('/kill-switch', adminAuth, LicenseController.toggleKillSwitch);
router.post('/update-installs', adminAuth, LicenseController.updateInstalls);
router.post('/extend-trial', adminAuth, LicenseController.extendTrial);
router.post('/convert-lifetime', adminAuth, LicenseController.convertToLifetime);
router.post('/enable-license', adminAuth, LicenseController.enableLicense);

// Customer management routes
router.post('/customer-data', adminAuth, CustomerController.getCustomerData);
router.post('/kill-customer', adminAuth, CustomerController.killCustomerLicenses);

// New data retrieval routes
router.get('/purchasers', adminAuth, LicenseController.getAllPurchasers);
router.get('/trials', adminAuth, LicenseController.getAllTrials);

// New license control route
router.post('/toggle-status', adminAuth, LicenseController.toggleLicenseStatus);

module.exports = router; 