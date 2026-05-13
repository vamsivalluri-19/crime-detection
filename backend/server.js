// Simple Express backend for AI Crime Detection System

// Load environment variables from .env
try {
  require('dotenv').config();
} catch (_) {
  // dotenv may not be installed in some environments; ignore
}

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const http = require('http');
const socketio = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: '*' } });
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';
const allowedOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:3005',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'http://127.0.0.1:3003',
  'http://127.0.0.1:3004',
  'http://127.0.0.1:3005'
]);

const configuredCorsOrigins = String(process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

for (const origin of configuredCorsOrigins) {
  allowedOrigins.add(origin);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) return true;
  if (/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin)) return true;
  return false;
}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

const Profile = require('./models/Profile');
const IncidentComment = require('./models/IncidentComment');
const AuditLog = require('./models/AuditLog');
const User = require('./models/User');
const auditLogger = require('./middleware/auditLogger');

// MongoDB connection: prefer MONGO_URI env var, fallback to local MongoDB for dev
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crimeai';

mongoose.connect(MONGO_URI).then(() => {
  // Mask password when logging URI
  try {
    const masked = MONGO_URI.replace(/:\/\/.+@/, '://*****@');
    console.log('MongoDB connected successfully to', masked);
  } catch (_) {
    console.log('MongoDB connected successfully');
  }
}).catch(err => {
  console.warn('MongoDB not available — running with in-memory data only:', err.message);
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// NOTE: When deploying frontend separately (e.g. Vercel), the backend
// should not serve the frontend static files. The frontend will be
// hosted on Vercel and communicate with this backend (Render) via
// the public API URL. Keep CORS enabled to allow cross-origin requests.

// Decode token when present so protected handlers can read req.user.
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    } catch (_) {
      req.user = null;
    }
  }
  next();
});

// File upload setup
const upload = multer({ dest: 'uploads/' });

// Auth routes
require('./auth')(app, JWT_SECRET);

// Audit log middleware
app.use(auditLogger);

// WebSocket for live alerts
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) {
    socket.user = null;
    return next();
  }

  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    next(new Error('Unauthorized socket connection'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('citizen-speech', (payload = {}) => {
    if (!socket.user || socket.user.role !== 'citizen') return;

    const speechEvent = {
      userId: socket.user.id,
      role: socket.user.role,
      username: payload.username || 'Citizen',
      text: String(payload.text || '').trim(),
      timestamp: new Date().toISOString()
    };

    if (!speechEvent.text) return;

    io.emit('citizen-speech', speechEvent);
  });

  socket.on('citizen-complaint', (payload = {}) => {
    if (!socket.user || socket.user.role !== 'citizen') return;

    const complaintEvent = {
      trackerId: String(payload.trackerId || `${socket.user.id}-${Date.now()}`),
      userId: socket.user.id,
      role: socket.user.role,
      username: payload.username || socket.user.username || 'Citizen',
      citizenName: payload.citizenName || payload.username || socket.user.username || 'Citizen',
      citizenPhone: payload.citizenPhone || '',
      citizenDetails: payload.citizenDetails || '',
      complaintType: payload.complaintType || 'Incident',
      locationText: payload.locationText || '',
      description: String(payload.description || '').trim(),
      reportId: payload.reportId || null,
      timestamp: new Date().toISOString()
    };

    io.emit('citizen-complaint', complaintEvent);
  });

  socket.on('citizen-live-location', (payload = {}) => {
    if (!socket.user || socket.user.role !== 'citizen') return;

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const ended = Boolean(payload.ended);

    if (!ended && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
      return;
    }

    const liveLocationEvent = {
      trackerId: String(payload.trackerId || `${socket.user.id}`),
      userId: socket.user.id,
      role: socket.user.role,
      username: payload.username || socket.user.username || 'Citizen',
      citizenName: payload.citizenName || payload.username || socket.user.username || 'Citizen',
      citizenPhone: payload.citizenPhone || '',
      complaintType: payload.complaintType || 'Incident',
      locationText: payload.locationText || '',
      latitude: ended ? null : latitude,
      longitude: ended ? null : longitude,
      ended,
      timestamp: new Date().toISOString()
    };

    io.emit('citizen-live-location', liveLocationEvent);
  });

  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

// Helper: emit alert to all clients
function emitAlert(alert) {
  io.emit('new-alert', alert);
}

// --- User Profile Management ---
app.get('/api/profile', async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false });
  const profile = await Profile.findOne({ user: req.user.id });
  res.json({ profile });
});

