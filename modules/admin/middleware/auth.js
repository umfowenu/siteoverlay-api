const adminAuth = (req, res, next) => {
  const adminKey = req.body?.admin_key || req.query?.admin_key || req.headers['x-admin-key'];
  
  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(401).json({ 
      success: false, 
      message: 'Unauthorized - Invalid admin key' 
    });
  }
  
  // Add admin context to request
  req.admin = {
    authenticated: true,
    timestamp: new Date()
  };
  
  next();
};

module.exports = { adminAuth }; 