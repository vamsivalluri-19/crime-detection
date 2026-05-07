# Crime Detection System - Architecture Guide

## Project Structure (Separated Frontend & Backend)

```
Crime-detection-using-AI/
├── backend/                    # Express.js backend server
│   ├── server.js              # Main server file (entry point)
│   ├── auth.js                # Authentication routes & middleware
│   ├── models/                # MongoDB schemas
│   │   ├── User.js
│   │   ├── Profile.js
│   │   ├── IncidentComment.js
│   │   └── AuditLog.js
│   ├── middleware/            # Express middleware
│   │   └── auditLogger.js
│   └── uploads/               # File uploads directory
├── frontend/                   # Frontend static files
│   ├── index.html             # Main HTML file
│   ├── app.js                 # Frontend JavaScript (client-side logic)
│   └── style.css              # Frontend styling
├── package.json               # Root dependencies
└── README.md
```

## Key Changes

### 1. **Backend Organization**
- **Main Entry Point**: `backend/server.js`
- **Updated `package.json`**: `"main": "backend/server.js"`
- **All backend logic** (models, middleware, routes) now in `backend/` folder
- **Static Frontend Serving**: Backend serves frontend from `../frontend` directory

### 2. **Frontend Organization**
- All frontend files remain in `frontend/` folder
- **Updated paths**:
  - HTML stylesheet: `style.css` (was `frontend/style.css`)
  - JavaScript app: `app.js` (was `frontend/app.js`)
- Frontend automatically detects backend API via `resolveApiBase()` function

### 3. **One-to-One Connection (Same Process)**
The backend now:
1. Serves frontend static files (HTML, CSS, JS)
2. Provides REST API endpoints at `/api/*`
3. Manages WebSocket connections for real-time events
4. All running on the same port (default: 3000)

**Request Flow**:
```
User Browser (localhost:3000)
    ↓
Frontend HTML/CSS/JS
    ├─→ REST API calls to `/api/*` (backend routes)
    └─→ WebSocket connection for real-time updates
```

## Running the Application

### Development
```bash
npm install
npm run dev
```

### Production
```bash
npm start
```

**Access**: `http://localhost:3000`

## API Endpoints

All API endpoints are prefixed with `/api`:
- `/api/register` - User registration
- `/api/auth` - User login
- `/api/profile` - User profile management
- `/api/sos` - SOS emergency trigger
- `/api/report` - Incident reporting
- `/api/reports` - Get all reports
- `/api/incidents/search` - Search incidents
- `/api/alerts` - Get active alerts
- `/api/ai-detections` - AI detection feed
- `/api/analytics` - Crime analytics
- `/api/audit-logs` - Admin audit logs

## WebSocket Events

Real-time communication via Socket.IO:
- `citizen-speech` - Citizen voice updates
- `citizen-complaint` - Citizen complaints
- `citizen-live-location` - Live location tracking
- `citizen-sos` - SOS emergencies
- `new-alert` - General alerts

## Database Models

### User
```javascript
{
  username: String (unique),
  password: String (hashed),
  role: 'admin' | 'officer' | 'citizen',
  createdAt: Date
}
```

### Profile
```javascript
{
  user: ObjectId (ref: User),
  name: String,
  email: String,
  phone: String,
  avatar: String (file path),
  notificationPreferences: {
    emailIncidents: Boolean,
    smsEmergencies: Boolean,
    pushNotifications: Boolean
  },
  lastUpdated: Date
}
```

### IncidentComment
```javascript
{
  incidentId: String,
  user: ObjectId (ref: User),
  comment: String,
  status: String,
  createdAt: Date
}
```

### AuditLog
```javascript
{
  user: ObjectId (ref: User),
  action: String,
  details: String,
  createdAt: Date
}
```

## Configuration

### Environment Variables (.env)
```
PORT=3000
MONGO_URI=mongodb://localhost:27017/crimeai
JWT_SECRET=your_jwt_secret
```

### Frontend API Base URL Detection
The frontend automatically detects the API base URL:
1. Checks `window.location.origin` (same origin)
2. Falls back to localhost:3000-3005 ports
3. Can be overridden via localStorage: `crimeAiApiBase`

## Authentication Flow

1. **Registration**: POST `/api/register` with username, password, role
2. **Login**: POST `/api/auth` with username, password → Returns JWT token
3. **Token Storage**: Stored in localStorage as `crimeAiToken`
4. **Protected Routes**: Include `Authorization: Bearer <token>` header
5. **WebSocket Auth**: Pass token in socket.io auth options

## File Upload

- Endpoint: `POST /api/profile` (multipart/form-data)
- Files stored in `backend/uploads/`
- Accessible via `/uploads/<filename>` URL

## Development Commands

```bash
# Install dependencies
npm install

# Start development server (with nodemon)
npm run dev

# Start production server
npm start
```

## Deployment Notes

- Backend serves both frontend and API from single port
- Works with Vercel, Render, or any Node.js hosting
- Frontend is static (no separate build step needed)
- MongoDB should be hosted on Atlas or similar service
- Uploads folder needs persistent storage for production

## Troubleshooting

### API Connection Issues
1. Verify backend is running: `npm start`
2. Check console for API base URL resolution
3. Ensure CORS is enabled (it is by default)
4. Test API manually: `curl http://localhost:3000/api/alerts`

### MongoDB Connection
- Local: `mongodb://localhost:27017/crimeai`
- Atlas: Use `MONGO_URI` environment variable
- Check connection status in server startup log

### WebSocket Issues
- Verify Socket.IO is loaded from `/socket.io/socket.io.js`
- Check browser console for connection errors
- Ensure token is being sent in socket auth

## Features by Role

### Citizen
- Dashboard with alerts
- SOS emergency trigger
- Report incidents
- View crime analytics
- Manage profile

### Police Officer
- All citizen features
- AI detection monitoring
- Live citizen tracking
- Evidence vault
- Advanced analytics

### Admin
- All officer features
- Audit log viewing
- System configuration
- Full incident management

---

**Last Updated**: May 7, 2026
