# Backend Deployment Troubleshooting Guide

## Status: CORS 502/503 Errors with WebSocket Failures

The backend on Render is returning **502/503 errors** and not sending proper **CORS headers**. This indicates the backend service is either:
- **Not starting up** (immediate crash)
- **Timing out** during initialization
- **Failing** at runtime

## Diagnostic Steps

### Step 1: Check Render Logs

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Select your **crime-detection-backend** service
3. Click the **Logs** tab
4. Look for error messages during startup

**Expected startup sequence (from recent code):**
```
[STARTUP] Starting application...
[STARTUP] Attempting to start server on port 3000...
[STARTUP] Models and middleware loaded successfully
[STARTUP] MONGO_URI configured
[STARTUP] Node environment: not set
[STARTUP] PORT: 3000
[STARTUP] MongoDB connected successfully (or warning if unavailable)
[STARTUP] Auth routes loaded successfully
[STARTUP SUCCESS] Crime Detection System running...
```

### Step 2: Test Locally

Run the startup diagnostic test locally:
```bash
npm run test-backend
```

This will verify:
- All dependencies are installed
- All models and middleware load
- Environment variables are set
- MongoDB connection (if available)

Expected output: ✓ Backend is ready for deployment!

### Step 3: Verify Environment Variables on Render

1. Go to Render dashboard → **crime-detection-backend** service
2. Click **Settings**
3. Scroll to **Environment** section
4. Verify these variables are set:

| Variable | Required | Status |
|----------|----------|--------|
| `MONGO_URI` | ✓ Yes | Check if correct |
| `JWT_SECRET` | ✓ Yes | Check if present |
| `NODE_ENV` | Optional | Set to `production` (recommended) |
| `PORT` | Optional | Should auto-detect from Render |

**⚠️ Common Issue:** If `MONGO_URI` contains invalid credentials or expired certificates, the backend may crash during startup.

### Step 4: Check MongoDB Connection

The diagnostic test showed an SSL/TLS error:
```
SSL alert number 80 (internal_error)
```

This means the MongoDB Atlas connection string may have:
- **Expired certificate** - Contact MongoDB support
- **Wrong credentials** - Verify MONGO_URI in Render environment
- **Network timeout** - Whitelist Render's IP on MongoDB Atlas

**How to fix MongoDB on Atlas:**
1. Go to [MongoDB Atlas](https://cloud.mongodb.com)
2. Navigate to **Cluster** → **Security** → **Network Access**
3. Add Render's IP: `0.0.0.0/0` (allows all IPs, or find Render's specific IP)
4. Verify connection string has correct username and password

## Common Issues & Solutions

### Issue: CORS "No 'Access-Control-Allow-Origin' header"
**Cause:** Backend not responding at all (502/503 error)  
**Solution:** Fix the backend startup issue first (see below)

### Issue: WebSocket 502/503 Error
**Cause:** Backend not running or not accepting connections  
**Solution:** 
1. Check Render logs for startup errors
2. Verify MONGO_URI and JWT_SECRET are set
3. Ensure MongoDB is accessible from Render

### Issue: "MongoDB connection timeout"
**Cause:** MongoDB Atlas network access not configured  
**Solution:**
1. Add Render IP to MongoDB whitelist
2. Or use `0.0.0.0/0` to allow all IPs
3. Verify credentials in connection string

### Issue: Port already in use (EADDRINUSE)
**Cause:** Port 3000 already in use  
**Solution:** The code automatically tries the next port. Check Render logs for which port the service is on.

### Issue: "Cannot find module" or "Module not found"
**Cause:** npm dependencies not installed  
**Solution:**
1. Verify `package.json` is in repo root
2. Check `npm install` ran during Render build
3. Check Render **Build** tab for npm install errors

## What Should Happen After Fix

1. **Backend starts successfully** - Logs show [STARTUP SUCCESS]
2. **Health endpoint responds** - GET `/api/health` returns:
   ```json
   {
     "status": "ok",
     "timestamp": "2026-05-13T...",
     "mongoConnected": true/false
   }
   ```
3. **CORS headers present** - Response includes `Access-Control-Allow-Origin: *`
4. **WebSocket connects** - Browser console shows successful Socket.IO connection
5. **API requests work** - Fetch calls to `/api/profile`, `/api/reports` etc. succeed

## Manual Restart on Render

If logs look OK but service is still failing:
1. Go to Render dashboard
2. Select **crime-detection-backend**
3. Click **Manual Deploy** or **Clear Cache & Redeploy**
4. Watch logs for startup messages

## Testing Health Endpoint

Once backend is fixed, test the health endpoint:

```bash
# From terminal
curl https://crime-detection-ii5r.onrender.com/api/health

# From browser
# Navigate to: https://crime-detection-ii5r.onrender.com/api/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-05-13T10:30:45.123Z",
  "mongoConnected": true
}
```

## Frontend Testing

After backend is running, the frontend should:
1. Successfully fetch `/api/profile`
2. Successfully fetch `/api/reports`
3. Successfully connect via WebSocket (optional, can fall back to polling)

If still getting CORS errors:
1. Browser → DevTools → Network tab
2. Look for the failed request
3. Check Response headers for `Access-Control-Allow-Origin`
4. If missing, backend is not responding properly

## Next Steps

1. ✅ Run `npm run test-backend` locally
2. ✅ Review Render logs for errors
3. ✅ Verify environment variables on Render
4. ✅ Check MongoDB Atlas network access
5. ✅ Manual deploy/restart on Render
6. ✅ Test `/api/health` endpoint
7. ✅ Check browser Network tab for CORS headers
8. ✅ Monitor Render logs during testing

---

**Questions?** Check the logs at every step. The error message in logs will tell you exactly what's wrong.
