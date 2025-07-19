 # SiteOverlay Pro - Outstanding Development Plan
 
 ## Constitutional Rules (From Rules Document)
 **CRITICAL:** All development must follow these rules to protect core functionality:
 
 1. **Non-Blocking License System** - License checks must never block core plugin functionality
 2. **Modular Architecture** - All enhancements must be separate modules
 3. **Background Operations** - Site tracking and validation runs in background only
 4. **Graceful Degradation** - Plugin works even if licensing server is down
 5. **User Experience Priority** - Never interrupt user workflow for license issues
 
 ## Current Status ✅
 - ✅ Basic License Validation (Railway API)
 - ✅ Trial System (14-day trials with email collection)
 - ✅ Stripe Integration (Professional + Lifetime plans)
 - ✅ WordPress Plugin (Complete with license manager)
 - ✅ Pabbly → AWeber Email Integration
 
 ## Outstanding Development Work ❌
 
 ### Phase 1: Database & API Foundation (Priority 1)
 
 #### 1.1 Database Schema Updates
 ```sql
 -- Add site_usage table
 CREATE TABLE site_usage (
     id SERIAL PRIMARY KEY,
     license_key VARCHAR(255) NOT NULL,
     site_signature VARCHAR(255) NOT NULL,
     site_domain VARCHAR(255) NOT NULL,
     site_url TEXT NOT NULL,
     site_data JSONB,
     status VARCHAR(50) DEFAULT 'active',
     registered_at TIMESTAMP DEFAULT NOW(),
     last_seen TIMESTAMP DEFAULT NOW(),
     deactivated_at TIMESTAMP NULL,
     created_at TIMESTAMP DEFAULT NOW(),
     UNIQUE(license_key, site_signature)
 );
 
 -- Add site limit column to licenses table
 ALTER TABLE licenses ADD COLUMN IF NOT EXISTS site_limit INTEGER DEFAULT 5;
 ```
 
 #### 1.2 New API Endpoints Needed
 - `POST /api/register-site-usage` - Register new site usage
 - `POST /api/unregister-site-usage` - Remove site usage
 - `GET /api/license-usage/:license_key` - Get current usage stats
 - `POST /api/admin/remove-site` - Admin remove site
 - `POST /api/admin/reset-site-usage` - Admin reset usage
 - `POST /api/admin/update-license` - Admin update license
 
 ### Phase 2: WordPress Plugin Enhancement (Priority 2)
 
 #### 2.1 New File: `includes/class-site-tracker.php`
 **Purpose:** Background site registration and heartbeat system
 - Non-blocking site registration on activation
 - Daily heartbeat to verify site registration
 - Site signature generation
 - Background limit checking (non-blocking)
 
 #### 2.2 Enhance: `includes/class-license-manager.php`
 **Additions:**
 - Site usage display in admin
 - Non-blocking limit checking
 - Site registration status
 - Usage statistics display
 
 ### Phase 3: Stripe Integration (Priority 3)
 
 #### 3.1 Add Third Product to Stripe
 - **Annual Unlimited Plan:** $197/year
 - Update webhook handling for new product
 - Add price ID to Railway API configuration
 
 #### 3.2 Update Sales Page
 - Add $197/year option
 - Update pricing display
 - Add annual vs monthly comparison
 
 ### Phase 4: Admin Dashboard (Priority 4)
 
 #### 4.1 Deploy Admin Dashboard
 - Complete site usage management
 - License administration
 - Bulk operations
 - Usage analytics
 
 ## Implementation Order
 
 ### Week 1: Database & Core API
 1. Add `site_usage` table to PostgreSQL
 2. Add `site_limit` column to licenses table
 3. Create site registration API endpoints
 4. Test site usage tracking
 
 ### Week 2: WordPress Plugin Enhancement
 1. Create `class-site-tracker.php`
 2. Enhance `class-license-manager.php`
 3. Add background site registration
 4. Add usage display in admin
 
 ### Week 3: Stripe Integration
 1. Add $197/year product to Stripe
 2. Update webhook handling
 3. Test payment processing
 4. Update sales page
 
 ### Week 4: Admin Dashboard
 1. Create admin interface
 2. Add site management features
 3. Add usage analytics
 4. Testing and deployment
 
 ## Key Considerations
 
 ### Site Usage Enforcement Rules
 - **Professional Plan:** 5 sites maximum
 - **Annual/Lifetime:** Unlimited sites
 - **Enforcement:** Non-blocking warnings, graceful degradation
 - **Tracking:** Background registration, daily heartbeat
 
 ### Site Signature Generation
 - Unique identifier per WordPress installation
 - Based on: Site URL + WordPress salt + installation date
 - Prevents easy circumvention
 - Stable across plugin updates
 
 ### Background Operations
 - All site tracking runs in background
 - Never blocks user interface
 - Graceful handling of API failures
 - Local caching for offline operation
 
 ## Files to Create/Modify
 
 ### New Files:
 - `includes/class-site-tracker.php`
 - `includes/class-admin-dashboard.php`
 - `assets/js/site-tracker.js`
 - `assets/css/admin-dashboard.css`
 
 ### Files to Modify:
 - `railway-api/routes.js` (add new endpoints)
 - `includes/class-license-manager.php` (enhance with usage)
 - `siteoverlay-pro.php` (add new classes)
 - `assets/js/admin.js` (add usage display)
 
 ## Testing Strategy
 
 ### Unit Tests:
 - Site signature generation
 - API endpoint responses
 - Background operations
 - License limit enforcement
 
 ### Integration Tests:
 - WordPress plugin activation
 - Site registration flow
 - Stripe webhook processing
 - Admin dashboard functionality
 
 ### User Acceptance Tests:
 - Trial user experience
 - Professional plan limits
 - Annual plan activation
 - Admin management workflow
 
 This development plan ensures all enhancements follow the constitutional rules while adding the missing critical functionality.