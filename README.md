# Crime Detection Using AI

AI Crime Detection and Emergency Response System with:
- Frontend: Vercel-hosted static app
- Backend: Render-hosted Node.js/Express API + Socket.IO
- Database: MongoDB Atlas (with in-memory fallback behavior in runtime)

## Live URLs
- Frontend (Vercel): https://crime-detection-6vot-2tqhhfu71-vamsivalluri-19s-projects.vercel.app/
- Backend (Render): https://crime-detection-ii5r.onrender.com
- Backend Health Check: https://crime-detection-ii5r.onrender.com/api/health

## Local Development
1. Install dependencies
```bash
npm install
```
2. Start backend
```bash
npm start
```
3. Open frontend (served from Vercel in production, local files for development)

## Environment Variables
Create/update `.env` in project root:

```env
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
PORT=3000
API_BASE=https://crime-detection-ii5r.onrender.com
```

## Deploy Notes
- Vercel build command: `npm run vercel-build`
- Vercel output directory: `public`
- Render start command: `npm start`
- Render health check path: `/api/health`

## Common Issue: Vercel `DEPLOYMENT_NOT_FOUND`
If you get:
- `404: NOT_FOUND`
- `Code: DEPLOYMENT_NOT_FOUND`

It means the specific Vercel deployment URL is no longer active (preview URLs can be replaced/removed).

Fix:
1. Open Vercel dashboard and copy the latest deployment URL.
2. Prefer the stable Production domain instead of old preview links.
3. Redeploy from latest `main` commit if needed.
4. Confirm frontend can reach backend at:
   - `https://crime-detection-ii5r.onrender.com/api/health`

## Troubleshooting CORS/Failed Fetch
When browser shows CORS + `Failed to fetch` for many endpoints, backend is often down or restarting.

Check in order:
1. Render logs for current deploy status.
2. Render health endpoint (`/api/health`).
3. Vercel env/API target URL.
4. Browser hard refresh after deploy.

## Repository
- GitHub: https://github.com/vamsivalluri-19/crime-detection