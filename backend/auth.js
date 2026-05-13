const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const fs = require('fs');
const path = require('path');

const fallbackStorePath = path.join(__dirname, 'data', 'auth-users.json');
const memoryUsers = new Map();

function ensureFallbackStoreDir() {
  try {
    fs.mkdirSync(path.dirname(fallbackStorePath), { recursive: true });
  } catch (_) {}
}

function loadFallbackUsers() {
  ensureFallbackStoreDir();

  try {
    if (!fs.existsSync(fallbackStorePath)) {
      return;
    }

    const raw = fs.readFileSync(fallbackStorePath, 'utf8');
    const parsed = raw ? JSON.parse(raw) : [];

    if (Array.isArray(parsed)) {
      for (const user of parsed) {
        if (user && user.username && user.password) {
          memoryUsers.set(user.username, user);
        }
      }
    }
  } catch (_) {
    // Ignore malformed fallback store and start fresh.
  }
}

function persistFallbackUsers() {
  ensureFallbackStoreDir();

  try {
    const payload = JSON.stringify(Array.from(memoryUsers.values()), null, 2);
    fs.writeFileSync(fallbackStorePath, payload, 'utf8');
  } catch (_) {
    // If disk persistence fails, keep the in-memory fallback alive for this process.
  }
}

loadFallbackUsers();

function isMongoConnected() {
  return mongoose.connection && mongoose.connection.readyState === 1;
}

function makeUserPayload(user) {
  return { username: user.username, role: user.role };
}

module.exports = (app, JWT_SECRET = 'your_jwt_secret') => {
  // Register
  app.post('/api/register', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = String(req.body.role || 'citizen').trim() || 'citizen';

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    if (!['admin', 'officer', 'citizen'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Invalid role selected' });
    }

    const hash = await bcrypt.hash(password, 10);

    if (!isMongoConnected()) {
      if (memoryUsers.has(username)) {
        return res.status(409).json({ success: false, message: 'User already exists' });
      }

      const user = {
        _id: new mongoose.Types.ObjectId(),
        username,
        password: hash,
        role
      };

      memoryUsers.set(username, user);
      persistFallbackUsers();
      return res.json({ success: true, user: makeUserPayload(user) });
    }

    try {
      const user = await User.create({ username, password: hash, role });
      res.json({ success: true, user: makeUserPayload(user) });
    } catch (e) {
      if (e && e.code === 11000) {
        return res.status(409).json({ success: false, message: 'User already exists' });
      }

      if (String(e?.message || '').toLowerCase().includes('buffering timed out')) {
        if (memoryUsers.has(username)) {
          return res.status(409).json({ success: false, message: 'User already exists' });
        }

        const user = {
          _id: new mongoose.Types.ObjectId(),
          username,
          password: hash,
          role
        };

        memoryUsers.set(username, user);
        persistFallbackUsers();
        return res.json({ success: true, user: makeUserPayload(user) });
      }

      res.status(400).json({ success: false, message: e.message || 'Unable to register user' });
    }
  });

  // Login
  app.post('/api/auth', async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const requestedRole = String(req.body.role || '').trim();

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    let user = null;

    if (isMongoConnected()) {
      try {
        user = await User.findOne({ username });
      } catch (e) {
        if (!String(e?.message || '').toLowerCase().includes('buffering timed out')) {
          throw e;
        }
      }
    }

    if (!user) {
      user = memoryUsers.get(username) || null;
    }

    if (!user) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '1d' });
    res.json({
      success: true,
      token,
      role: user.role,
      requestedRole: requestedRole || undefined,
      message: requestedRole && requestedRole !== user.role ? `Logged in as ${user.role}` : undefined
    });
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

module.exports.memoryUsers = memoryUsers;
