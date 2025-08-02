<?php
/**
 * SiteOverlay Pro API Integration Test
 * Place this file in your WordPress root directory
 * Access via: yoursite.com/test-api-integration.php
 */

// Basic WordPress environment (minimal)
define('WP_USE_THEMES', false);
require_once('./wp-config.php');
require_once('./wp-load.php');

?>
<!DOCTYPE html>
<html>
<head>
    <title>SiteOverlay Pro API Test</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .test-section { background: #f5f5f5; padding: 15px; margin: 15px 0; border-radius: 5px; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .info { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; }
        pre { background: white; padding: 10px; border-radius: 3px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>🚀 SiteOverlay Pro API Integration Test</h1>
    
    <?php
    echo '<div class="test-section info">';
    echo '<h3>📍 Test Environment</h3>';
    echo '<p><strong>WordPress Version:</strong> ' . get_bloginfo('version') . '</p>';
    echo '<p><strong>PHP Version:</strong> ' . PHP_VERSION . '</p>';
    echo '<p><strong>Test Time:</strong> ' . date('Y-m-d H:i:s') . '</p>';
    echo '</div>';

    // Test 1: Direct API Call
    echo '<div class="test-section">';
    echo '<h3>🔗 Test 1: Direct API Call</h3>';
    
    $api_url = 'https://siteoverlay-api-production.up.railway.app/api/v1/dynamic-content';
    $headers = array(
        'X-Software-Type' => 'wordpress_plugin',
        'User-Agent' => 'SiteOverlay-Pro-Plugin/1.0'
    );
    
    $response = wp_remote_get($api_url, array(
        'headers' => $headers,
        'timeout' => 15,
        'sslverify' => true
    ));
    
    if (is_wp_error($response)) {
        echo '<div class="error">';
        echo '<p><strong>❌ API Call Failed:</strong></p>';
        echo '<pre>' . esc_html($response->get_error_message()) . '</pre>';
        echo '</div>';
    } else {
        $status_code = wp_remote_retrieve_response_code($response);
        $body = wp_remote_retrieve_body($response);
        
        if ($status_code === 200) {
            echo '<div class="success">';
            echo '<p><strong>✅ API Call Successful</strong></p>';
            echo '<p><strong>Status Code:</strong> ' . $status_code . '</p>';
            
            $data = json_decode($body, true);
            if ($data && isset($data['content'])) {
                echo '<p><strong>Content Items Found:</strong> ' . count($data['content']) . '</p>';
                echo '<pre>' . esc_html(json_encode($data, JSON_PRETTY_PRINT)) . '</pre>';
            } else {
                echo '<p><strong>⚠️ Invalid JSON Response</strong></p>';
                echo '<pre>' . esc_html($body) . '</pre>';
            }
            echo '</div>';
        } else {
            echo '<div class="error">';
            echo '<p><strong>❌ API Error:</strong> Status Code ' . $status_code . '</p>';
            echo '<pre>' . esc_html($body) . '</pre>';
            echo '</div>';
        }
    }
    echo '</div>';

    // Test 2: Plugin Class Test (if available)
    echo '<div class="test-section">';
    echo '<h3>🔌 Test 2: Plugin Integration</h3>';
    
    // Check if SiteOverlay Pro is active
    if (class_exists('SiteOverlay_Pro')) {
        echo '<div class="success">';
        echo '<p><strong>✅ SiteOverlay Pro Plugin Active</strong></p>';
        echo '</div>';
        
        // Test dynamic content manager
        if (class_exists('Dynamic_Content_Manager')) {
            echo '<div class="info">';
            echo '<p><strong>🔧 Testing Dynamic Content Manager...</strong></p>';
            
            try {
                $content_manager = new Dynamic_Content_Manager();
                
                // Check cache
                $cached_content = get_transient('siteoverlay_content_cache');
                if ($cached_content) {
                    echo '<p><strong>📦 Cached Content Found:</strong></p>';
                    echo '<pre>' . esc_html(print_r($cached_content, true)) . '</pre>';
                } else {
                    echo '<p><strong>⚠️ No Cached Content Found</strong></p>';
                }
                
            } catch (Exception $e) {
                echo '<div class="error">';
                echo '<p><strong>❌ Plugin Error:</strong> ' . esc_html($e->getMessage()) . '</p>';
                echo '</div>';
            }
            echo '</div>';
        } else {
            echo '<div class="error">';
            echo '<p><strong>❌ Dynamic_Content_Manager Class Not Found</strong></p>';
            echo '</div>';
        }
        
    } else {
        echo '<div class="error">';
        echo '<p><strong>❌ SiteOverlay Pro Plugin Not Active</strong></p>';
        echo '</div>';
    }
    echo '</div>';

    // Test 3: WordPress Functions
    echo '<div class="test-section">';
    echo '<h3>🔧 Test 3: WordPress Environment</h3>';
    
    echo '<div class="info">';
    echo '<p><strong>WordPress Functions Available:</strong></p>';
    echo '<ul>';
    echo '<li>wp_remote_get: ' . (function_exists('wp_remote_get') ? '✅' : '❌') . '</li>';
    echo '<li>get_transient: ' . (function_exists('get_transient') ? '✅' : '❌') . '</li>';
    echo '<li>set_transient: ' . (function_exists('set_transient') ? '✅' : '❌') . '</li>';
    echo '<li>wp_schedule_event: ' . (function_exists('wp_schedule_event') ? '✅' : '❌') . '</li>';
    echo '</ul>';
    echo '</div>';
    echo '</div>';

    // Test 4: Force Cache Clear
    if (isset($_GET['clear_cache'])) {
        echo '<div class="test-section">';
        echo '<h3>🧹 Cache Cleared</h3>';
        delete_transient('siteoverlay_content_cache');
        echo '<div class="success"><p>✅ SiteOverlay content cache cleared successfully!</p></div>';
        echo '</div>';
    }
    ?>

    <div class="test-section info">
        <h3>🛠️ Quick Actions</h3>
        <p><a href="?clear_cache=1" style="background: #007cba; color: white; padding: 10px 15px; text-decoration: none; border-radius: 3px;">Clear Content Cache</a></p>
        <p><a href="?" style="background: #50575e; color: white; padding: 10px 15px; text-decoration: none; border-radius: 3px;">Refresh Test</a></p>
    </div>

    <div class="test-section info">
        <h3>📝 Instructions for Plugin Team</h3>
        <ul>
            <li><strong>API Working:</strong> If Test 1 shows ✅, the Railway API is perfect</li>
            <li><strong>Plugin Issue:</strong> If Test 2 shows ❌, focus on plugin integration</li>
            <li><strong>No Cache:</strong> If no cached content, plugin isn't fetching from API</li>
            <li><strong>Clear Cache:</strong> Use button above to force fresh API fetch</li>
        </ul>
    </div>

</body>
</html>