app.post('/api/profile', upload.single('avatar'), async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false });
  let notificationPreferences = req.body.notificationPreferences;
  if (typeof notificationPreferences === 'string') {
    try {
      notificationPreferences = JSON.parse(notificationPreferences);
    } catch (_) {
      notificationPreferences = undefined;
    }
  }

  const update = {
    name: req.body.name,
    email: req.body.email,
    phone: req.body.phone,
    lastUpdated: new Date()
  };

  if (notificationPreferences && typeof notificationPreferences === 'object') {
    update.notificationPreferences = {
      emailIncidents: Boolean(notificationPreferences.emailIncidents),
      smsEmergencies: Boolean(notificationPreferences.smsEmergencies),
      pushNotifications: Boolean(notificationPreferences.pushNotifications)
    };
  }

  if (req.file) update.avatar = '/uploads/' + req.file.filename;
  const profile = await Profile.findOneAndUpdate(
    { user: req.user.id },
    { $set: update, $setOnInsert: { user: req.user.id } },
    { upsert: true, new: true }
  );
  res.json({ profile });
});

app.post('/api/profile/password', async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Missing password fields' });
  }

  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  const passwordMatches = await bcrypt.compare(currentPassword, user.password);
  if (!passwordMatches) {
    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  res.json({ success: true, message: 'Password updated' });
});

// --- Incident Commenting & Status Updates ---
app.get('/api/incidents/:id/comments', async (req, res) => {
  const comments = await IncidentComment.find({ incidentId: req.params.id }).populate('user', 'username');
  res.json({ comments });
});

app.post('/api/incidents/:id/comments', async (req, res) => {
  if (!req.user) return res.status(401).json({ success: false });
  const comment = await IncidentComment.create({
    incidentId: req.params.id,
    user: req.user.id,
    comment: req.body.comment,
    status: req.body.status
  });
  res.json({ comment });
});

// --- Audit Logs ---
app.get('/api/audit-logs', async (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false });
  const logs = await AuditLog.find().populate('user', 'username').sort({ createdAt: -1 }).limit(100);
  res.json({ logs });
});

// In-memory data for demo
let alerts = [
  { id: 'SOS-001', type: 'SOS Emergency', location: 'Andheri West', time: '2 minutes ago' },
  { id: 'WD-024', type: 'Weapon Detected', location: 'Bandra Station', time: '5 minutes ago' },
  { id: 'SA-015', type: 'Suspicious Activity', location: 'Marine Drive', time: '8 minutes ago' }
];

let patrolUnits = [
  { id: 'P-101', status: 'Active', location: 'Andheri West', officers: 3, responseTime: '3.5 min' },
  { id: 'P-102', status: 'En Route', location: 'Bandra Station', officers: 2, responseTime: '2 min' },
  { id: 'P-103', status: 'Active', location: 'Marine Drive', officers: 4, responseTime: '4.1 min' },
  { id: 'P-104', status: 'Active', location: 'Colaba', officers: 3, responseTime: '5.2 min' }
];

let contacts = [
  { name: 'John Doe', relation: 'Family', phone: '+91 98765 43210' },
  { name: 'Jane Smith', relation: 'Friend', phone: '+91 98765 43211' }
];

let reports = [
  { id: 'INC-1047', type: 'Weapon Detection', location: 'Bandra Station', status: 'Investigating', date: 'Mar 16, 2026' },
  { id: 'INC-1046', type: 'SOS Emergency', location: 'Andheri West', status: 'Resolved', date: 'Mar 16, 2026' },
  { id: 'INC-1045', type: 'Suspicious Activity', location: 'Marine Drive', status: 'Under Review', date: 'Mar 16, 2026' },
  { id: 'INC-1044', type: 'Vehicle Theft', location: 'Colaba', status: 'Open', date: 'Mar 15, 2026' }
];

