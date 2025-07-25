<?php
/**
 * Plugin Name: SiteOverlay Pro
 * Plugin URI: https://siteoverlay.24hr.pro/
 * Description: Professional rank and rent overlay system for WordPress. Create custom overlays for any page or post with advanced targeting and analytics.
 * Version: 2.0.1
 * Author: eBiz360
 * Author URI: https://ebiz360.ca/
 * License: GPL v2 or later
 * Text Domain: siteoverlay-rr
 * Domain Path: /languages
 * Requires at least: 5.0
 * Tested up to: 6.4
 * Requires PHP: 7.4
 * Network: false
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

// Define constants
define('SITEOVERLAY_RR_VERSION', '2.0.1');
define('SITEOVERLAY_RR_PLUGIN_URL', plugin_dir_url(__FILE__));
define('SITEOVERLAY_RR_PLUGIN_PATH', plugin_dir_path(__FILE__));

/**
 * SiteOverlay Pro - Fixed License Enforcement
 */
class SiteOverlay_Pro {
    
    private $api_base_url = 'https://siteoverlay-api-production.up.railway.app/api';
    
    public function __construct() {
        // Basic initialization
        add_action('init', array($this, 'init'));
        
        // Admin functionality
        if (is_admin()) {
            add_action('admin_init', array($this, 'admin_init'));
            add_action('admin_menu', array($this, 'add_admin_menu'));
            
            // ALWAYS add meta boxes - content changes based on license status
            add_action('add_meta_boxes', array($this, 'add_meta_boxes'));
            add_action('admin_enqueue_scripts', array($this, 'admin_enqueue_scripts'));
            
            // AJAX handlers for overlay functionality - ONLY when licensed
            if ($this->is_licensed()) {
                add_action('wp_ajax_siteoverlay_save_url', array($this, 'ajax_save_overlay'));
                add_action('wp_ajax_siteoverlay_remove_url', array($this, 'ajax_remove_overlay'));
                add_action('wp_ajax_siteoverlay_preview_url', array($this, 'ajax_preview_overlay'));
            }
            
            // License management AJAX handlers (always available)
            add_action('wp_ajax_siteoverlay_trial_license', array($this, 'ajax_trial_license'));
            add_action('wp_ajax_siteoverlay_validate_license', array($this, 'ajax_validate_license'));
        }
        
        // CRITICAL FIX: Frontend overlay display ONLY when licensed
        if ($this->is_licensed()) {
            add_action('wp_head', array($this, 'display_overlay'));
        }
        
        // Load overlay enhancement (optional, modular) - ONLY when licensed
        if ($this->is_licensed()) {
            $enhancement_file = SITEOVERLAY_RR_PLUGIN_PATH . 'includes/class-overlay-enhancement.php';
            if (file_exists($enhancement_file)) {
                require_once $enhancement_file;
            }
        }
    }
    
    public function init() {
        // Load textdomain
        load_plugin_textdomain('siteoverlay-rr', false, dirname(plugin_basename(__FILE__)) . '/languages');
    }
    
    public function admin_init() {
        // Register settings
        register_setting('siteoverlay_settings', 'siteoverlay_urls');
        
        // Admin Notice System
        add_action('admin_notices', array($this, 'display_admin_notices'));
    }
    
    public function add_admin_menu() {
        add_options_page(
            'SiteOverlay Pro Settings',
            'SiteOverlay Pro',
            'manage_options',
            'siteoverlay-settings',
            array($this, 'render_admin_page')
        );
    }
    
