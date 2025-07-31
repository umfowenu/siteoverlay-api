// Admin Dashboard JavaScript
class AdminDashboard {
    constructor() {
        this.adminKey = this.getAdminKey();
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadDashboard();
        this.checkSystemHealth();
    }

    getAdminKey() {
        // Get admin key from URL parameter or prompt
        const urlParams = new URLSearchParams(window.location.search);
        let adminKey = urlParams.get('admin_key');
        
        if (!adminKey) {
            adminKey = prompt('Enter Admin Key:');
            if (adminKey) {
                // Add to URL for future use
                const newUrl = new URL(window.location);
                newUrl.searchParams.set('admin_key', adminKey);
                window.history.replaceState({}, '', newUrl);
            }
        }
        
        return adminKey;
    }

    bindEvents() {
        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadDashboard();
        });

        // Search functionality
        document.getElementById('searchBtn').addEventListener('click', () => {
            this.searchLicenses();
        });

        // Customer search
        document.getElementById('customerSearchBtn').addEventListener('click', () => {
            this.getCustomerData();
        });

        // Modal events
        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('modalCancel').addEventListener('click', () => {
            this.closeModal();
        });

        // Enter key events
        document.getElementById('searchQuery').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchLicenses();
        });

        document.getElementById('customerEmail').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.getCustomerData();
        });
    }

    async loadDashboard() {
        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/dashboard?admin_key=' + this.adminKey);
            const data = await response.json();
            
            if (data.success) {
                this.updateStats(data.stats);
                this.updateRecentLicenses(data.recent_licenses);
            } else {
                this.showError('Failed to load dashboard data');
            }
        } catch (error) {
            console.error('Dashboard load error:', error);
            this.showError('Failed to load dashboard data');
        } finally {
            this.hideLoading();
        }
    }

    updateStats(stats) {
        document.getElementById('totalLicenses').textContent = stats.total_licenses || 0;
        document.getElementById('activeLicenses').textContent = stats.active_licenses || 0;
        document.getElementById('totalRevenue').textContent = this.formatCurrency(stats.total_revenue || 0);
        document.getElementById('totalSites').textContent = stats.total_sites || 0;
    }

    updateRecentLicenses(licenses) {
        const container = document.getElementById('recentLicenses');
        container.innerHTML = '';

        if (licenses.length === 0) {
            container.innerHTML = '<p class="text-center">No recent licenses found</p>';
            return;
        }

        licenses.forEach(license => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <div class="activity-info">
                    <h4>${license.license_key}</h4>
                    <p>${license.customer_email} - ${license.license_type}</p>
                </div>
                <div class="activity-time">
                    ${this.formatDate(license.created_at)}
                </div>
            `;
            container.appendChild(item);
        });
    }

    async searchLicenses() {
        const query = document.getElementById('searchQuery').value.trim();
        const type = document.getElementById('searchType').value;
        
        if (!query) {
            this.showError('Please enter a search query');
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ query, type })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.displaySearchResults(data.licenses);
            } else {
                this.showError(data.error || 'Search failed');
            }
        } catch (error) {
            console.error('Search error:', error);
            this.showError('Search failed');
        } finally {
            this.hideLoading();
        }
    }

    displaySearchResults(licenses) {
        const container = document.getElementById('searchResults');
        const tableBody = document.getElementById('resultsTableBody');
        
        if (licenses.length === 0) {
            container.style.display = 'block';
            tableBody.innerHTML = '<tr><td colspan="6" class="text-center">No licenses found</td></tr>';
            return;
        }

        tableBody.innerHTML = '';
        
        licenses.forEach(license => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><code>${license.license_key}</code></td>
                <td><span class="status-badge status-${license.license_type}">${license.license_type}</span></td>
                <td>${license.customer_email}<br><small>${license.customer_name || 'N/A'}</small></td>
                <td><span class="status-badge status-${license.status}">${license.status}</span></td>
                <td><span class="status-badge ${license.kill_switch_enabled ? 'status-active' : 'status-inactive'}">${license.kill_switch_enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                    <div class="action-buttons">
                        ${license.kill_switch_enabled ? 
                            `<button class="btn btn-danger btn-sm" onclick="adminDashboard.toggleKillSwitch('${license.license_key}', 'disable')">Disable</button>` :
                            `<button class="btn btn-success btn-sm" onclick="adminDashboard.toggleKillSwitch('${license.license_key}', 'enable')">Enable</button>`
                        }
                        <button class="btn btn-warning btn-sm" onclick="adminDashboard.showUpdateInstallsModal('${license.license_key}')">Update Installs</button>
                        ${license.license_type === 'trial' ? 
                            `<button class="btn btn-primary btn-sm" onclick="adminDashboard.showExtendTrialModal('${license.license_key}')">Extend Trial</button>` : ''
                        }
                        <button class="btn btn-success btn-sm" onclick="adminDashboard.convertToLifetime('${license.license_key}')">Convert to Lifetime</button>
                    </div>
                </td>
            `;
            tableBody.appendChild(row);
        });
        
        container.style.display = 'block';
    }

    async toggleKillSwitch(licenseKey, action) {
        if (!confirm(`Are you sure you want to ${action} the kill switch for license ${licenseKey}?`)) {
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/kill-switch', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ license_key: licenseKey, action })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                this.searchLicenses(); // Refresh results
            } else {
                this.showError(data.error || 'Operation failed');
            }
        } catch (error) {
            console.error('Kill switch error:', error);
            this.showError('Operation failed');
        } finally {
            this.hideLoading();
        }
    }

    showUpdateInstallsModal(licenseKey) {
        this.showModal('Update Install Limit', `
            <div class="form-group">
                <label for="newLimit">New Install Limit:</label>
                <input type="number" id="newLimit" placeholder="Enter number of installs (-1 for unlimited)" min="-1">
            </div>
        `, () => {
            const newLimit = document.getElementById('newLimit').value;
            if (newLimit === '') {
                this.showError('Please enter a limit');
                return;
            }
            this.updateInstalls(licenseKey, parseInt(newLimit));
        });
    }

    async updateInstalls(licenseKey, newLimit) {
        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/update-installs', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ license_key: licenseKey, new_limit: newLimit })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                this.closeModal();
                this.searchLicenses(); // Refresh results
            } else {
                this.showError(data.error || 'Update failed');
            }
        } catch (error) {
            console.error('Update installs error:', error);
            this.showError('Update failed');
        } finally {
            this.hideLoading();
        }
    }

    showExtendTrialModal(licenseKey) {
        this.showModal('Extend Trial', `
            <div class="form-group">
                <label for="extendDays">Number of Days to Extend:</label>
                <input type="number" id="extendDays" placeholder="Enter number of days" min="1" value="7">
            </div>
        `, () => {
            const days = document.getElementById('extendDays').value;
            if (days === '' || days < 1) {
                this.showError('Please enter a valid number of days');
                return;
            }
            this.extendTrial(licenseKey, parseInt(days));
        });
    }

    async extendTrial(licenseKey, days) {
        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/extend-trial', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ license_key: licenseKey, days })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                this.closeModal();
                this.searchLicenses(); // Refresh results
            } else {
                this.showError(data.error || 'Trial extension failed');
            }
        } catch (error) {
            console.error('Extend trial error:', error);
            this.showError('Trial extension failed');
        } finally {
            this.hideLoading();
        }
    }

    async convertToLifetime(licenseKey) {
        if (!confirm(`Are you sure you want to convert license ${licenseKey} to lifetime unlimited?`)) {
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/convert-lifetime', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ license_key: licenseKey })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                this.searchLicenses(); // Refresh results
            } else {
                this.showError(data.error || 'Conversion failed');
            }
        } catch (error) {
            console.error('Convert lifetime error:', error);
            this.showError('Conversion failed');
        } finally {
            this.hideLoading();
        }
    }

    async getCustomerData() {
        const email = document.getElementById('customerEmail').value.trim();
        
        if (!email) {
            this.showError('Please enter a customer email');
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/customer-data', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ customer_email: email })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.displayCustomerData(data);
            } else {
                this.showError(data.error || 'Failed to load customer data');
            }
        } catch (error) {
            console.error('Customer data error:', error);
            this.showError('Failed to load customer data');
        } finally {
            this.hideLoading();
        }
    }

    displayCustomerData(data) {
        const container = document.getElementById('customerData');
        const summary = document.getElementById('customerSummary');
        const licenses = document.getElementById('customerLicenses');
        const sites = document.getElementById('customerSites');
        
        // Customer summary
        summary.innerHTML = `
            <h3>${data.customer.name}</h3>
            <p><strong>Email:</strong> ${data.customer.email}</p>
            <p><strong>Total Spent:</strong> ${this.formatCurrency(data.customer.total_spent)}</p>
            <p><strong>Active Licenses:</strong> ${data.customer.active_licenses}</p>
            <p><strong>Total Sites:</strong> ${data.customer.total_sites}</p>
            <button class="btn btn-danger" onclick="adminDashboard.killCustomerLicenses('${data.customer.email}', 'disable')">Disable All Licenses</button>
            <button class="btn btn-success" onclick="adminDashboard.killCustomerLicenses('${data.customer.email}', 'enable')">Enable All Licenses</button>
        `;
        
        // Customer licenses
        licenses.innerHTML = '';
        if (data.licenses.length === 0) {
            licenses.innerHTML = '<p>No licenses found</p>';
        } else {
            data.licenses.forEach(license => {
                const item = document.createElement('div');
                item.className = 'license-item';
                item.innerHTML = `
                    <h4>${license.license_key}</h4>
                    <p><strong>Type:</strong> ${license.license_type}</p>
                    <p><strong>Status:</strong> ${license.status}</p>
                    <p><strong>Created:</strong> ${this.formatDate(license.created_at)}</p>
                `;
                licenses.appendChild(item);
            });
        }
        
        // Customer sites
        sites.innerHTML = '';
        if (data.sites.length === 0) {
            sites.innerHTML = '<p>No sites found</p>';
        } else {
            data.sites.forEach(site => {
                const item = document.createElement('div');
                item.className = 'site-item';
                item.innerHTML = `
                    <h4>${site.site_domain}</h4>
                    <p><strong>License:</strong> ${site.site_license_key}</p>
                    <p><strong>Created:</strong> ${this.formatDate(site.created_at)}</p>
                `;
                sites.appendChild(item);
            });
        }
        
        container.style.display = 'block';
    }

    async killCustomerLicenses(email, action) {
        if (!confirm(`Are you sure you want to ${action} all licenses for ${email}?`)) {
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/kill-customer', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-key': this.adminKey
                },
                body: JSON.stringify({ customer_email: email, action })
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                this.getCustomerData(); // Refresh customer data
            } else {
                this.showError(data.error || 'Operation failed');
            }
        } catch (error) {
            console.error('Kill customer licenses error:', error);
            this.showError('Operation failed');
        } finally {
            this.hideLoading();
        }
    }

    async checkSystemHealth() {
        try {
            const response = await fetch('/admin/api/health?admin_key=' + this.adminKey);
            const data = await response.json();
            
            const statusElement = document.getElementById('systemStatus');
            const indicator = statusElement.querySelector('.status-indicator');
            const text = statusElement.querySelector('span');
            
            if (data.success) {
                indicator.className = 'fas fa-circle status-indicator online';
                text.textContent = 'Online';
            } else {
                indicator.className = 'fas fa-circle status-indicator offline';
                text.textContent = 'Offline';
            }
        } catch (error) {
            const statusElement = document.getElementById('systemStatus');
            const indicator = statusElement.querySelector('.status-indicator');
            const text = statusElement.querySelector('span');
            
            indicator.className = 'fas fa-circle status-indicator offline';
            text.textContent = 'Error';
        }
    }

    showModal(title, content, onConfirm) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = content;
        document.getElementById('actionModal').style.display = 'flex';
        
        // Store confirm callback
        this.modalConfirmCallback = onConfirm;
        
        // Bind confirm button
        document.getElementById('modalConfirm').onclick = () => {
            if (this.modalConfirmCallback) {
                this.modalConfirmCallback();
            }
        };
    }

    closeModal() {
        document.getElementById('actionModal').style.display = 'none';
        this.modalConfirmCallback = null;
    }

    showLoading() {
        document.getElementById('loadingOverlay').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loadingOverlay').style.display = 'none';
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            z-index: 3000;
            animation: slideIn 0.3s ease-out;
            background: ${type === 'success' ? '#27ae60' : '#e74c3c'};
        `;
        
        document.body.appendChild(notification);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    formatCurrency(amount) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD'
        }).format(amount);
    }

    formatDate(dateString) {
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}

// Initialize admin dashboard when page loads
let adminDashboard;
document.addEventListener('DOMContentLoaded', () => {
    adminDashboard = new AdminDashboard();
});

// Add CSS animation for notifications
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
`;
document.head.appendChild(style); 