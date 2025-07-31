const express = require('express');
const path = require('path');
const adminRoutes = require('./routes');

class AdminModule {
  constructor() {
    this.router = express.Router();
    this.setupRoutes();
    this.setupStaticFiles();
  }

  setupRoutes() {
    // API routes
    this.router.use('/api', adminRoutes);
    
    // Serve admin interface at /admin
    this.router.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'views', 'admin.html'));
    });
  }

  setupStaticFiles() {
    // Serve static assets
    this.router.use('/css', express.static(path.join(__dirname, 'views', 'css')));
    this.router.use('/js', express.static(path.join(__dirname, 'views', 'js')));
  }

  getRouter() {
    return this.router;
  }
}

module.exports = AdminModule; 