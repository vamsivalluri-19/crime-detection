const AuditLog = require('../models/AuditLog');

module.exports = async function auditLogger(req, res, next) {
  res.on('finish', async () => {
    if (req.user) {
      await AuditLog.create({
        user: req.user.id,
        action: req.method + ' ' + req.originalUrl,
        details: JSON.stringify(req.body || {}),
      });
    }
  });
  next();
};
