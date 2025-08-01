// Admin Dashboard JavaScript
class AdminDashboard {
    constructor() {
        this.adminKey = this.getAdminKey();
        this.init();
    }

    // Add these new variables at the top
    currentPurchasersSort = { column: 'created_at', direction: 'desc' };
    currentTrialsSort = { column: 'created_at', direction: 'desc' };
    purchasersData = [];
    trialsData = [];

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

        // Dynamic content management
        document.getElementById('refreshContentBtn').addEventListener('click', () => {
            this.loadDynamicContent();
        });

        document.getElementById('saveContentBtn').addEventListener('click', () => {
            this.saveDynamicContent();
        });

        document.getElementById('clearContentBtn').addEventListener('click', () => {
            this.clearContentForm();
        });

        document.getElementById('togglePreviewBtn').addEventListener('click', () => {
            this.togglePluginPreview();
        });

        // Preview tabs
        document.querySelectorAll('.preview-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                this.switchPreviewTab(e.target.dataset.tab);
            });
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
                this.loadPurchasers(); // Auto-load purchasers
                this.loadTrials();     // Auto-load trials
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

    // Load all purchasers
    async loadPurchasers(sortBy = null, sortOrder = null) {
        try {
            console.log('🔍 DEBUG: Loading purchasers...');
            const sort = sortBy || this.currentPurchasersSort.column;
            const order = sortOrder || this.currentPurchasersSort.direction;
            
            const url = `/admin/api/purchasers?admin_key=${this.adminKey}&sort_by=${sort}&sort_order=${order}`;
            console.log('🔍 DEBUG: Fetching from URL:', url);
            
            const response = await fetch(url);
            console.log('🔍 DEBUG: Response status:', response.status);
            
            const data = await response.json();
            console.log('🔍 DEBUG: Response data:', data);
            
            if (data.success) {
                this.purchasersData = data.purchasers;
                this.currentPurchasersSort = { column: sort, direction: order };
                console.log('🔍 DEBUG: Found purchasers:', data.purchasers.length);
                this.displayPurchasersTable(data.purchasers, sort, order);
            } else {
                console.error('🔍 DEBUG: API returned success: false');
            }
        } catch (error) {
            console.error('Error loading purchasers:', error);
        }
    }

    // Load all trials
    async loadTrials(sortBy = null, sortOrder = null) {
        try {
            const sort = sortBy || this.currentTrialsSort.column;
            const order = sortOrder || this.currentTrialsSort.direction;
            
            const response = await fetch(`/admin/api/trials?admin_key=${this.adminKey}&sort_by=${sort}&sort_order=${order}`);
            const data = await response.json();
            
            if (data.success) {
                this.trialsData = data.trials;
                this.currentTrialsSort = { column: sort, direction: order };
                this.displayTrialsTable(data.trials, sort, order);
            }
        } catch (error) {
            console.error('Error loading trials:', error);
        }
    }

    // Display purchasers table
    displayPurchasersTable(purchasers, sortColumn, sortDirection) {
        const container = document.getElementById('purchasersTable');
        
        if (!purchasers || purchasers.length === 0) {
            container.innerHTML = '<p>No purchasers found.</p>';
            return;
        }

        let html = `
            <table class="sortable-table">
                <thead>
                    <tr>
                        <th onclick="adminDashboard.sortPurchasers('license_key')" class="${sortColumn === 'license_key' ? 'sort-' + sortDirection : ''}">License Key</th>
                        <th onclick="adminDashboard.sortPurchasers('license_type')" class="${sortColumn === 'license_type' ? 'sort-' + sortDirection : ''}">Type</th>
                        <th onclick="adminDashboard.sortPurchasers('customer_name')" class="${sortColumn === 'customer_name' ? 'sort-' + sortDirection : ''}">Customer</th>
                        <th onclick="adminDashboard.sortPurchasers('customer_email')" class="${sortColumn === 'customer_email' ? 'sort-' + sortDirection : ''}">Email</th>
                        <th onclick="adminDashboard.sortPurchasers('status')" class="${sortColumn === 'status' ? 'sort-' + sortDirection : ''}">Status</th>
                        <th onclick="adminDashboard.sortPurchasers('kill_switch_enabled')" class="${sortColumn === 'kill_switch_enabled' ? 'sort-' + sortDirection : ''}">Kill Switch</th>
                        <th onclick="adminDashboard.sortPurchasers('site_limit')" class="${sortColumn === 'site_limit' ? 'sort-' + sortDirection : ''}">Sites Limit</th>
                        <th onclick="adminDashboard.sortPurchasers('sites_used')" class="${sortColumn === 'sites_used' ? 'sort-' + sortDirection : ''}">Sites Used</th>
                        <th onclick="adminDashboard.sortPurchasers('amount_paid')" class="${sortColumn === 'amount_paid' ? 'sort-' + sortDirection : ''}">Revenue</th>
                        <th onclick="adminDashboard.sortPurchasers('created_at')" class="${sortColumn === 'created_at' ? 'sort-' + sortDirection : ''}">Created</th>
                        <th onclick="adminDashboard.sortPurchasers('renewal_date')" class="${sortColumn === 'renewal_date' ? 'sort-' + sortDirection : ''}">Renewal</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        purchasers.forEach(p => {
            const statusClass = p.status === 'active' ? 'status-active' : 'status-inactive';
            const killStatus = p.kill_switch_enabled ? 'Enabled' : 'KILLED';
            const siteLimit = p.site_limit === -1 ? 'Unlimited' : p.site_limit;
            const createdDate = new Date(p.created_at).toLocaleDateString();
            const renewalDate = p.renewal_date ? new Date(p.renewal_date).toLocaleDateString() : 'Never';
            
            html += `
                <tr>
                    <td><span class="license-code">${p.license_key}</span></td>
                    <td>${p.license_type}</td>
                    <td>${p.customer_name || 'N/A'}</td>
                    <td>${p.customer_email}</td>
                    <td><span class="status-badge ${statusClass}">${p.status}</span></td>
                    <td><span class="status-badge ${p.kill_switch_enabled ? 'status-active' : 'status-inactive'}">${killStatus}</span></td>
                    <td>${siteLimit}</td>
                    <td>${p.sites_used}</td>
                    <td>$${parseFloat(p.amount_paid || 0).toFixed(2)}</td>
                    <td>${createdDate}</td>
                    <td>${renewalDate}</td>
                    <td>
                        <button class="mini-btn btn-xs-info" onclick="adminDashboard.viewCustomer('${p.customer_email}')">View</button>
                        ${p.status === 'active' ? 
                            `<button class="mini-btn btn-xs-danger" onclick="adminDashboard.toggleLicenseStatus('${p.license_key}', 'disable')">Disable</button>` :
                            `<button class="mini-btn btn-xs-success" onclick="adminDashboard.toggleLicenseStatus('${p.license_key}', 'enable')">Enable</button>`
                        }
                        ${p.kill_switch_enabled ? 
                            `<button class="mini-btn btn-xs-danger" onclick="adminDashboard.toggleKillSwitch('${p.license_key}', 'disable')">Kill</button>` :
                            `<button class="mini-btn btn-xs-success" onclick="adminDashboard.toggleKillSwitch('${p.license_key}', 'enable')">Revive</button>`
                        }
                        <button class="mini-btn btn-xs-warning" onclick="adminDashboard.showUpdateInstallsModal('${p.license_key}', ${p.site_limit})">Sites</button>
                        <button class="mini-btn btn-xs-success" onclick="adminDashboard.convertToLifetime('${p.license_key}')">Lifetime</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Display trials table
    displayTrialsTable(trials, sortColumn, sortDirection) {
        const container = document.getElementById('trialsTable');
        
        if (!trials || trials.length === 0) {
            container.innerHTML = '<p>No trials found.</p>';
            return;
        }

        let html = `
            <table class="sortable-table">
                <thead>
                    <tr>
                        <th onclick="adminDashboard.sortTrials('license_key')" class="${sortColumn === 'license_key' ? 'sort-' + sortDirection : ''}">License Key</th>
                        <th onclick="adminDashboard.sortTrials('customer_name')" class="${sortColumn === 'customer_name' ? 'sort-' + sortDirection : ''}">Customer</th>
                        <th onclick="adminDashboard.sortTrials('customer_email')" class="${sortColumn === 'customer_email' ? 'sort-' + sortDirection : ''}">Email</th>
                        <th onclick="adminDashboard.sortTrials('trial_status')" class="${sortColumn === 'trial_status' ? 'sort-' + sortDirection : ''}">Trial Status</th>
                        <th onclick="adminDashboard.sortTrials('status')" class="${sortColumn === 'status' ? 'sort-' + sortDirection : ''}">License Status</th>
                        <th onclick="adminDashboard.sortTrials('sites_used')" class="${sortColumn === 'sites_used' ? 'sort-' + sortDirection : ''}">Sites Used</th>
                        <th onclick="adminDashboard.sortTrials('days_remaining')" class="${sortColumn === 'days_remaining' ? 'sort-' + sortDirection : ''}">Days Left</th>
                        <th onclick="adminDashboard.sortTrials('created_at')" class="${sortColumn === 'created_at' ? 'sort-' + sortDirection : ''}">Started</th>
                        <th onclick="adminDashboard.sortTrials('trial_end_date')" class="${sortColumn === 'trial_end_date' ? 'sort-' + sortDirection : ''}">Expires</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;

        trials.forEach(t => {
            const statusClass = t.status === 'active' ? 'status-active' : 'status-inactive';
            const trialStatusClass = t.trial_status === 'active' ? 'status-active' : t.trial_status === 'expired' ? 'status-expired' : 'status-inactive';
            const createdDate = new Date(t.created_at).toLocaleDateString();
            const expiresDate = t.trial_end_date ? new Date(t.trial_end_date).toLocaleDateString() : 'Unknown';
            
            html += `
                <tr>
                    <td><span class="license-code">${t.license_key}</span></td>
                    <td>${t.customer_name || 'N/A'}</td>
                    <td>${t.customer_email}</td>
                    <td><span class="status-badge ${trialStatusClass}">${t.trial_status}</span></td>
                    <td><span class="status-badge ${statusClass}">${t.status}</span></td>
                    <td>${t.sites_used}</td>
                    <td>${t.days_remaining}</td>
                    <td>${createdDate}</td>
                    <td>${expiresDate}</td>
                    <td>
                        <button class="mini-btn btn-xs-info" onclick="adminDashboard.viewCustomer('${t.customer_email}')">View</button>
                        ${t.status === 'active' ? 
                            `<button class="mini-btn btn-xs-danger" onclick="adminDashboard.toggleLicenseStatus('${t.license_key}', 'disable')">Disable</button>` :
                            `<button class="mini-btn btn-xs-success" onclick="adminDashboard.toggleLicenseStatus('${t.license_key}', 'enable')">Enable</button>`
                        }
                        ${t.kill_switch_enabled ? 
                            `<button class="mini-btn btn-xs-danger" onclick="adminDashboard.toggleKillSwitch('${t.license_key}', 'disable')">Kill</button>` :
                            `<button class="mini-btn btn-xs-success" onclick="adminDashboard.toggleKillSwitch('${t.license_key}', 'enable')">Revive</button>`
                        }
                        <button class="mini-btn btn-xs-info" onclick="adminDashboard.showExtendTrialModal('${t.license_key}')">Extend</button>
                        <button class="mini-btn btn-xs-success" onclick="adminDashboard.convertToLifetime('${t.license_key}')">Upgrade</button>
                    </td>
                </tr>
            `;
        });

        html += '</tbody></table>';
        container.innerHTML = html;
    }

    // Sort functions
    sortPurchasers(column) {
        const newDirection = (this.currentPurchasersSort.column === column && this.currentPurchasersSort.direction === 'asc') ? 'desc' : 'asc';
        this.loadPurchasers(column, newDirection);
    }

    sortTrials(column) {
        const newDirection = (this.currentTrialsSort.column === column && this.currentTrialsSort.direction === 'asc') ? 'desc' : 'asc';
        this.loadTrials(column, newDirection);
    }

    // Toggle license status (enable/disable)
    async toggleLicenseStatus(licenseKey, action) {
        if (!confirm(`Are you sure you want to ${action} license ${licenseKey}?`)) {
            return;
        }

        try {
            this.showLoading();
            
            const response = await fetch('/admin/api/toggle-status', {
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
                this.loadDashboard(); // Refresh dashboard
                this.loadPurchasers(); // Refresh purchasers
                this.loadTrials(); // Refresh trials
            } else {
                this.showError(data.error || 'Operation failed');
            }
        } catch (error) {
            console.error('Toggle license status error:', error);
            this.showError('Operation failed');
        } finally {
            this.hideLoading();
        }
    }

    // View customer function
    viewCustomer(email) {
        document.getElementById('customerEmail').value = email;
        this.getCustomerData();
    }

    // Toggle view function for hiding/showing sections
    toggleView(section) {
        const element = document.getElementById(section + 'Table').parentElement;
        element.classList.toggle('section-hidden');
    }

    // Dynamic Content Management Methods
    async loadDynamicContent() {
        try {
            this.showLoading();
            
            const response = await fetch(`/admin/dynamic-content?admin_key=${this.adminKey}`);
            const data = await response.json();
            
            if (data.success) {
                this.displayDynamicContent(data.content);
                this.updatePluginPreview(data.content);
            } else {
                this.showError('Failed to load dynamic content');
            }
        } catch (error) {
            console.error('Dynamic content load error:', error);
            this.showError('Failed to load dynamic content');
        } finally {
            this.hideLoading();
        }
    }

    displayDynamicContent(content) {
        const tbody = document.getElementById('contentTableBody');
        tbody.innerHTML = '';

        content.forEach(item => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${item.content_key}</strong></td>
                <td class="content-value" title="${item.content_value || ''}">${item.content_value || '<em>No value</em>'}</td>
                <td><span class="badge badge-${item.content_type}">${item.content_type}</span></td>
                <td>${item.license_type}</td>
                <td>
                    <span class="status-badge ${item.is_active ? 'status-active' : 'status-inactive'}">
                        ${item.is_active ? 'Active' : 'Inactive'}
                    </span>
                </td>
                <td class="content-actions">
                    <button class="mini-btn btn-xs-info" onclick="adminDashboard.editContent('${item.content_key}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="mini-btn btn-xs-${item.is_active ? 'warning' : 'success'}" 
                            onclick="adminDashboard.toggleContentStatus('${item.content_key}', ${!item.is_active})">
                        <i class="fas fa-${item.is_active ? 'pause' : 'play'}"></i>
                    </button>
                    <button class="mini-btn btn-xs-danger" onclick="adminDashboard.deleteContent('${item.content_key}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    editContent(contentKey) {
        // Find the content item and populate the form
        fetch(`/admin/dynamic-content?admin_key=${this.adminKey}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    const item = data.content.find(c => c.content_key === contentKey);
                    if (item) {
                        document.getElementById('contentKey').value = item.content_key;
                        document.getElementById('contentValue').value = item.content_value || '';
                        document.getElementById('contentType').value = item.content_type;
                        document.getElementById('licenseType').value = item.license_type;
                        document.getElementById('pluginVersionMin').value = item.plugin_version_min || '';
                        document.getElementById('pluginVersionMax').value = item.plugin_version_max || '';
                        document.getElementById('contentActive').checked = item.is_active;
                        
                        // Scroll to the editor
                        document.querySelector('.content-editor').scrollIntoView({ behavior: 'smooth' });
                    }
                }
            });
    }

    async saveDynamicContent() {
        try {
            const contentData = {
                admin_key: this.adminKey,
                content_key: document.getElementById('contentKey').value.trim(),
                content_value: document.getElementById('contentValue').value.trim(),
                content_type: document.getElementById('contentType').value,
                license_type: document.getElementById('licenseType').value,
                plugin_version_min: document.getElementById('pluginVersionMin').value.trim() || null,
                plugin_version_max: document.getElementById('pluginVersionMax').value.trim() || null,
                is_active: document.getElementById('contentActive').checked
            };

            if (!contentData.content_key) {
                this.showError('Content key is required');
                return;
            }

            this.showLoading();

            const response = await fetch('/admin/dynamic-content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contentData)
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess(data.message);
                this.clearContentForm();
                this.loadDynamicContent(); // Refresh the content list
            } else {
                this.showError(data.error || 'Failed to save content');
            }
        } catch (error) {
            console.error('Save content error:', error);
            this.showError('Failed to save content');
        } finally {
            this.hideLoading();
        }
    }

    clearContentForm() {
        document.getElementById('contentKey').value = '';
        document.getElementById('contentValue').value = '';
        document.getElementById('contentType').value = 'text';
        document.getElementById('licenseType').value = 'all';
        document.getElementById('pluginVersionMin').value = '';
        document.getElementById('pluginVersionMax').value = '';
        document.getElementById('contentActive').checked = true;
    }

    async toggleContentStatus(contentKey, isActive) {
        try {
            const contentData = {
                admin_key: this.adminKey,
                content_key: contentKey,
                is_active: isActive
            };

            const response = await fetch('/admin/dynamic-content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contentData)
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess(`Content ${isActive ? 'activated' : 'deactivated'} successfully`);
                this.loadDynamicContent(); // Refresh the content list
            } else {
                this.showError(data.error || 'Failed to update content status');
            }
        } catch (error) {
            console.error('Toggle content status error:', error);
            this.showError('Failed to update content status');
        }
    }

    async deleteContent(contentKey) {
        if (!confirm(`Are you sure you want to delete the content "${contentKey}"?`)) {
            return;
        }

        try {
            const contentData = {
                admin_key: this.adminKey,
                content_key: contentKey,
                is_active: false // Deactivate instead of delete for safety
            };

            const response = await fetch('/admin/dynamic-content', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(contentData)
            });

            const data = await response.json();

            if (data.success) {
                this.showSuccess('Content deactivated successfully');
                this.loadDynamicContent(); // Refresh the content list
            } else {
                this.showError(data.error || 'Failed to deactivate content');
            }
        } catch (error) {
            console.error('Delete content error:', error);
            this.showError('Failed to deactivate content');
        }
    }

    togglePluginPreview() {
        const preview = document.getElementById('pluginPreview');
        const button = document.getElementById('togglePreviewBtn');
        
        if (preview.style.display === 'none') {
            preview.style.display = 'block';
            button.innerHTML = '<i class="fas fa-eye-slash"></i> Hide Plugin Preview';
            this.loadDynamicContent(); // Load content for preview
        } else {
            preview.style.display = 'none';
            button.innerHTML = '<i class="fas fa-eye"></i> Toggle Plugin Preview';
        }
    }

    switchPreviewTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.preview-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

        // Update preview panels
        document.querySelectorAll('.preview-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(tabName + 'Preview').classList.add('active');
    }

    updatePluginPreview(content) {
        // Update settings page preview
        const settingsContent = document.getElementById('previewDynamicContent');
        settingsContent.innerHTML = '';

        content.forEach(item => {
            if (item.is_active) {
                const contentDiv = document.createElement('div');
                contentDiv.className = 'preview-content-item';
                contentDiv.innerHTML = `
                    <p><strong>${item.content_key}:</strong> ${item.content_value || '<em>No value</em>'}</p>
                `;
                settingsContent.appendChild(contentDiv);
            }
        });

        // Update meta box preview
        const metaboxContent = document.getElementById('previewMetaboxContent');
        metaboxContent.innerHTML = `
            <div class="preview-content-item">
                <p><strong>Upgrade Message:</strong> Limited Time: Save $100 on Unlimited License!</p>
                <p><strong>Support URL:</strong> <a href="#">https://siteoverlaypro.com/support</a></p>
                <p><strong>Training URL:</strong> <a href="#">https://siteoverlaypro.com/training</a></p>
            </div>
        `;
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