    public function render_admin_page() {
        // Debug form and logic
        if (isset($_POST['debug_license'])) {
            echo '<div class="notice notice-info" style="padding: 20px;">';
            echo '<h3>Detailed Debug Results:</h3>';
            // Clear cache first
            delete_transient('siteoverlay_license_last_check');
            delete_option('siteoverlay_license_data');
            echo '1. Cache cleared<br>';
            // DEBUG THE URL CONSTRUCTION
            $full_url = $this->api_base_url . '/validate-license';
            echo '1.5. Full API URL being called: [' . $full_url . ']<br>';
            echo '1.6. API base URL: [' . $this->api_base_url . ']<br>';
            // Make direct API call
            $license_key = get_option('siteoverlay_license_key', '');
            $site_url = get_site_url();
            if ($license_key) {
                $api_response = wp_remote_post($full_url, array(
                    'body' => json_encode(array(
                        'licenseKey' => $license_key,
                        'siteUrl' => $site_url
                    )),
                    'headers' => array('Content-Type' => 'application/json'),
                    'timeout' => 30
                ));
                echo '2. Raw API Response: <pre>' . print_r($api_response, true) . '</pre><br>';
                if (!is_wp_error($api_response)) {
                    $body = wp_remote_retrieve_body($api_response);
                    echo '3. API Response Body: <pre>' . $body . '</pre><br>';
                    $decoded = json_decode($body, true);
                    echo '4. Decoded JSON: <pre>' . print_r($decoded, true) . '</pre><br>';
                }
            } else {
                echo '2. No license key found to test<br>';
            }
            // Test license check
            $result = $this->is_licensed();
            echo '5. Final is_licensed() result: ' . ($result ? 'ACTIVE' : 'INACTIVE') . '<br>';
            echo '</div>';
        }
        echo '<form method="post"><input type="submit" name="debug_license" value="🔍 Debug & Test License" class="button"></form>';
        
        // Get usage statistics
        global $wpdb;
        
        // Get license status
        $license_status = $this->get_license_status();
        
        // Count posts with overlays
        $posts_with_overlays = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT COUNT(DISTINCT post_id) FROM {$wpdb->postmeta} WHERE meta_key = %s",
                '_siteoverlay_overlay_url'
            )
        );
        
        // Get total views
        $total_views = $wpdb->get_var(
            $wpdb->prepare(
                "SELECT SUM(meta_value) FROM {$wpdb->postmeta} WHERE meta_key = %s AND meta_value REGEXP '^[0-9]+$'",
                '_siteoverlay_overlay_views'
            )
        );
        
        // Get recent overlays
        $recent_overlays = $wpdb->get_results(
            $wpdb->prepare(
                "SELECT p.ID, p.post_title, pm.meta_value as overlay_url, pm2.meta_value as views, pm3.meta_value as updated
                 FROM {$wpdb->posts} p
                 INNER JOIN {$wpdb->postmeta} pm ON p.ID = pm.post_id
                 LEFT JOIN {$wpdb->postmeta} pm2 ON p.ID = pm2.post_id AND pm2.meta_key = %s
                 LEFT JOIN {$wpdb->postmeta} pm3 ON p.ID = pm3.post_id AND pm3.meta_key = %s
                 WHERE pm.meta_key = %s AND p.post_status = 'publish'
                 ORDER BY pm3.meta_value DESC
                 LIMIT 10",
                '_siteoverlay_overlay_views',
                '_siteoverlay_overlay_updated',
                '_siteoverlay_overlay_url'
            )
        );
        ?>
        <div class="wrap">
            <h1>SiteOverlay Pro Settings</h1>
            
            <!-- Logo Section -->
            <div style="text-align: center; padding: 20px 0; background: white; border: 1px solid #ddd; margin-bottom: 20px;">
                <img src="https://page1.genspark.site/v1/base64_upload/fe1edd2c48ac954784b3e58ed66b0764" alt="SiteOverlay Pro" style="max-width: 300px; height: auto;" />
            </div>
            
            <!-- Status Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px;">
                <?php if ($license_status['features_enabled']): ?>
                <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #155724;">✓ Plugin Active</h3>
                    <p style="margin: 0; color: #155724;">SiteOverlay Pro is running successfully</p>
                </div>
                <?php else: ?>
                <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #721c24;">🔒 Plugin Inactive</h3>
                    <p style="margin: 0; color: #721c24;">Activate your license to use SiteOverlay Pro</p>
                </div>
                <?php endif; ?>
                
                <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #0c5460;">📊 Usage Statistics</h3>
                    <p style="margin: 0; color: #0c5460;">
                        <strong><?php echo $posts_with_overlays ?: '0'; ?></strong> posts with overlays<br>
                        <strong><?php echo $total_views ?: '0'; ?></strong> total views
                    </p>
                </div>
                
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 5px;">
                    <h3 style="margin: 0 0 10px 0; color: #856404;">🚀 Get Xagio</h3>
                    <p style="margin: 0; color: #856404;">Boost your SEO rankings</p>
                    <a href="https://xagio.net/?ref=siteoverlay" target="_blank" class="button button-primary" style="margin-top: 10px;">Get Xagio Now</a>
                </div>
            </div>
            
            <!-- License Status Section -->
            <div style="background: white; border: 1px solid #ddd; padding: 20px; margin-bottom: 20px;">
                <h2>License Status</h2>
                
                <?php 
                $is_registered = get_option('siteoverlay_registration_name');
                $should_disable_trial = $this->should_disable_trial_button();
                ?>
                
                <!-- License State Interface -->
                <?php if ($license_status['state'] === 'unlicensed'): ?>
                    <!-- UNLICENSED STATE -->
                    <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                        <h3 style="margin: 0 0 15px 0; color: #856404;">🎯 Get Started with SiteOverlay Pro</h3>
                        <p style="margin: 0 0 20px 0; color: #856404;">Choose how you'd like to activate SiteOverlay Pro:</p>
                        
                        <div style="display: flex; gap: 20px; margin-bottom: 20px;">
                            <button type="button" class="button button-primary" id="show-trial-form">Start 14-Day Free Trial</button>
                            <button type="button" class="button button-secondary" id="show-license-form">Enter License Key</button>
                        </div>
                        
                        <!-- Trial Registration Form -->
                        <div id="trial-registration-form" style="display: none; background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 15px;">
                            <h4 style="margin: 0 0 15px 0; color: #495057;">Register for Free Trial</h4>
                            <p style="margin: 0 0 15px 0; color: #6c757d; font-size: 14px;">Enter your details below to receive your 14-day trial license key via email.</p>
                            
                            <div style="margin-bottom: 15px;">
                                <label for="full-name" style="display: block; margin-bottom: 5px; font-weight: bold;">Full Name:</label>
                                <input type="text" id="full-name" placeholder="Enter your full name" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" />
                            </div>
                            
                            <div style="margin-bottom: 15px;">
                                <label for="email-address" style="display: block; margin-bottom: 5px; font-weight: bold;">Email Address:</label>
                                <input type="email" id="email-address" placeholder="Enter your email address" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" />
                            </div>
                            
                            <button type="button" class="button button-primary" id="submit-trial-registration">Submit Registration</button>
                        </div>
                        
                        <!-- License Key Form -->
                        <div id="license-form" style="display: none; background: #f8f9fa; padding: 15px; border-radius: 5px; margin-top: 15px;">
                            <h4 style="margin: 0 0 15px 0; color: #495057;">Enter License Key</h4>
                            <p style="margin: 0 0 15px 0; color: #6c757d; font-size: 14px;">Enter the license key that was emailed to you after purchase.</p>
                            
                            <div style="margin-bottom: 15px;">
                                <label for="license-key" style="display: block; margin-bottom: 5px; font-weight: bold;">License Key:</label>
                                <input type="text" id="license-key" placeholder="Enter your license key" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 3px;" />
                            </div>
                            
                            <button type="button" class="button button-primary" id="validate-license">Activate License</button>
                        </div>
                        
                        <!-- Purchase Options for Unlicensed Users -->
                        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-top: 20px;">
                            <h4 style="margin: 0 0 15px 0; color: #856404;">🚀 Or Purchase a License</h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Professional</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$35/month</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Up to 5 websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=professional" target="_blank" class="button button-primary">Get Professional</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Annual Unlimited</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$197/year</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Unlimited websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=annual" target="_blank" class="button button-primary">Get Annual</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Lifetime</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$297</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">One-time payment</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=lifetime" target="_blank" class="button button-primary">Get Lifetime</a>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                <?php elseif ($license_status['state'] === 'pending'): ?>
                    <!-- PENDING STATE -->
                    <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                        <h3 style="margin: 0 0 15px 0; color: #0c5460;">📧 Check Your Email</h3>
                        <p style="margin: 0 0 15px 0; color: #0c5460;">
                            Registration submitted successfully! Please check your email (<strong><?php echo esc_html(get_option('siteoverlay_registration_email')); ?></strong>) for your trial license key.
                        </p>
                        <p style="margin: 0 0 15px 0; color: #0c5460;">Once you receive the license key, enter it below to activate your trial.</p>
                        
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <h4 style="margin: 0 0 15px 0; color: #495057;">Enter Your Trial License Key</h4>
                            <input type="text" id="license-key" placeholder="Enter your trial license key" style="width: 300px; padding: 8px; margin-right: 10px;" />
                            <button type="button" class="button button-primary" id="validate-license">Activate Trial</button>
                        </div>
                    </div>
                    
                <?php elseif ($license_status['state'] === 'trial_active'): ?>
                    <!-- TRIAL ACTIVE STATE -->
                    <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                        <?php if ($license_status['days_remaining'] <= 7): ?>
                            <h3 style="margin: 0 0 15px 0; color: #dc3545;">⚠️ Trial expires in <?php echo $license_status['days_remaining']; ?> days! Upgrade to continue</h3>
                        <?php else: ?>
                            <h3 style="margin: 0 0 15px 0; color: #0c5460;">⏰ Trial Active - <?php echo $license_status['days_remaining']; ?> days remaining</h3>
                        <?php endif; ?>
                        
                        <p style="margin: 0 0 15px 0; color: #0c5460;">
                            <strong>License Key:</strong> <?php echo esc_html(get_option('siteoverlay_license_key')); ?><br>
                            <strong>Expires:</strong> <?php echo $license_status['expiry']; ?><br>
                            <strong>Registered Email:</strong> <?php echo esc_html(get_option('siteoverlay_registration_email')); ?>
                        </p>
                        
                        <!-- Purchase Options Display -->
                        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                            <h4 style="margin: 0 0 15px 0; color: #856404;">🚀 Upgrade to Full License</h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Professional</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$35/month</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Up to 5 websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=professional" target="_blank" class="button button-primary">Get Professional</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Annual Unlimited</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$197/year</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Unlimited websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=annual" target="_blank" class="button button-primary">Get Annual</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Lifetime</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$297</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">One-time payment</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=lifetime" target="_blank" class="button button-primary">Get Lifetime</a>
                                </div>
                            </div>
                        </div>
                        
                        <button type="button" class="button button-secondary" id="show-license-form">Enter License Key</button>
                        
                        <div id="license-form" style="display: none; margin-top: 15px; background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <h4 style="margin: 0 0 15px 0; color: #495057;">Enter Your License Key</h4>
                            <input type="text" id="upgrade-license-key" placeholder="Enter your license key" style="width: 300px; padding: 8px; margin-right: 10px;" />
                            <button type="button" class="button button-primary" id="validate-upgrade-license">Activate License</button>
                        </div>
                    </div>
                    
                <?php elseif ($license_status['state'] === 'trial_expired'): ?>
                    <!-- TRIAL EXPIRED STATE -->
                    <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                        <h3 style="margin: 0 0 15px 0; color: #721c24;">❌ Trial has expired. Enter a paid license to continue</h3>
                        <p style="margin: 0 0 15px 0; color: #721c24;">Your 14-day trial has expired. Please upgrade to a full license to continue using SiteOverlay Pro.</p>
                        
                        <!-- Purchase Options Display -->
                        <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin-bottom: 15px;">
                            <h4 style="margin: 0 0 15px 0; color: #856404;">🚀 Choose Your Plan</h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 15px;">
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Professional</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$35/month</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Up to 5 websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=professional" target="_blank" class="button button-primary">Get Professional</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Annual Unlimited</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$197/year</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">Unlimited websites</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=annual" target="_blank" class="button button-primary">Get Annual</a>
                                </div>
                                <div style="background: white; padding: 15px; border-radius: 5px; text-align: center;">
                                    <h5 style="margin: 0 0 10px 0; color: #495057;">Lifetime</h5>
                                    <p style="margin: 0 0 10px 0; font-size: 24px; font-weight: bold; color: #28a745;">$297</p>
                                    <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 12px;">One-time payment</p>
                                    <a href="https://siteoverlay.24hr.pro/?plan=lifetime" target="_blank" class="button button-primary">Get Lifetime</a>
                                </div>
                            </div>
                        </div>
                        
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 5px;">
                            <h4 style="margin: 0 0 15px 0; color: #495057;">Enter Your License Key</h4>
                            <input type="text" id="license-key" placeholder="Enter your license key" style="width: 300px; padding: 8px; margin-right: 10px;" />
                            <button type="button" class="button button-primary" id="validate-license">Activate License</button>
                        </div>
                    </div>
                    
                <?php elseif ($license_status['state'] === 'licensed'): ?>
                    <!-- LICENSED (PAID) STATE -->
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; margin-bottom: 20px;">
                        <h3 style="margin: 0 0 15px 0; color: #155724;">✅ License Active</h3>
                        <p style="margin: 0; color: #155724;">
                            <strong>Status:</strong> <?php echo ucfirst($license_status['status']); ?><br>
                            <strong>License Key:</strong> <?php echo esc_html(get_option('siteoverlay_license_key')); ?>
                            <?php if ($license_status['expiry']): ?>
                                <br><strong>Expires:</strong> <?php echo $license_status['expiry']; ?>
                            <?php endif; ?>
                            <br><strong>Registered Email:</strong> <?php echo esc_html(get_option('siteoverlay_registration_email')); ?>
                        </p>
                    </div>
                <?php endif; ?>
                
                <div id="license-response" style="margin-top: 10px;"></div>
            </div>
            
            <!-- Recent Overlays - Only show when licensed -->
            <?php if ($license_status['features_enabled']): ?>
                <div style="background: white; border: 1px solid #ddd; padding: 20px; margin-bottom: 20px;">
                    <h2>Recent Overlays</h2>
                    <?php if ($recent_overlays): ?>
                        <table class="wp-list-table widefat fixed striped">
                            <thead>
                                <tr>
                                    <th>Post/Page</th>
                                    <th>Overlay URL</th>
                                    <th>Views</th>
                                    <th>Last Updated</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                <?php foreach ($recent_overlays as $overlay): ?>
                                    <tr>
                                        <td>
                                            <a href="<?php echo get_edit_post_link($overlay->ID); ?>"><?php echo esc_html($overlay->post_title); ?></a>
                                        </td>
                                        <td>
                                            <a href="<?php echo esc_url($overlay->overlay_url); ?>" target="_blank"><?php echo esc_html($overlay->overlay_url); ?></a>
                                        </td>
                                        <td><?php echo $overlay->views ?: '0'; ?></td>
                                        <td><?php echo $overlay->updated ?: 'Never'; ?></td>
                                        <td>
                                            <a href="<?php echo get_edit_post_link($overlay->ID); ?>" class="button button-small">Edit</a>
                                        </td>
                                    </tr>
                                <?php endforeach; ?>
                            </tbody>
                        </table>
                    <?php else: ?>
                        <p>No overlays found. <a href="<?php echo admin_url('post-new.php'); ?>">Create your first overlay</a></p>
                    <?php endif; ?>
                </div>
            <?php else: ?>
                <!-- Overlay Features Locked -->
                <div style="background: #f8f9fa; border: 1px solid #dee2e6; padding: 20px; margin-bottom: 20px; text-align: center;">
                    <h2>🔒 Overlay Features Locked</h2>
                    <p style="margin: 0 0 15px 0; color: #6c757d;">Activate your license to unlock overlay functionality and start creating overlays for your posts and pages.</p>
                    <p style="margin: 0; color: #6c757d;"><strong>Features you'll get:</strong></p>
                    <ul style="text-align: left; display: inline-block; margin: 15px 0; color: #6c757d;">
                        <li>Add overlay URLs to any post or page</li>
                        <li>Track overlay views and performance</li>
                        <li>Preview overlays before publishing</li>
                        <li>Full overlay management interface</li>
                    </ul>
                </div>
            <?php endif; ?>
            
            <!-- Newsletter Section -->
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; text-align: center;">
                <h3 style="margin: 0 0 15px 0; color: #856404;">📧 Get SEO & Rank & Rent Tips</h3>
                <p style="margin: 0 0 15px 0; color: #856404;">Subscribe to our newsletter for free tips and updates</p>
                <input type="email" id="newsletter-email-admin" placeholder="Enter your email" style="padding: 8px; width: 300px; margin-right: 10px;" />
                <button type="button" class="button button-primary" id="subscribe-newsletter-admin">Subscribe</button>
            </div>
        </div>
        
        <script>
        jQuery(document).ready(function($) {
            // Newsletter signup
            $('#subscribe-newsletter-admin').on('click', function() {
                var email = $('#newsletter-email-admin').val();
                if (!email) {
                    alert('Please enter your email address');
                    return;
                }
                
                $.post(ajaxurl, {
                    action: 'siteoverlay_newsletter_signup',
                    email: email,
                    nonce: '<?php echo wp_create_nonce('siteoverlay_overlay_nonce'); ?>'
                }, function(response) {
                    if (response.success) {
                        alert('Thank you for subscribing!');
                        $('#newsletter-email-admin').val('');
                    } else {
                        alert('Error: ' + response.data);
                    }
                });
            });
            
            // License functionality
            $('#show-trial-form').on('click', function() {
                $('#trial-registration-form').show();
                $('#license-form').hide();
            });
            
            $('#show-license-form').on('click', function() {
                $('#license-form').show();
                $('#trial-registration-form').hide();
            });
            
            $('#submit-trial-registration').on('click', function() {
                var fullName = $('#full-name').val();
                var email = $('#email-address').val();
                
                if (!fullName) {
                    alert('Please enter your full name');
                    return;
                }
                
                if (!email) {
                    alert('Please enter your email address');
                    return;
                }
                
                var $btn = $(this);
                var originalText = $btn.text();
                $btn.text('Submitting...').prop('disabled', true);
                
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    timeout: 5000,
                    data: {
                        action: 'siteoverlay_trial_license',
                        full_name: fullName,
                        email: email,
                        nonce: '<?php echo wp_create_nonce('siteoverlay_overlay_nonce'); ?>'
                    },
                    success: function(response) {
                        $('.trial-message').remove();
                        
                        if (response.success) {
                            $('#trial-registration-form').append(
                                '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #d4edda; border: 1px solid #c3e6cb; border-radius: 4px; color: #155724;">' +
                                '<strong>✅ Success!</strong> Details submitted. Check your inbox for the license key to activate trial.' +
                                '</div>'
                            );
                            $('#submit-trial-registration').text('Trial Submitted').prop('disabled', true);
                        } else {
                            $('#trial-registration-form').append(
                                '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;">' +
                                '<strong>❌ Error:</strong> ' + response.data.message +
                                '</div>'
                            );
                        }
                    },
                    error: function(xhr, status, error) {
                        $('.trial-message').remove();
                        
                        if (status === 'timeout') {
                            $('#trial-registration-form').append(
                                '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 4px; color: #856404;">' +
                                '<strong>⚠️ Timeout:</strong> Registration submitted! Please check your email for your trial license key.' +
                                '</div>'
                            );
                        } else {
                            $('#trial-registration-form').append(
                                '<div class="trial-message" style="margin-top: 15px; padding: 10px; background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; color: #721c24;">' +
                                '<strong>❌ Connection Error:</strong> ' + error +
                                '</div>'
                            );
                        }
                    },
                    complete: function() {
                        $btn.text(originalText).prop('disabled', false);
                    }
                });
            });
            
            $('#validate-license').on('click', function() {
                var licenseKey = $('#license-key').val();
                if (!licenseKey) {
                    alert('Please enter a license key');
                    return;
                }
                
                var $btn = $(this);
                var originalText = $btn.text();
                $btn.text('Validating...').prop('disabled', true);
                
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    timeout: 5000,
                    data: {
                        action: 'siteoverlay_validate_license',
                        license_key: licenseKey,
                        nonce: '<?php echo wp_create_nonce('siteoverlay_overlay_nonce'); ?>'
                    },
                    success: function(response) {
                        if (response.success) {
                            $('#license-response').html('<div class="notice notice-success"><p>' + response.data.message + '</p></div>');
                            setTimeout(function() {
                                location.reload();
                            }, 2000);
                        } else {
                            $('#license-response').html('<div class="notice notice-error"><p>Error: ' + response.data + '</p></div>');
                        }
                    },
                    error: function(xhr, status, error) {
                        if (status === 'timeout') {
                            $('#license-response').html('<div class="notice notice-warning"><p>License validation timed out. Please try again.</p></div>');
                        } else {
                            $('#license-response').html('<div class="notice notice-error"><p>Connection error: ' + error + '</p></div>');
                        }
                    },
                    complete: function() {
                        $btn.text(originalText).prop('disabled', false);
                    }
                });
            });
            
            $('#validate-upgrade-license').on('click', function() {
                var licenseKey = $('#upgrade-license-key').val();
                if (!licenseKey) {
                    alert('Please enter a license key');
                    return;
                }
                
                var $btn = $(this);
                var originalText = $btn.text();
                $btn.text('Validating...').prop('disabled', true);
                
                $.ajax({
                    url: ajaxurl,
                    type: 'POST',
                    timeout: 5000,
                    data: {
                        action: 'siteoverlay_validate_license',
                        license_key: licenseKey,
                        nonce: '<?php echo wp_create_nonce('siteoverlay_overlay_nonce'); ?>'
                    },
                    success: function(response) {
                        if (response.success) {
                            $('#license-response').html('<div class="notice notice-success"><p>' + response.data.message + '</p></div>');
                            setTimeout(function() {
                                location.reload();
                            }, 2000);
                        } else {
                            $('#license-response').html('<div class="notice notice-error"><p>Error: ' + response.data + '</p></div>');
                        }
                    },
                    error: function(xhr, status, error) {
                        if (status === 'timeout') {
                            $('#license-response').html('<div class="notice notice-warning"><p>License validation timed out. Please try again.</p></div>');
                        } else {
                            $('#license-response').html('<div class="notice notice-error"><p>Connection error: ' + error + '</p></div>');
                        }
                    },
                    complete: function() {
                        $btn.text(originalText).prop('disabled', false);
                    }
                });
            });
            
            // When user starts typing license key, remove trial message
            $('#license_key').on('input', function() {
                if ($(this).val().length > 0) {
                    $('.trial-message').fadeOut(300, function() {
                        $(this).remove();
                    });
                }
            });
        });
        </script>
        <?php
    }
    
    public function add_meta_boxes() {
        // ALWAYS add meta boxes - content changes based on license status
        $post_types = array('post', 'page');
        foreach ($post_types as $post_type) {
            add_meta_box(
                'siteoverlay-meta-box',
                'SiteOverlay Pro - Overlay Settings',
                array($this, 'render_meta_box'),
                $post_type,
                'side',
                'high'
            );
        }
    }
    
    public function render_meta_box($post) {
        wp_nonce_field('siteoverlay_overlay_nonce', 'siteoverlay_overlay_nonce');
        
        $license_status = $this->get_license_status();
        
        if ($license_status['features_enabled']) {
            // LICENSED STATE: Show full overlay functionality
            $this->render_licensed_meta_box($post);
        } else {
            // UNLICENSED STATE: Show disabled message with trial/purchase options
            $this->render_unlicensed_meta_box($post);
        }
    }
    
    private function render_unlicensed_meta_box($post) {
        ?>
        <div id="siteoverlay-overlay-container">
            <!-- Logo Section -->
            <div style="text-align: center; padding: 10px 0; background: white;">
                <img src="https://page1.genspark.site/v1/base64_upload/fe1edd2c48ac954784b3e58ed66b0764" alt="SiteOverlay Pro" style="max-width: 100%; height: auto;" />
            </div>
            
            <!-- Disabled State Message -->
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; margin: 0; text-align: center;">
                <div style="color: #721c24; font-weight: bold; margin-bottom: 10px;">🔒 Plugin Disabled</div>
                <div style="color: #721c24; font-size: 12px; margin-bottom: 15px;">
                    Overlay functionality requires an active license.<br>
                    Start a free trial or purchase a license to begin creating overlays.
                </div>
                
                <!-- Trial/Purchase Options -->
                <div style="margin-bottom: 10px;">
                    <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>" 
                       class="button button-primary" style="font-size: 11px; padding: 4px 8px; margin: 2px;">
                       🚀 Start Free Trial
                    </a>
                </div>
                
                <div style="margin-bottom: 10px;">
                    <a href="https://siteoverlay.24hr.pro/?plan=professional" 
                       target="_blank" class="button button-secondary" style="font-size: 11px; padding: 4px 8px; margin: 2px;">
                       $35/month
                    </a>
                    <a href="https://siteoverlay.24hr.pro/?plan=annual" 
                       target="_blank" class="button button-secondary" style="font-size: 11px; padding: 4px 8px; margin: 2px;">
                       $197/year
                    </a>
                    <a href="https://siteoverlay.24hr.pro/?plan=lifetime" 
                       target="_blank" class="button button-secondary" style="font-size: 11px; padding: 4px 8px; margin: 2px;">
                       $297 lifetime
                    </a>
                </div>
                
                <div style="font-size: 10px; color: #721c24; margin-top: 10px;">
                    <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>" style="color: #721c24;">
                        Already have a license? Activate it here →
                    </a>
                </div>
            </div>
            
            <!-- Xagio Affiliate Section -->
            <div style="background: #d1ecf1; padding: 15px; text-align: center; margin: 0;">
                <div style="color: #0c5460; font-weight: bold; margin-bottom: 5px;">🚀 Boost Your SEO Rankings</div>
                <div style="color: #0c5460; font-size: 12px; margin-bottom: 10px;">Get Xagio - The #1 SEO Tool for Rank & Rent Success</div>
                <a href="https://xagio.net/?ref=siteoverlay" target="_blank" 
                   style="background: #17a2b8; color: white; padding: 6px 12px; text-decoration: none; border-radius: 3px; font-size: 11px; display: inline-block;">Get Xagio Now</a>
                <div style="color: #0c5460; font-size: 10px; margin-top: 5px;">Affiliate Link - We earn a commission at no cost to you</div>
            </div>
            
            <!-- Email Newsletter Section -->
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; margin: 0;">
                <div style="color: #856404; font-weight: bold; margin-bottom: 8px;">📧 Get SEO & Rank & Rent Tips</div>
                <input type="email" id="newsletter-email" placeholder="Enter your email" 
                       style="width: 100%; padding: 4px; border: 1px solid #ffeaa7; background: white; font-size: 11px; margin-bottom: 8px;" />
                <button type="button" class="button" id="subscribe-newsletter" style="background: #ffc107; border: 1px solid #ffc107; color: #212529; font-size: 11px; padding: 4px 8px; width: 100%;">Subscribe for Free Tips</button>
            </div>
        </div>
        <?php
    }
    
    private function render_licensed_meta_box($post) {
        $overlay_url = get_post_meta($post->ID, '_siteoverlay_overlay_url', true);
        $is_active = !empty($overlay_url);
        ?>
        <div id="siteoverlay-overlay-container">
            <!-- Logo Section -->
            <div style="text-align: center; padding: 10px 0; background: white;">
                <img src="https://page1.genspark.site/v1/base64_upload/fe1edd2c48ac954784b3e58ed66b0764" alt="SiteOverlay Pro" style="max-width: 100%; height: auto;" />
            </div>
            
            <!-- Status Display -->
            <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 8px; text-align: center; font-size: 12px;">
                ✓ <strong>SiteOverlay Pro Active</strong><br>
                👁 <?php echo get_post_meta($post->ID, '_siteoverlay_overlay_views', true) ?: '0'; ?> views
            </div>
            
            <!-- Xagio Affiliate Section -->
            <div style="background: #d1ecf1; padding: 15px; text-align: center; margin: 0;">
                <div style="color: #0c5460; font-weight: bold; margin-bottom: 5px;">🚀 Boost Your SEO Rankings</div>
                <div style="color: #0c5460; font-size: 12px; margin-bottom: 10px;">Get Xagio - The #1 SEO Tool for Rank & Rent Success</div>
                <a href="https://xagio.net/?ref=siteoverlay" target="_blank" 
                   style="background: #17a2b8; color: white; padding: 6px 12px; text-decoration: none; border-radius: 3px; font-size: 11px; display: inline-block;">Get Xagio Now</a>
                <div style="color: #0c5460; font-size: 10px; margin-top: 5px;">Affiliate Link - We earn a commission at no cost to you</div>
            </div>
            
            <!-- Current Overlay Section -->
            <?php if ($is_active): ?>
                <div style="background: #d4edda; border: 1px solid #c3e6cb; padding: 12px; margin: 0;">
                    <div style="color: #155724; font-weight: bold; margin-bottom: 8px;">✓ Overlay Active</div>
                    <div style="color: #155724; font-size: 12px; margin-bottom: 8px;"><strong>Current URL:</strong></div>
                    <input type="url" id="siteoverlay-overlay-url" name="siteoverlay_overlay_url" 
                           value="<?php echo esc_attr($overlay_url); ?>" 
                           placeholder="https://example.com/" 
                           style="width: 100%; padding: 4px; border: 1px solid #c3e6cb; background: white; font-size: 11px; margin-bottom: 8px;" />
                    
                    <div style="display: flex; gap: 5px;">
                        <button type="button" class="button button-secondary" id="edit-overlay" style="font-size: 11px; padding: 2px 6px;">Edit</button>
                        <button type="button" class="button button-secondary" id="preview-overlay" style="font-size: 11px; padding: 2px 6px;">Preview</button>
                        <button type="button" class="button button-link-delete" id="remove-overlay" style="font-size: 11px; padding: 2px 6px;">Remove</button>
                    </div>
                </div>
            <?php else: ?>
                <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; margin: 0;">
                    <div style="color: #856404; font-weight: bold; margin-bottom: 8px;">⚡ Add Overlay URL</div>
                    <div style="color: #856404; font-size: 12px; margin-bottom: 8px;"><strong>Website to Overlay:</strong></div>
                    <input type="url" id="siteoverlay-overlay-url" name="siteoverlay_overlay_url" 
                           value="" 
                           placeholder="https://example.com/" 
                           style="width: 100%; padding: 4px; border: 1px solid #ffeaa7; background: white; font-size: 11px; margin-bottom: 8px;" />
                    
                    <button type="button" class="button button-primary" id="save-overlay" style="font-size: 11px; padding: 2px 6px; width: 100%;">Save Overlay</button>
                </div>
            <?php endif; ?>
            
            <!-- Email Newsletter Section -->
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 12px; margin: 0;">
                <div style="color: #856404; font-weight: bold; margin-bottom: 8px;">📧 Get SEO & Rank & Rent Tips</div>
                <input type="email" id="newsletter-email" placeholder="Enter your email" 
                       style="width: 100%; padding: 4px; border: 1px solid #ffeaa7; background: white; font-size: 11px; margin-bottom: 8px;" />
                <button type="button" class="button" id="subscribe-newsletter" style="background: #ffc107; border: 1px solid #ffc107; color: #212529; font-size: 11px; padding: 4px 8px; width: 100%;">Subscribe for Free Tips</button>
            </div>
            
            <!-- Stats Section -->
            <div style="padding: 8px 12px; color: #666; font-size: 10px; border-top: 1px solid #ddd;">
                Views: <?php echo get_post_meta($post->ID, '_siteoverlay_overlay_views', true) ?: '0'; ?> | 
                Last Updated: <?php echo get_post_meta($post->ID, '_siteoverlay_overlay_updated', true) ?: 'Never'; ?>
            </div>
            
            <div id="siteoverlay-response" style="margin-top: 10px;"></div>
        </div>
        
        <style>
        .siteoverlay-response.success {
            color: #00a32a;
            font-weight: bold;
        }
        .siteoverlay-response.error {
            color: #d63638;
            font-weight: bold;
        }
        </style>
        <?php
    }
    
    public function admin_enqueue_scripts($hook) {
        // Only load on post/page edit screens
        if (!in_array($hook, array('post.php', 'post-new.php', 'page.php', 'page-new.php'))) {
            return;
        }
        
        wp_enqueue_script('siteoverlay-admin', SITEOVERLAY_RR_PLUGIN_URL . 'assets/js/admin.js', array('jquery'), SITEOVERLAY_RR_VERSION, true);
        wp_localize_script('siteoverlay-admin', 'siteoverlay_ajax', array(
            'ajax_url' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('siteoverlay_overlay_nonce'),
            'post_id' => get_the_ID()
        ));
        
        wp_enqueue_style('siteoverlay-admin', SITEOVERLAY_RR_PLUGIN_URL . 'assets/css/admin.css', array(), SITEOVERLAY_RR_VERSION);
    }
    
    public function ajax_save_overlay() {
        // Verify nonce for security
        if (!wp_verify_nonce($_POST['nonce'], 'siteoverlay_overlay_nonce')) {
            wp_send_json_error('Security check failed');
            return;
        }
        
        // Check user permissions
        if (!current_user_can('edit_posts')) {
            wp_send_json_error('Insufficient permissions');
            return;
        }
        
        $post_id = intval($_POST['post_id']);
        $overlay_url = esc_url_raw($_POST['overlay_url']);
        
        if (empty($post_id)) {
            wp_send_json_error('Invalid post ID');
            return;
        }
        
        if (empty($overlay_url)) {
            wp_send_json_error('Please enter a valid URL');
            return;
        }
        
        // Save data immediately
        update_post_meta($post_id, '_siteoverlay_overlay_url', $overlay_url);
        update_post_meta($post_id, '_siteoverlay_overlay_updated', current_time('mysql'));
        
        // Return success response immediately
        wp_send_json_success(array(
            'message' => 'Overlay saved successfully!',
            'overlay_url' => $overlay_url
        ));
    }
    
    public function ajax_remove_overlay() {
        // Verify nonce for security
        if (!wp_verify_nonce($_POST['nonce'], 'siteoverlay_overlay_nonce')) {
            wp_send_json_error('Security check failed');
            return;
        }
        
        // Check user permissions
        if (!current_user_can('edit_posts')) {
            wp_send_json_error('Insufficient permissions');
            return;
        }
        
        $post_id = intval($_POST['post_id']);
        
        if (empty($post_id)) {
            wp_send_json_error('Invalid post ID');
            return;
        }
        
        // Remove data immediately
        delete_post_meta($post_id, '_siteoverlay_overlay_url');
        delete_post_meta($post_id, '_siteoverlay_overlay_updated');
        
        // Return success response immediately
        wp_send_json_success(array(
            'message' => 'Overlay removed successfully!'
        ));
    }
    
    public function ajax_preview_overlay() {
        if (!wp_verify_nonce($_POST['nonce'], 'siteoverlay_overlay_nonce')) {
            wp_send_json_error('Security check failed');
            return;
        }
        
        $post_id = intval($_POST['post_id']);
        $overlay_url = get_post_meta($post_id, '_siteoverlay_overlay_url', true);
        
        if ($overlay_url) {
            wp_send_json_success(array('url' => $overlay_url));
        } else {
            wp_send_json_error('No overlay URL found');
        }
    }
    
    public function ajax_trial_license() {
        if (!wp_verify_nonce($_POST['nonce'], 'siteoverlay_overlay_nonce')) {
            wp_send_json_error('Security check failed');
            return;
        }
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Insufficient permissions');
            return;
        }
        
        $full_name = sanitize_text_field($_POST['full_name']);
        $email = sanitize_email($_POST['email']);
        
        if (empty($full_name)) {
            wp_send_json_error('Please enter your full name');
            return;
        }
        
        if (empty($email) || !is_email($email)) {
            wp_send_json_error('Please enter a valid email address');
            return;
        }
        
        // Save registration data
        update_option('siteoverlay_registration_name', $full_name);
        update_option('siteoverlay_registration_email', $email);
        update_option('siteoverlay_registration_date', current_time('mysql'));
        
        // Send trial request to Railway API
        $trial_data = array(
            'full_name' => $full_name,
            'email' => $email,
            'website' => '',
            'siteUrl' => get_site_url(),
            'siteTitle' => get_bloginfo('name'),
            'wpVersion' => get_bloginfo('version'),
            'pluginVersion' => SITEOVERLAY_RR_VERSION,
            'requestSource' => 'plugin_admin'
        );
        
        $api_url = 'https://siteoverlay-api-production.up.railway.app/api/request-trial';
        
        $response = wp_remote_post($api_url, array(
            'timeout' => 10,
            'headers' => array('Content-Type' => 'application/json'),
            'body' => json_encode($trial_data),
            'blocking' => true,
            'sslverify' => true
        ));
        
        if (is_wp_error($response)) {
            wp_send_json_error(array(
                'message' => 'Connection error: ' . $response->get_error_message()
            ));
            return;
        }
        
        $response_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        $data = json_decode($body, true);
        
        if ($response_code === 200 && $data && isset($data['success'])) {
            if ($data['success']) {
                wp_send_json_success(array(
                    'message' => $data['message'] ?? 'Details submitted. Check your inbox for the license key to activate trial'
                ));
            } else {
                wp_send_json_error(array(
                    'message' => $data['message'] ?? 'API returned an error'
                ));
            }
        } else {
            wp_send_json_error(array(
                'message' => 'Failed to process trial request (Code: ' . $response_code . ')'
            ));
        }
    }
    
    public function ajax_validate_license() {
        if (!wp_verify_nonce($_POST['nonce'], 'siteoverlay_overlay_nonce')) {
            wp_send_json_error('Security check failed');
            return;
        }
        
        if (!current_user_can('manage_options')) {
            wp_send_json_error('Insufficient permissions');
            return;
        }
        
        $license_key = sanitize_text_field($_POST['license_key']);
        
        if (empty($license_key)) {
            wp_send_json_error('Please enter a license key');
            return;
        }
        
        // CRITICAL FIX: Call Railway API for real validation
        $validation_result = $this->validate_license_with_railway($license_key);
        
        if ($validation_result['success']) {
            // Save license data
            update_option('siteoverlay_license_key', $license_key);
            update_option('siteoverlay_license_status', $validation_result['status']);
            update_option('siteoverlay_license_expiry', $validation_result['expiry']);
            update_option('siteoverlay_license_validated', true);
            
            wp_send_json_success(array(
                'message' => $validation_result['message'],
                'status' => $validation_result['status'],
                'state' => 'licensed'
            ));
        } else {
            wp_send_json_error($validation_result['message']);
        }
    }
    
    /**
     * CRITICAL FIX: Validate license with Railway API
     */
    private function validate_license_with_railway($license_key) {
        $api_response = wp_remote_post($this->api_base_url . '/validate-license', array(
            'body' => json_encode(array(
                'licenseKey' => $license_key,
                'siteUrl' => get_site_url()
            )),
            'headers' => array('Content-Type' => 'application/json'),
            'timeout' => 10
        ));
        
        if (is_wp_error($api_response)) {
            return array(
                'success' => false,
                'message' => 'Connection error: ' . $api_response->get_error_message()
            );
        }
        
        $body = wp_remote_retrieve_body($api_response);
        $data = json_decode($body, true);
        
        if (isset($data['success']) && $data['success'] === true) {
            // Determine license type and expiry
            $status = 'active';
            $expiry = null;
            $message = 'License activated successfully!';
            
            if (strpos($license_key, 'TRIAL-') === 0) {
                $status = 'trial';
                $expiry = date('Y-m-d H:i:s', strtotime('+14 days'));
                $message = 'Trial license activated successfully! You have 14 days to test SiteOverlay Pro.';
            } elseif (strpos($license_key, 'PRO-') === 0) {
                $status = 'professional';
                $expiry = date('Y-m-d H:i:s', strtotime('+1 year'));
                $message = 'Professional license activated successfully!';
            } elseif (strpos($license_key, 'LIFETIME-') === 0) {
                $status = 'lifetime';
                $expiry = null;
                $message = 'Lifetime license activated successfully!';
            }
            
            return array(
                'success' => true,
                'message' => $message,
                'status' => $status,
                'expiry' => $expiry
            );
        } else {
            return array(
                'success' => false,
                'message' => $data['message'] ?? 'Invalid license key'
            );
        }
    }
    
    public function get_license_status() {
        $license_key = get_option('siteoverlay_license_key');
        $license_status = get_option('siteoverlay_license_status');
        $license_expiry = get_option('siteoverlay_license_expiry');
        $license_validated = get_option('siteoverlay_license_validated', false);
        
        // 1. License State Detection - Required States
        if (!$license_key) {
            return array(
                'state' => 'unlicensed',
                'status' => 'inactive',
                'message' => 'No license key found',
                'expiry' => null,
                'features_enabled' => false,
                'days_remaining' => 0
            );
        }
        
        // Check if license exists but not validated
        if ($license_key && !$license_validated) {
            return array(
                'state' => 'pending',
                'status' => 'pending',
                'message' => 'License key exists but not validated',
                'expiry' => null,
                'features_enabled' => false,
                'days_remaining' => 0
            );
        }
        
        // Check trial license states
        if ($license_status === 'trial') {
            $expiry_time = strtotime($license_expiry);
            $days_remaining = 0;
            
            if ($expiry_time) {
                $days_remaining = max(0, ceil(($expiry_time - time()) / (24 * 60 * 60)));
            }
            
            if ($expiry_time && $expiry_time < time()) {
                return array(
                    'state' => 'trial_expired',
                    'status' => 'trial_expired',
                    'message' => 'Trial license has expired',
                    'expiry' => $license_expiry,
                    'features_enabled' => false,
                    'days_remaining' => 0
                );
            }
            
            return array(
                'state' => 'trial_active',
                'status' => 'trial_active',
                'message' => 'Trial license active',
                'expiry' => $license_expiry,
                'features_enabled' => true,
                'days_remaining' => $days_remaining
            );
        }
        
        // Check paid license states
        if ($license_status && $license_validated && $license_status !== 'trial') {
            return array(
                'state' => 'licensed',
                'status' => $license_status,
                'message' => 'License active',
                'expiry' => $license_expiry,
                'features_enabled' => true,
                'days_remaining' => null
            );
        }
        
        // Fallback to unlicensed
        return array(
            'state' => 'unlicensed',
            'status' => 'inactive',
            'message' => 'License not properly validated',
            'expiry' => null,
            'features_enabled' => false,
            'days_remaining' => 0
        );
    }
    
    /**
     * CRITICAL FIX: Proper license enforcement
     */
    public function is_licensed() {
        $license_status = $this->get_license_status();
        
        // ONLY return true if features are explicitly enabled
        return $license_status['features_enabled'] === true;
    }
    
    public function is_trial_active() {
        $license_status = $this->get_license_status();
        return $license_status['state'] === 'trial_active';
    }
    
    public function should_disable_trial_button() {
        $license_status = $this->get_license_status();
        return in_array($license_status['state'], ['trial_active', 'trial_expired', 'licensed']);
    }
    
    public function display_admin_notices() {
        // Only show on admin pages, not on the plugin settings page
        if (isset($_GET['page']) && $_GET['page'] === 'siteoverlay-settings') {
            return;
        }
        
        $license_status = $this->get_license_status();
        
        switch ($license_status['state']) {
            case 'unlicensed':
                ?>
                <div class="notice notice-warning is-dismissible">
                    <p><strong>SiteOverlay Pro:</strong> Plugin is inactive. Activate your license to use SiteOverlay Pro. <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>">Activate Now</a></p>
                </div>
                <?php
                break;
                
            case 'trial_active':
                if ($license_status['days_remaining'] <= 7) {
                    ?>
                    <div class="notice notice-warning is-dismissible">
                        <p><strong>SiteOverlay Pro:</strong> Trial expires in <?php echo $license_status['days_remaining']; ?> days! <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>">Upgrade Now</a></p>
                    </div>
                    <?php
                } else {
                    ?>
                    <div class="notice notice-info is-dismissible">
                        <p><strong>SiteOverlay Pro:</strong> Trial active - <?php echo $license_status['days_remaining']; ?> days remaining. <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>">View Details</a></p>
                    </div>
                    <?php
                }
                break;
                
            case 'trial_expired':
                ?>
                <div class="notice notice-error is-dismissible">
                    <p><strong>SiteOverlay Pro:</strong> Trial expired - plugin is inactive. Enter a paid license to continue. <a href="<?php echo admin_url('options-general.php?page=siteoverlay-settings'); ?>">Upgrade Now</a></p>
                </div>
                <?php
                break;
        }
    }
    
    public function test_file_permissions() {
        $test_file = plugin_dir_path(__FILE__) . 'test.txt';
        
        // Try to write
        if (file_put_contents($test_file, 'test') === false) {
            error_log('SiteOverlay: Cannot write files');
            return false;
        }
        
        // Try to delete
        if (!unlink($test_file)) {
            error_log('SiteOverlay: Cannot delete files');
            return false;
        }
        
        return true;
    }
    
    /**
     * CRITICAL: Fast overlay display - ONLY when licensed
     */
    public function display_overlay() {
        // Only run on frontend single posts/pages, not during activation
        if (is_admin() || !is_singular()) return;
        
        global $post;
        if (!$post) return;
        
        $overlay_url = get_post_meta($post->ID, '_siteoverlay_overlay_url', true);
        if (!$overlay_url) return;
        
        // Increment view count (non-blocking)
        $views = get_post_meta($post->ID, '_siteoverlay_overlay_views', true) ?: 0;
        update_post_meta($post->ID, '_siteoverlay_overlay_views', $views + 1);
        
        // IMMEDIATE OVERLAY DISPLAY - no delays - with scrollbar fix
        ?>
        <style>
        body, html {
            overflow: hidden !important;
        }
        #siteoverlay-overlay-frame {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
            z-index: 999999;
            background: white;
        }
        </style>
        <script>
        (function() {
            var iframe = document.createElement('iframe');
            iframe.id = 'siteoverlay-overlay-frame';
            iframe.src = '<?php echo esc_js($overlay_url); ?>';
            iframe.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;border:none;z-index:999999;background:white;';
            document.documentElement.appendChild(iframe);
        })();
        </script>
        <?php
    }
}

