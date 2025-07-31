// Admin Module Utility Functions

/**
 * Format currency for display
 * @param {number} amount - Amount to format
 * @param {string} currency - Currency code (default: USD)
 * @returns {string} Formatted currency string
 */
function formatCurrency(amount, currency = 'USD') {
    if (amount === null || amount === undefined) return '$0.00';
    
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount);
}

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @param {boolean} includeTime - Whether to include time (default: true)
 * @returns {string} Formatted date string
 */
function formatDate(date, includeTime = true) {
    if (!date) return 'N/A';
    
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return 'Invalid Date';
    
    const options = {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    };
    
    if (includeTime) {
        options.hour = '2-digit';
        options.minute = '2-digit';
    }
    
    return dateObj.toLocaleDateString('en-US', options);
}

/**
 * Get license type display name
 * @param {string} licenseType - License type from database
 * @returns {string} Human-readable license type
 */
function getLicenseTypeDisplay(licenseType) {
    const typeMap = {
        'trial': 'Trial',
        '5_site_license': 'Professional (5 Sites)',
        'annual_unlimited': 'Annual Unlimited',
        'lifetime_unlimited': 'Lifetime Unlimited'
    };
    
    return typeMap[licenseType] || licenseType;
}

/**
 * Get status badge class
 * @param {string} status - Status value
 * @returns {string} CSS class for status badge
 */
function getStatusBadgeClass(status) {
    const statusMap = {
        'active': 'status-active',
        'inactive': 'status-inactive',
        'suspended': 'status-warning',
        'expired': 'status-danger',
        'trial': 'status-trial'
    };
    
    return statusMap[status] || 'status-inactive';
}

/**
 * Validate admin key format
 * @param {string} adminKey - Admin key to validate
 * @returns {boolean} Whether key is valid format
 */
function validateAdminKey(adminKey) {
    if (!adminKey || typeof adminKey !== 'string') return false;
    
    // Basic validation - should be at least 8 characters
    return adminKey.length >= 8;
}

/**
 * Sanitize search query
 * @param {string} query - Search query to sanitize
 * @returns {string} Sanitized query
 */
function sanitizeSearchQuery(query) {
    if (!query || typeof query !== 'string') return '';
    
    // Remove potentially dangerous characters
    return query.replace(/[<>'"]/g, '').trim();
}

/**
 * Generate pagination info
 * @param {number} total - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {object} Pagination information
 */
function generatePagination(total, page = 1, limit = 50) {
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    
    return {
        currentPage: page,
        totalPages: totalPages,
        totalItems: total,
        itemsPerPage: limit,
        offset: offset,
        hasNext: page < totalPages,
        hasPrev: page > 1
    };
}

/**
 * Create error response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 * @returns {object} Error response object
 */
function createErrorResponse(message, statusCode = 500) {
    return {
        success: false,
        error: message,
        statusCode: statusCode,
        timestamp: new Date().toISOString()
    };
}

/**
 * Create success response object
 * @param {any} data - Response data
 * @param {string} message - Success message (optional)
 * @returns {object} Success response object
 */
function createSuccessResponse(data, message = null) {
    const response = {
        success: true,
        data: data,
        timestamp: new Date().toISOString()
    };
    
    if (message) {
        response.message = message;
    }
    
    return response;
}

/**
 * Log admin action for audit trail
 * @param {string} action - Action performed
 * @param {string} adminKey - Admin key used
 * @param {object} details - Action details
 */
function logAdminAction(action, adminKey, details = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        action: action,
        adminKey: adminKey ? adminKey.substring(0, 8) + '...' : 'unknown',
        details: details,
        ip: details.ip || 'unknown'
    };
    
    console.log('ADMIN ACTION:', JSON.stringify(logEntry, null, 2));
    
    // In production, you might want to save this to a database
    // or send to a logging service
}

/**
 * Check if user has admin permissions
 * @param {string} adminKey - Admin key to check
 * @param {string} requiredPermission - Required permission level
 * @returns {boolean} Whether user has permission
 */
function hasAdminPermission(adminKey, requiredPermission = 'basic') {
    // This is a simple implementation
    // In production, you might want to check against a database
    // or use a more sophisticated permission system
    
    if (!validateAdminKey(adminKey)) return false;
    
    // For now, all valid admin keys have full permissions
    return true;
}

/**
 * Generate a secure admin key
 * @param {number} length - Key length (default: 32)
 * @returns {string} Generated admin key
 */
function generateAdminKey(length = 32) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    return result;
}

/**
 * Parse and validate date range
 * @param {string} startDate - Start date string
 * @param {string} endDate - End date string
 * @returns {object|null} Parsed date range or null if invalid
 */
function parseDateRange(startDate, endDate) {
    try {
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;
        
        if (start && isNaN(start.getTime())) return null;
        if (end && isNaN(end.getTime())) return null;
        
        if (start && end && start > end) return null;
        
        return { start, end };
    } catch (error) {
        return null;
    }
}

/**
 * Calculate time difference in human readable format
 * @param {string|Date} startDate - Start date
 * @param {string|Date} endDate - End date (defaults to now)
 * @returns {string} Human readable time difference
 */
function getTimeDifference(startDate, endDate = new Date()) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return 'Invalid date';
    }
    
    const diffMs = end - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (diffDays > 0) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else if (diffHours > 0) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffMinutes > 0) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else {
        return 'Just now';
    }
}

module.exports = {
    formatCurrency,
    formatDate,
    getLicenseTypeDisplay,
    getStatusBadgeClass,
    validateAdminKey,
    sanitizeSearchQuery,
    generatePagination,
    createErrorResponse,
    createSuccessResponse,
    logAdminAction,
    hasAdminPermission,
    generateAdminKey,
    parseDateRange,
    getTimeDifference
}; 