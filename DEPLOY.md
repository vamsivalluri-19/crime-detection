# Deployment Guide — GitHub, Render (backend), Vercel (frontend)

This guide explains how to push the repository to GitHub, deploy the backend on Render, and deploy the frontend on Vercel. The codebase is prepared so the backend exposes only API and sockets, while the frontend is hosted separately on Vercel.

---

## 1) Push repository to GitHub

If you haven't created a remote repository yet, create one on GitHub and copy the remote URL.

Run locally:

```bash
cd path/to/Crime-detection-using-AI
git init
git add .
git commit -m "chore: separate frontend/backend and prepare for deployment"
# replace <REMOTE-URL> with your GitHub repo URL
git remote add origin <REMOTE-URL>
git branch -M main
git push -u origin main
```

If your repo already has commits, just add the remote and push.

---

## 2) Deploy Backend on Render

1. Sign in to https://dashboard.render.com and create a new **Web Service**.
2. Connect your GitHub repo and select the `main` branch (or the branch you pushed).
3. Use the `Node` environment and leave the build and start commands as default, or set explicitly:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add environment variables (Render dashboard > Environment):
   - `MONGO_URI` — your MongoDB connection string
   - `JWT_SECRET` — a secret for signing JWTs
   - (Optional) `PORT` — Render will supply one; you can omit
5. Deploy. Once deployed, note the service URL, e.g. `https://my-backend.onrender.com`

Important: Socket.IO requires a live WebSocket connection to the backend. When using a remote frontend (Vercel), ensure the frontend connects directly to this Render URL for socket connections.

---

## 3) Deploy Frontend on Vercel

1. Sign in to https://vercel.com and create a new project. Choose "Import from Git" and select the same repo.
2. Keep the repo root as the project root.
3. Set the Vercel build settings to use the generated static output:
   - Build Command: `npm run vercel-build`
   - Output Directory: `public`
   - Framework Preset: `Other`
4. Add a Vercel environment variable named `API_BASE` with your Render backend URL as the value, for example `https://my-backend.onrender.com`.
5. Deploy the project. The build step writes `public/env.js` from `API_BASE`, and the browser loads that file before `app.js`.
6. Do not use `window.__API_BASE__` as the Vercel environment variable key. Vercel only accepts simple names like `API_BASE`.
7. Do not rely on a Vercel `/api` proxy for Socket.IO. The frontend should connect directly to the Render service URL for both API calls and WebSockets.

If you prefer to keep the frontend API base out of the repo, replace `frontend/env.js` with a deploy-time generated file that sets `window.__API_BASE__` to your Render URL.

---

## 4) Finalize config and test

- Ensure `API_BASE` is set in Vercel to your actual Render backend host.
- On Render, verify backend `/api/alerts` returns data.
- On Vercel, open the deployed frontend URL and confirm it can call the API and connect to sockets.

Test socket manually in browser console:

```js
// from frontend console; replace with your Render URL
const socket = io('https://my-backend.onrender.com', { transports: ['websocket'] });
socket.on('connect', () => console.log('socket connected', socket.id));
```

---

## Notes & Troubleshooting
- Do NOT commit secret env values to GitHub. Use Render/Vercel dashboards to store secrets.
- If you rely on Vercel proxying `/api` to Render, socket.io may not work via that proxy; prefer direct connections to Render for sockets.
- If CORS errors appear, ensure the backend has `cors()` enabled (it does by default in this repo).

---

If you want, I can:
- Prepare `frontend/env.js` with a placeholder and add a short script to `index.html` to load it if present.
- Create a PR-ready commit message and show exact `git` commands to push to GitHub.

Tell me which parts you'd like me to do next (prepare `env.js`, update `vercel.json` with your Render service, or produce a PR).