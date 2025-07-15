require('dotenv').config();
const express = require('express');
const app = express();

// ADD CORS HEADERS - Insert this section right here
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://ebiz360.ca');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Stripe webhooks need raw, others can use json
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe/webhook') {
    next(); // Let the route handle body parsing
  } else {
    express.json()(req, res, next);
  }
});

// Import routes
const routes = require('./routes');
app.use('/api', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SiteOverlay API running on port ${PORT}`);
});