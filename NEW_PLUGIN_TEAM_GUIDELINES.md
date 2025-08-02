# 🚨 **NEW PLUGIN TEAM - CONSTITUTIONAL RULES & GUIDELINES**

## ⚡ **CRITICAL: CONSTITUTIONAL RULES - NEVER VIOLATE**

### **🚫 ABSOLUTELY FORBIDDEN:**

1. **NEVER modify `display_overlay()` method** (lines 1319-1360 in siteoverlay-pro.php)
2. **NEVER add API calls to frontend code** (wp_head, display_overlay, etc.)
3. **NEVER add blocking operations** (sleep, synchronous HTTP, long database queries)
4. **NEVER modify overlay CSS/JavaScript** without performance testing
5. **NEVER add license restrictions** to overlay display (always available)

### **🛡️ PROTECTED CODE AREAS - READ ONLY:**

```php
// THESE METHODS ARE OFF-LIMITS:
public function display_overlay()           // Performance critical
public function __construct()               // Core initialization  
add_action('wp_head', ...)                 // Frontend performance
```

---

## 🎯 **YOUR CURRENT TASK: FIX API ENDPOINT MISMATCH**

### **PROBLEM IDENTIFIED:**
- **Plugin calls:** `/dynamic-content` (POST method)
- **Railway API expects:** `/v1/dynamic-content` (GET method)

### **REQUIRED FIX:**

**File:** `includes/class-dynamic-content-manager.php`

**Line 68 - CHANGE THIS:**
```php
$response = wp_remote_post($this->api_base_url . '/dynamic-content', array(
    'timeout' => $this->api_timeout,
    'headers' => array('Content-Type' => 'application/json'),
    'body' => json_encode($request_data),
    'blocking' => true,
    'sslverify' => true
));
```

**TO THIS:**
```php
$response = wp_remote_get($this->api_base_url . '/v1/dynamic-content', array(
    'timeout' => $this->api_timeout,
    'headers' => array(
        'X-Software-Type' => 'wordpress_plugin',
        'User-Agent' => 'SiteOverlay-Pro-Plugin/2.0.1'
    ),
    'sslverify' => true
));
```

**Lines 90-92 - CHANGE RESPONSE PARSING:**
```php
// OLD:
if (isset($data['success']) && $data['success'] && isset($data['content'])) {
    return $data['content'];
}

// NEW:
if (isset($data['success']) && $data['success'] && isset($data['content'])) {
    // Convert Railway API format to plugin format
    $formatted_content = array();
    foreach ($data['content'] as $item) {
        if (isset($item['content_key']) && isset($item['content_value'])) {
            $formatted_content[$item['content_key']] = $item['content_value'];
        }
    }
    return $formatted_content;
}
```

---

## 🧪 **MANDATORY TESTING PROTOCOL**

### **AFTER EVERY CHANGE:**

**1. Performance Test:**
```bash
# Measure overlay display time - MUST be < 100ms
# Open browser dev tools, reload page with overlay
# Check Network tab - NO API calls during page load
```

**2. Functionality Test:**
```bash
# Test overlay displays instantly
# Test admin shows dynamic content from API
# Test fallback works when API unavailable
```

**3. API Integration Test:**
```bash
# Use test file: yoursite.com/test-api-integration.php
# Must show: ✅ Success for all tests
```

---

## 📊 **SUCCESS CRITERIA**

### **✅ WHEN YOUR FIX IS COMPLETE:**

1. **Overlay displays instantly** (< 100ms)
2. **Admin shows 14 content items** from Railway API
3. **Dynamic content replaces fallbacks**
4. **No performance regression**
5. **All constitutional rules maintained**

---

## 🚨 **EMERGENCY PROCEDURES**

### **IF OVERLAY BECOMES SLOW:**

**IMMEDIATE ROLLBACK:**
```bash
git reset --hard HEAD~1  # Undo last commit
git push origin main --force
```

**IDENTIFY PROBLEM:**
```php
// Add timing debug:
$start = microtime(true);
// ... your code ...
$end = microtime(true);
error_log('Time taken: ' . ($end - $start) . ' seconds');
```

**IF > 0.1 SECONDS = STOP ALL WORK**

---

## 🎯 **SAFE MODIFICATION ZONES**

### **✅ YOU CAN SAFELY MODIFY:**

- **API endpoint URLs** (string changes only)
- **Response parsing logic** (data transformation)
- **Cache management** (get_transient, set_transient)
- **Admin interface** (settings pages, forms)
- **Background operations** (wp_schedule_event)

### **❌ NEVER MODIFY:**

- **Overlay display method** 
- **Frontend performance code**
- **Core initialization**
- **Constitutional compliance areas**

---

## 📋 **IMPLEMENTATION CHECKLIST**

### **STEP 1: Make API Endpoint Fix**
- [ ] Change `/dynamic-content` to `/v1/dynamic-content`
- [ ] Change POST to GET
- [ ] Update headers
- [ ] Fix response parsing

### **STEP 2: Test Everything**
- [ ] Overlay speed < 100ms
- [ ] API integration working
- [ ] Dynamic content displaying
- [ ] No PHP errors

### **STEP 3: Document Changes**
- [ ] Commit with clear message
- [ ] Note any performance impacts
- [ ] Report success metrics

---

## 🎖️ **YOUR MISSION**

**Fix the API endpoint mismatch to make dynamic content work while maintaining perfect overlay performance.**

**The working foundation is already there - you just need to connect it properly to the Railway API!**

**MAINTAIN CONSTITUTIONAL COMPLIANCE AT ALL COSTS! ⚡**