// SOS alert (with WebSocket broadcast)
app.post('/api/sos', async (req, res) => {
  const { latitude, longitude } = req.body;
  const id = 'SOS-' + (Math.floor(Math.random() * 1000) + 100);

  const baseAlert = {
    id,
    type: 'SOS Emergency',
    location: `Lat: ${latitude}, Lng: ${longitude}`,
    latitude: Number(latitude),
    longitude: Number(longitude),
    time: 'Just now'
  };

  // Attach caller profile when available so officers/admins can see who sent the SOS
  let sosEvent = { ...baseAlert };
  if (req.user) {
    try {
      const profile = await Profile.findOne({ user: req.user.id }).lean();
      sosEvent.userId = req.user.id;
      sosEvent.username = req.user.username || undefined;
      if (profile) {
        sosEvent.citizenName = profile.name || undefined;
        sosEvent.citizenPhone = profile.phone || undefined;
        sosEvent.avatar = profile.avatar || undefined;
      }
    } catch (err) {
      // ignore profile lookup failures and continue
    }
  }

  alerts.unshift(baseAlert);
  emitAlert(baseAlert);

  // Emit a dedicated socket event with profile for officer/admin clients
  io.emit('citizen-sos', sosEvent);

  res.json({ success: true, message: 'SOS alert received', data: sosEvent });
});

// Incident search/filter
app.get('/api/incidents/search', (req, res) => {
  const { type, location, status, date } = req.query;
  let filtered = reports;
  if (type) filtered = filtered.filter(r => r.type.toLowerCase().includes(type.toLowerCase()));
  if (location) filtered = filtered.filter(r => r.location.toLowerCase().includes(location.toLowerCase()));
  if (status) filtered = filtered.filter(r => r.status.toLowerCase() === status.toLowerCase());
  if (date) filtered = filtered.filter(r => r.date === date);
  res.json({ reports: filtered });
});

// Map-based incident reporting
app.post('/api/map-report', (req, res) => {
  const { type, latitude, longitude, description } = req.body;
  const id = 'INC-' + Math.floor(Math.random() * 10000);
  const report = { id, type, location: `Lat: ${latitude}, Lng: ${longitude}`, status: 'Open', date: new Date().toLocaleDateString(), description };
  reports.unshift(report);
  res.json({ success: true, message: 'Map report submitted', reportId: id });
});

// Patrol unit live tracking (simulate with in-memory, real would use GPS updates)
let patrolLocations = [
  { id: 'P-101', lat: 19.0596, lng: 72.8295 },
  { id: 'P-102', lat: 19.0544, lng: 72.8406 },
  { id: 'P-103', lat: 19.0760, lng: 72.8777 },
  { id: 'P-104', lat: 18.9220, lng: 72.8347 }
];

app.get('/api/patrol-locations', (req, res) => {
  res.json({ locations: patrolLocations });
});

app.post('/api/patrol-locations', (req, res) => {
  const { id, lat, lng } = req.body;
  const idx = patrolLocations.findIndex(u => u.id === id);
  if (idx !== -1) {
    patrolLocations[idx] = { id, lat, lng };
    return res.json({ success: true });
  }
  patrolLocations.push({ id, lat, lng });
  res.json({ success: true });
});

// Patrol units
app.get('/api/patrol-units', (req, res) => {
  res.json({ units: patrolUnits });
});

// AI Detection feed
app.get('/api/ai-detections', (req, res) => {
  res.json({
    detections: [
      { id: 'WD-024', type: 'Weapon Detection', location: 'Bandra Station Platform 2', confidence: 94.2, time: '5 minutes ago' },
      { id: 'SB-015', type: 'Suspicious Behavior', location: 'Marine Drive Junction', confidence: 78.5, time: '8 minutes ago' },
      { id: 'VA-008', type: 'Violence Alert', location: 'Gateway of India Area', confidence: 87.3, time: '12 minutes ago' },
      { id: 'SV-031', type: 'Stolen Vehicle', location: 'Western Express Highway', license: 'MH-02-XX-1234', time: '15 minutes ago' }
    ]
  });
});

