const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

module.exports = (app, JWT_SECRET = 'your_jwt_secret') => {
  // Register
  app.post('/api/register', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'Missing fields' });
    const hash = await bcrypt.hash(password, 10);
    try {
      const user = await User.create({ username, password: hash, role });
      res.json({ success: true, user: { username: user.username, role: user.role } });
    } catch (e) {
      res.status(400).json({ success: false, message: 'User exists' });
    }
  });

  // Login
  app.post('/api/auth', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });
    const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({ success: true, token, role: user.role });
  });

  // Auth middleware
  app.use('/api/secure', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ success: false, message: 'No token' });
    try {
      req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ success: false, message: 'Invalid token' });
    }
  });
};