// Initialize the plugin
new SiteOverlay_Pro();

// Register activation hook
register_activation_hook(__FILE__, 'siteoverlay_pro_activate');

// Register deactivation hook
register_deactivation_hook(__FILE__, 'siteoverlay_pro_deactivate');

// Register uninstall hook
register_uninstall_hook(__FILE__, 'siteoverlay_pro_uninstall');

// Activation function
function siteoverlay_pro_activate() {
    // Set default options if they don't exist
    if (!get_option('siteoverlay_license_status')) {
        update_option('siteoverlay_license_status', 'inactive');
    }
    
    // Clear any existing scheduled events
    wp_clear_scheduled_hook('siteoverlay_daily_heartbeat');
    
    // Flush rewrite rules
    flush_rewrite_rules();
}

// Deactivation function
function siteoverlay_pro_deactivate() {
    // Clear scheduled events
    wp_clear_scheduled_hook('siteoverlay_daily_heartbeat');
    
    // Clear transients
    delete_transient('siteoverlay_site_registered');
    delete_transient('siteoverlay_usage_stats');
    delete_transient('siteoverlay_license_last_check');
    
    // Flush rewrite rules
    flush_rewrite_rules();
}

// Uninstall function
function siteoverlay_pro_uninstall() {
    // Clear all scheduled cron jobs
    wp_clear_scheduled_hook('siteoverlay_daily_heartbeat');
    
    // Clear all transients
    delete_transient('siteoverlay_site_registered');
    delete_transient('siteoverlay_usage_stats');
    delete_transient('siteoverlay_license_last_check');
    
    // Remove all post meta related to overlays
    global $wpdb;
    $wpdb->delete($wpdb->postmeta, array('meta_key' => '_siteoverlay_overlay_url'));
    $wpdb->delete($wpdb->postmeta, array('meta_key' => '_siteoverlay_overlay_views'));
    $wpdb->delete($wpdb->postmeta, array('meta_key' => '_siteoverlay_overlay_updated'));
}