// Analytics (dummy)
app.get('/api/analytics', (req, res) => {
  res.json({
    prediction: {
      highRiskAreas: [
        { area: 'Bandra', risk: 92 },
        { area: 'Andheri', risk: 85 },
        { area: 'Marine Drive', risk: 78 }
      ],
      totalIncidents: 248,
      preventionRate: 67,
      aiAccuracy: 91.2
    },
    trends: {
      peakHours: '10 PM - 2 AM (weekends)',
      recommendation: 'Increase patrols during peak hours'
    },
    nlp: {
      socialAlerts: [
        '12 mentions of suspicious activity near Bandra station',
        '5 posts about unusual crowd gathering at Marine Drive',
        '3 emergency-related keywords detected in Andheri area',
        'Sentiment analysis: increased public concern in Zone 4'
      ]
    }
  });
});

// Reports
app.get('/api/reports', (req, res) => {
  res.json({ reports });
});

app.post('/api/report', upload.array('evidence'), (req, res) => {
  const {
    type,
    location,
    description,
    citizenName,
    citizenPhone,
    citizenDetails,
    reportLatitude,
    reportLongitude
  } = req.body;
  const id = 'INC-' + Math.floor(Math.random() * 10000);
  const lat = Number(reportLatitude);
  const lng = Number(reportLongitude);
  const reporterName = req.user?.username || citizenName || 'Citizen';
  const report = {
    id,
    type,
    location,
    description,
    citizenName: citizenName || reporterName,
    citizenPhone: citizenPhone || '',
    citizenDetails: citizenDetails || '',
    reportLatitude: Number.isFinite(lat) ? lat : null,
    reportLongitude: Number.isFinite(lng) ? lng : null,
    reportedBy: reporterName,
    reportedByRole: req.user?.role || 'citizen',
    evidenceCount: Array.isArray(req.files) ? req.files.length : 0,
    status: 'Open',
    date: new Date().toLocaleDateString()
  };
  reports.unshift(report);

  emitAlert({
    id: `CP-${Date.now()}`,
    type: `${type || 'Incident'} Complaint`,
    location: location || 'Location unavailable',
    reportedBy: reporterName,
    time: new Date().toLocaleString()
  });

  io.emit('citizen-complaint', {
    trackerId: id,
    reportId: id,
    userId: req.user?.id || 'anonymous',
    username: reporterName,
    citizenName: citizenName || reporterName,
    citizenPhone: citizenPhone || '',
    citizenDetails: citizenDetails || '',
    complaintType: type || 'Incident',
    locationText: location || '',
    description: description || '',
    timestamp: new Date().toISOString()
  });

  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    io.emit('citizen-live-location', {
      trackerId: id,
      reportId: id,
      userId: req.user?.id || 'anonymous',
      username: reporterName,
      citizenName: citizenName || reporterName,
      citizenPhone: citizenPhone || '',
      complaintType: type || 'Incident',
      locationText: location || '',
      latitude: lat,
      longitude: lng,
      timestamp: new Date().toISOString()
    });
  }

  res.json({ success: true, message: 'Report submitted', reportId: id });
});

// Alerts
app.get('/api/alerts', (req, res) => {
  res.json({ alerts });
});

// Emergency contacts
app.get('/api/contacts', (req, res) => {
  res.json({ contacts });
});

app.post('/api/contacts', (req, res) => {
  const { name, relation, phone } = req.body;
  if (name && phone) {
    contacts.push({ name, relation, phone });
    return res.json({ success: true, message: 'Contact added', contacts });
  }
  res.status(400).json({ success: false, message: 'Invalid contact data' });
});

app.delete('/api/contacts', (req, res) => {
  const { phone } = req.body;
  const idx = contacts.findIndex(c => c.phone === phone);
  if (idx !== -1) {
    contacts.splice(idx, 1);
    return res.json({ success: true, message: 'Contact removed', contacts });
  }
  res.status(404).json({ success: false, message: 'Contact not found' });
});

// Do not serve frontend here when frontend is deployed separately.
// If you want the backend to also serve the frontend, re-enable the
// static middleware and the catch-all route above.

// Start server
function startServer(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is already in use, trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    console.error('Failed to start server:', error.message);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`Crime Detection System running on http://localhost:${port}`);
    console.log(`Frontend: http://localhost:${port}`);
    console.log(`API: http://localhost:${port}/api`);
  });
}

startServer(PORT);
