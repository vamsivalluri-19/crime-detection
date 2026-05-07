# Quick Start Guide

## Installation & Setup

### Prerequisites
- Node.js (v14+)
- MongoDB (local or Atlas)
- npm or yarn

### Step 1: Install Dependencies
```bash
cd Crime-detection-using-AI
npm install
```

### Step 2: Environment Setup
Create a `.env` file in the project root (or `backend/` folder):
```
PORT=3000
MONGO_URI=mongodb://localhost:27017/crimeai
JWT_SECRET=your_secret_key_here
```

### Step 3: Start the Application

**Development** (with auto-reload):
```bash
npm run dev
```

**Production**:
```bash
npm start
```

### Step 4: Access the Application
Open your browser and navigate to:
```
http://localhost:3000
```

## Testing Features

### 1. Registration
- Click "Register" button
- Enter credentials (email, password, role)
- Choose role: Citizen, Police Officer, or Admin
- Click "Register"

### 2. Login
- Enter registered credentials
- Select the matching role
- Click "Login"

### 3. Dashboard
- View active alerts
- Check patrol units
- Monitor real-time incidents

### 4. SOS Emergency
- Tap/Click "SOS Emergency" tab
- Your location is captured
- Emergency services notified

### 5. Report Incident
- Go to "Reports" tab
- Fill incident details
- Optionally upload evidence
- Submit report

## Project Architecture

```
Frontend ←→ Backend Server
(Browser)   (Node.js/Express)
    ↓           ↓
  HTML API    /api/* endpoints
  CSS         WebSocket
  JS          MongoDB
```

## Key Connection Points

1. **Frontend serves from**: `http://localhost:3000`
2. **API base**: `http://localhost:3000/api`
3. **WebSocket**: `http://localhost:3000` (Socket.IO)
4. **Uploads**: `http://localhost:3000/uploads/<file>`

## Stopping the Server

Press `Ctrl+C` in the terminal

## Common Issues

### Port Already in Use
The server will automatically try the next available port (3001, 3002, etc.)

### MongoDB Connection Failed
- Ensure MongoDB is running locally or configure `MONGO_URI` for Atlas
- Check `.env` file for correct MongoDB URI

### API Not Responding
- Verify backend is running: check terminal output
- Check browser console for errors (F12)
- Ensure frontend is served from same origin

## File Structure After Setup

```
Crime-detection-using-AI/
├── backend/
│   ├── server.js           ← Start here
│   ├── auth.js
│   ├── models/
│   ├── middleware/
│   ├── uploads/
│   └── .gitignore
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── package.json
├── ARCHITECTURE.md
└── QUICK_START.md
```

## Next Steps

- Review `ARCHITECTURE.md` for detailed API documentation
- Check `frontend/app.js` for frontend logic
- Explore `backend/server.js` for API endpoints
- Modify models in `backend/models/` as needed

## Support

For issues or questions, check the ARCHITECTURE.md file for detailed documentation.

---

**Status**: ✅ Frontend and Backend Successfully Separated and Connected
