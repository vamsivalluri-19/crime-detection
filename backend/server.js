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
const corsOptions = {
  origin: true,
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

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'false');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
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
  if (mongoose.connection.readyState === 1) {
    try {
      const logs = await AuditLog.find().populate('user', 'username').sort({ createdAt: -1 }).limit(100);
      return res.json({ logs });
    } catch (error) {
      // Fall back to in-memory audit entries when the database is not available.
    }
  }

  res.json({ logs: auditEntries });
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

let evidenceVault = [];

let adminCameras = [
  { id: 'CAM-001', location: 'Bandra Station Platform 2', status: 'Online', resolution: '1080p', mode: 'Weapon Detection', lastPing: 'Just now' },
  { id: 'CAM-002', location: 'Marine Drive Junction', status: 'Online', resolution: '4K', mode: 'Crowd Analysis', lastPing: '2 minutes ago' },
  { id: 'CAM-003', location: 'Gateway of India', status: 'Maintenance', resolution: '1080p', mode: 'Violence Detection', lastPing: '10 minutes ago' }
];

let modelConfig = {
  weaponThreshold: 85,
  violenceThreshold: 80,
  suspiciousThreshold: 70,
  vehicleThreshold: 90,
  activeModel: 'YOLOv8 (Current)',
  frameRate: '15 FPS - Balanced',
  alertMode: 'Filtered - Above threshold only',
  autoDispatch: true
};

let patrolUnitsStore = patrolUnits.map((unit) => ({ ...unit }));
let auditEntries = [];

function recordAudit(action, details, user = 'system') {
  auditEntries.unshift({
    id: `AUD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    user,
    action,
    details,
    ipAddress: 'render-runtime',
    date: new Date().toLocaleString()
  });

  if (auditEntries.length > 100) {
    auditEntries.length = 100;
  }
}

// SOS alert (with WebSocket broadcast)
app.post('/api/sos', async (req, res) => {
  const { latitude, longitude, username, citizenName, citizenPhone } = req.body;
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
  } else {
    sosEvent.username = username || undefined;
    sosEvent.citizenName = citizenName || username || undefined;
    sosEvent.citizenPhone = citizenPhone || undefined;
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
  res.json({ patrolUnits: patrolUnitsStore });
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

app.patch('/api/reports/:id/status', (req, res) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const reportId = String(req.params.id || '').trim();
  const status = String(req.body.status || '').trim();
  const notes = String(req.body.notes || '').trim();
  if (!reportId || !status) {
    return res.status(400).json({ success: false, message: 'Report id and status are required' });
  }

  const report = reports.find((item) => item.id === reportId);
  if (!report) {
    return res.status(404).json({ success: false, message: 'Report not found' });
  }

  report.status = status;
  report.notes = notes;
  report.updatedAt = new Date().toISOString();
  recordAudit('report-status', `${reportId} -> ${status}`, req.user.username);

  res.json({ success: true, report });
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
  recordAudit('report-create', `${id} ${type || 'Incident'} at ${location || 'Location unavailable'}`, reporterName);

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

app.get('/api/evidence', (req, res) => {
  res.json({ evidence: evidenceVault });
});

app.post('/api/evidence/upload', upload.array('evidence'), (req, res) => {
  const caseId = String(req.body.caseId || req.body.evCaseId || '').trim();
  const evidenceType = String(req.body.evidenceType || req.body.evUploadType || req.body.type || 'other').trim() || 'other';
  const description = String(req.body.description || req.body.evUploadDesc || '').trim();
  const uploader = req.user?.username || String(req.body.uploader || req.body.username || 'Citizen').trim() || 'Citizen';

  const files = Array.isArray(req.files) ? req.files : [];
  const uploaded = files.map((file) => ({
    id: `EVD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    caseId: caseId || 'Unassigned',
    evidenceType,
    description,
    fileName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    filePath: '/uploads/' + file.filename,
    status: 'Verified',
    uploader,
    createdAt: new Date().toISOString()
  }));

  if (!uploaded.length) {
    return res.status(400).json({ success: false, message: 'No evidence files uploaded' });
  }

  evidenceVault.unshift(...uploaded);
  recordAudit('evidence-upload', `${uploaded.length} file(s) for ${caseId || 'Unassigned'}`, uploader);

  res.json({ success: true, evidence: uploaded });
});

