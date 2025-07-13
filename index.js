require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

// Import routes
const routes = require('./routes');
app.use('/api', routes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SiteOverlay API running on port ${PORT}`);
});
