// Simple Express backend for AI Crime Detection System

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');
const http = require('http');
const socketio = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: '*' } });
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

const Profile = require('./models/Profile');
const IncidentComment = require('./models/IncidentComment');
const AuditLog = require('./models/AuditLog');
const auditLogger = require('./middleware/auditLogger');

mongoose.connect('mongodb://localhost:27017/crimeai');
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname)));

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
require('./auth')(app);

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
  let update = { name: req.body.name };
  if (req.file) update.avatar = '/uploads/' + req.file.filename;
  const profile = await Profile.findOneAndUpdate(
    { user: req.user.id },
    { $set: update },
    { upsert: true, new: true }
  );
  res.json({ profile });
});
app.post('/api/profile/password', async (req, res) => {
  // Change password logic (requires User model, omitted for brevity)
  res.json({ success: true });
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

// Login
app.post('/api/login', (req, res) => {
  const { badgeNumber, username, password } = req.body;
  if ((badgeNumber || username) && password) {
    return res.json({ success: true, message: 'Login successful!' });
  }
  res.status(400).json({ success: false, message: 'Invalid credentials' });
});


// SOS alert (with WebSocket broadcast)
app.post('/api/sos', (req, res) => {
  const { latitude, longitude } = req.body;
  const id = 'SOS-' + (Math.floor(Math.random() * 1000) + 100);
  const alert = {
    id,
    type: 'SOS Emergency',
    location: `Lat: ${latitude}, Lng: ${longitude}`,
    time: 'Just now'
  };
  alerts.unshift(alert);
  emitAlert(alert);
  res.json({ success: true, message: 'SOS alert received', data: alert });
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
  const { type, location, description } = req.body;
  const id = 'INC-' + Math.floor(Math.random() * 10000);
  const report = { id, type, location, status: 'Open', date: new Date().toLocaleDateString() };
  reports.unshift(report);
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

// Start server
server.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
