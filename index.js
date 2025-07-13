require('dotenv').config();
const express = require('express');
const app = express();

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
