const express = require('express');
const router = express.Router();

// Stripe needs the raw body!
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Stripe Webhook route
router.post('/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event (for now, just log it)
  console.log('Received Stripe event:', event.type);

  res.json({ received: true });
});

module.exports = router;