// Newsletter signup AJAX handler
add_action('wp_ajax_siteoverlay_newsletter_signup', function() {
    check_ajax_referer('siteoverlay_overlay_nonce', 'nonce');
    
    $email = sanitize_email($_POST['email'] ?? '');
    
    if (empty($email) || !is_email($email)) {
        wp_send_json_error('Please enter a valid email address');
        return;
    }
    
    // Simple success response
    wp_send_json_success('Thank you for subscribing to our SEO tips!');
});

// Save post hook for overlay data
add_action('save_post', function($post_id) {
    // Verify nonce
    if (!isset($_POST['siteoverlay_overlay_nonce']) || !wp_verify_nonce($_POST['siteoverlay_overlay_nonce'], 'siteoverlay_overlay_nonce')) {
        return;
    }
    
    // Check user permissions
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }
    
    // Save overlay URL if provided
    if (isset($_POST['siteoverlay_overlay_url'])) {
        $overlay_url = esc_url_raw($_POST['siteoverlay_overlay_url']);
        if (!empty($overlay_url)) {
            update_post_meta($post_id, '_siteoverlay_overlay_url', $overlay_url);
            update_post_meta($post_id, '_siteoverlay_overlay_updated', current_time('mysql'));
        } else {
            delete_post_meta($post_id, '_siteoverlay_overlay_url');
            delete_post_meta($post_id, '_siteoverlay_overlay_updated');
        }
    }
}); 
?>