app.delete('/api/evidence/:id', (req, res) => {
  const evidenceId = String(req.params.id || '').trim();
  const index = evidenceVault.findIndex((item) => item.id === evidenceId);
  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Evidence not found' });
  }

  evidenceVault.splice(index, 1);
  res.json({ success: true });
});

app.get('/api/admin/cameras', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
  res.json({ cameras: adminCameras });
});

app.post('/api/admin/cameras', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const camera = {
    id: `CAM-${String(adminCameras.length + 1).padStart(3, '0')}`,
    location: String(req.body.location || 'Unknown location').trim(),
    status: String(req.body.status || 'Online').trim(),
    resolution: String(req.body.resolution || '1080p').trim(),
    mode: String(req.body.mode || 'General Monitoring').trim(),
    lastPing: 'Just now'
  };

  adminCameras.unshift(camera);
  recordAudit('camera-add', camera.location, req.user.username);
  res.json({ success: true, camera });
});

app.patch('/api/admin/cameras/:id', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const camera = adminCameras.find((item) => item.id === req.params.id);
  if (!camera) return res.status(404).json({ success: false, message: 'Camera not found' });

  camera.location = String(req.body.location || camera.location).trim();
  camera.status = String(req.body.status || camera.status).trim();
  camera.resolution = String(req.body.resolution || camera.resolution).trim();
  camera.mode = String(req.body.mode || camera.mode).trim();
  camera.lastPing = 'Just now';
  recordAudit('camera-update', camera.id, req.user.username);
  res.json({ success: true, camera });
});

app.delete('/api/admin/cameras/:id', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  const index = adminCameras.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ success: false, message: 'Camera not found' });

  const removed = adminCameras.splice(index, 1)[0];
  recordAudit('camera-remove', removed.id, req.user.username);
  res.json({ success: true });
});

app.get('/api/admin/model-config', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
  res.json({ modelConfig });
});

app.post('/api/admin/model-config', (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });

  modelConfig = {
    ...modelConfig,
    weaponThreshold: Number(req.body.weaponThreshold || modelConfig.weaponThreshold),
    violenceThreshold: Number(req.body.violenceThreshold || modelConfig.violenceThreshold),
    suspiciousThreshold: Number(req.body.suspiciousThreshold || modelConfig.suspiciousThreshold),
    vehicleThreshold: Number(req.body.vehicleThreshold || modelConfig.vehicleThreshold),
    activeModel: String(req.body.activeModel || modelConfig.activeModel),
    frameRate: String(req.body.frameRate || modelConfig.frameRate),
    alertMode: String(req.body.alertMode || modelConfig.alertMode),
    autoDispatch: Boolean(req.body.autoDispatch)
  };

  recordAudit('model-config', 'Model configuration updated', req.user.username);
  res.json({ success: true, modelConfig });
});

app.get('/api/dashboard/summary', (req, res) => {
  res.json({
    alerts,
    reports,
    contacts,
    patrolUnits: patrolUnitsStore,
    evidence: evidenceVault,
    cameras: adminCameras,
    modelConfig
  });
});

app.post('/api/patrol-units', (req, res) => {
  const unit = {
    id: String(req.body.id || `P-${Math.floor(100 + Math.random() * 900)}`),
    status: String(req.body.status || 'Active'),
    location: String(req.body.location || 'Unknown location'),
    officers: Number(req.body.officers || 2),
    responseTime: String(req.body.responseTime || '4.0 min')
  };

  patrolUnitsStore.unshift(unit);
  res.json({ success: true, unit });
});

app.patch('/api/patrol-units/:id', (req, res) => {
  const unit = patrolUnitsStore.find((item) => item.id === req.params.id);
  if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });

  unit.status = String(req.body.status || unit.status);
  unit.location = String(req.body.location || unit.location);
  unit.officers = Number(req.body.officers || unit.officers);
  unit.responseTime = String(req.body.responseTime || unit.responseTime);
  res.json({ success: true, unit });
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
