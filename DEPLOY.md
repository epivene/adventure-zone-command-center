# Deploying Adventure Zone to Render

This project deploys as two Render services sharing a single PostgreSQL database:

| Service | Type | Purpose |
|---------|------|---------|
| `adventure-zone-api` | Web service (Node.js) | Express API + Clerk proxy |
| `adventure-zone-web` | Static site | Vite-built React frontend |

---

## Prerequisites

- A [Render](https://render.com) account
- An existing Render PostgreSQL database (the one already in use for dev)
- Your Clerk **production** app's publishable key and secret key
  - If you only have a development Clerk instance, create a production instance at the Clerk dashboard first
- Your Clerk user ID (`user_2abc...`) — find it in the Clerk dashboard under Users

---

## Step 1 — Deploy services from render.yaml

1. Push this repository to GitHub (or GitLab).
2. In the Render dashboard, click **New → Blueprint** and point it at your repository.
3. Render reads `render.yaml` and creates both services. It will pause and ask you to fill in the `sync: false` env vars (see Step 2 before you continue).

---

## Step 2 — Set environment variables

### API service (`adventure-zone-api`)

| Variable | Value |
|----------|-------|
| `RENDER_DATABASE_URL` | Your Render PostgreSQL **External Database URL** (found in the database's Info tab) |
| `CLERK_SECRET_KEY` | Clerk production secret key (`sk_live_...`) |
| `CLERK_PUBLISHABLE_KEY` | Clerk production publishable key (`pk_live_...`) |
| `OWNER_CLERK_USER_ID` | Your Clerk user ID (`user_2abc...`) |

### Frontend static site (`adventure-zone-web`) — build-time vars

| Variable | Value |
|----------|-------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk production publishable key (`pk_live_...`) |
| `VITE_CLERK_PROXY_URL` | `https://<adventure-zone-api URL>/api/__clerk` (fill in after Step 3) |

> **Note:** `VITE_CLERK_PROXY_URL` can only be set after the API service is live.  
> Leave it blank for now and come back in Step 3.

---

## Step 3 — Wire Clerk proxy URL

Once the API service is deployed and has a live URL (e.g. `https://adventure-zone-api.onrender.com`):

1. Go to the `adventure-zone-web` service → **Environment**.
2. Set `VITE_CLERK_PROXY_URL` to:
   ```
   https://adventure-zone-api.onrender.com/api/__clerk
   ```
3. Click **Save Changes** — Render will trigger a new build of the static site.

This routes all Clerk authentication requests through your API, enabling cookie-based auth on the Render domain without CNAME configuration.

---

## Step 4 — Smoke test

After both services show **Live** in the Render dashboard:

1. **API health check** — visit `https://adventure-zone-api.onrender.com/api/healthz`  
   → Should return `{"status":"ok"}` (or similar)
2. **Sign-in flow** — open the frontend URL, click **Sign in**, and complete authentication  
   → Should land on the Today page
3. **Data round-trip** — open Bookings or Contacts and verify data loads from the database

---

## Environment variable reference (summary)

```
# API service
NODE_ENV=production              (set automatically by render.yaml)
RENDER_DATABASE_URL=postgres://...
CLERK_SECRET_KEY=sk_live_...
CLERK_PUBLISHABLE_KEY=pk_live_...
OWNER_CLERK_USER_ID=user_...

# Frontend static site (build-time)
NODE_ENV=production              (set automatically by render.yaml)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_CLERK_PROXY_URL=https://<api-url>/api/__clerk
```

---

## Custom domain (optional)

Set up a custom domain in each service's **Settings → Custom Domains** in the Render dashboard.  
After adding the domain to the frontend, update `VITE_CLERK_PROXY_URL` if the API also moves to a custom domain, then redeploy the frontend.
