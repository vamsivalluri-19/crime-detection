Deploy frontend on Vercel (static) and backend on Render (Node service)

Overview
- Frontend: static site served by Vercel (index.html, style.css, assets).
- Backend: full Node/Express server (server.js) deployed as a Web Service on Render.
- Database: MongoDB Atlas (free tier) — set `MONGO_URI` on Render.
- File uploads: recommended to use Cloudinary or S3 for persistence; Render dynos have ephemeral storage.

1) Create MongoDB Atlas (free)
- Sign up at https://www.mongodb.com/cloud/atlas and create a Free Tier cluster.
- Create a database user (username/password) and whitelist your IP if testing locally.
- Get the connection string and replace `<PASSWORD>`; copy the full URI for `MONGO_URI`.

2) Optional: Create Cloudinary account for uploads
- Sign up at https://cloudinary.com and get your `CLOUDINARY_URL`.
- We'll use direct uploads from the client (preferred) or server-side upload using Cloudinary SDK.

3) Deploy backend to Render
- Create a Render account and connect your GitHub repository.
- Create a new **Web Service** (not static site):
  - Name: choose any
  - Branch: main (or your branch)
  - Build Command: leave blank
  - Start Command: `node server.js`
  - Instance Type: free (if available) or as needed
- In Render dashboard, under **Environment > Environment Variables**, add:
  - `MONGO_URI` = your MongoDB connection string
  - `JWT_SECRET` = a secure secret
  - `CLOUDINARY_URL` = if using Cloudinary
- Deploy: Render will build and start your service. Note the service URL (e.g., `https://your-app.onrender.com`).

4) Configure the frontend API base
- The repo includes `frontend/env.js` as the runtime configuration file loaded before `app.js`.
- Replace the placeholder URL in `frontend/env.js` with your actual Render service URL, for example:

  window.__API_BASE__ = 'https://your-app.onrender.com';

5) Deploy frontend to Vercel
- Install Vercel CLI and login:
```powershell
npm i -g vercel
vercel login
```
- From the repo root, run:
```powershell
vercel
# follow prompts and link the project
vercel --prod
```
- Alternatively, use the Vercel web UI and import your GitHub repo.
- The frontend should call the Render URL directly for API requests and Socket.IO.

6) Environment & CORS
- `server.js` already enables `cors()` for all origins. Confirm CORS if you restrict origins.

7) Replace local uploads
- Because Render's disk is ephemeral, configure uploads to go to Cloudinary/S3:
  - Client-side: upload directly to Cloudinary unsigned presets or S3 pre-signed URLs.
  - Server-side: use the Cloudinary SDK in `server.js` and save returned URL to your DB.

8) Testing
- From local, you can test backend directly:
```powershell
curl -X GET https://your-app.onrender.com/api/alerts
```
- After Vercel deploy, open the frontend URL and verify features that call `/api` work.

9) Notes & troubleshooting
- WebSockets: Render supports long-running sockets; ensure your plan supports it. Keep `socket.io` as-is on `server.js`.
- Logs: use Render's logs and Vercel's logs to debug issues.
- If you prefer serverless backend, host it on Vercel and replace socket.io with a push service.

10) Quick checklist
- [ ] Create MongoDB Atlas and get `MONGO_URI`
- [ ] Deploy backend to Render and set env vars (`MONGO_URI`, `JWT_SECRET`)
- [ ] Replace the placeholder URL in `frontend/env.js` with your Render URL
- [ ] Deploy frontend to Vercel
- [ ] Test end-to-end

If you want, I can:
- A) Replace `vercel.json` placeholder automatically after you give me the Render URL, or
- B) Create a small Cloudinary example in `client-upload-example.js` and a `server/cloudinary.js` helper to store uploads.
