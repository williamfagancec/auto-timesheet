# Beta Deployment Guide

Complete step-by-step instructions for deploying Auto Timesheet to Railway (API) and Vercel (Frontend) for 8 beta testers.

**Estimated Time:** 2-3 hours
**Cost:** ~$5/month (Railway Hobby Plan)

---

## Prerequisites

Before you begin, ensure you have:
- [ ] GitHub repository with latest code pushed
- [ ] Neon PostgreSQL database URL (already configured)
- [ ] Upstash Redis URL (already configured)
- [ ] Google Cloud Console access (organization account)
- [ ] Railway account (https://railway.app)
- [ ] Vercel account (https://vercel.com)

---

## Phase 1: Generate Security Keys

You'll need two cryptographic keys. Run these commands in your terminal:

```bash
# Generate SESSION_SECRET (for Lucia Auth)
openssl rand -hex 32
# Example output: a1b2c3d4e5f6...64 characters

# Generate ENCRYPTION_KEY (for OAuth token encryption)
openssl rand -hex 32
# Example output: f6e5d4c3b2a1...64 characters
```

**Save these values securely - you'll need them for both Railway and as backup.**

---

## Phase 2: Deploy Backend to Railway

### Step 1: Create Railway Project

1. Go to https://railway.app/dashboard
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Authorize Railway to access your GitHub (if not already done)
5. Select `auto-timesheet` repository
6. Click **"Deploy Now"**

### Step 2: Configure Service Settings

1. Click on the deployed service
2. Go to **Settings** tab
3. Under **Source**:
   - Root Directory: `/` (leave blank or set to root)
   - Watch Paths: Leave default
4. Under **Build**:
   - Builder: `Dockerfile`
   - Dockerfile Path: `apps/api/Dockerfile`
5. Click **"Save"** (if applicable)

### Step 3: Set Environment Variables

1. Click on the service
2. Go to **Variables** tab
3. Click **"Raw Editor"** (easier for bulk entry)
4. Paste the following (replace placeholders):

```env
DATABASE_URL=postgresql://user:password@ep-xxx-pooler.neon.tech/timetracker?sslmode=require&connection_limit=20&pool_timeout=10
REDIS_URL=rediss://default:password@region-redis.upstash.io:6379
SESSION_SECRET=<your-64-char-hex-from-step-1>
ENCRYPTION_KEY=<your-64-char-hex-from-step-1>
GOOGLE_CLIENT_ID=873476612967-xxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret-here
GOOGLE_REDIRECT_URI=https://PLACEHOLDER.railway.app/auth/google/callback
FRONTEND_URL=https://PLACEHOLDER.vercel.app
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
```

**Note:** Keep GOOGLE_REDIRECT_URI and FRONTEND_URL as placeholders for now. We'll update them after deployment.

5. Click **"Save Changes"**

### Step 4: Deploy and Get URL

1. Go to **Deployments** tab
2. Railway will auto-deploy after saving variables
3. Wait for deployment to complete (2-5 minutes)
4. Once deployed, go to **Settings** → **Networking**
5. Click **"Generate Domain"**
6. Copy your Railway URL (e.g., `auto-timesheet-api-production.up.railway.app`)

### Step 5: Update Google Redirect URI

1. Go back to **Variables** tab
2. Update `GOOGLE_REDIRECT_URI`:
   ```
   GOOGLE_REDIRECT_URI=https://YOUR-ACTUAL-RAILWAY-URL.railway.app/auth/google/callback
   ```
3. Click **"Save Changes"**
4. Railway will redeploy automatically

### Step 6: Verify Deployment

```bash
# Test health endpoint (replace with your URL)
curl https://your-app.railway.app/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-16T10:00:00.000Z",
  "checks": {
    "database": "ok",
    "redis": "ok"
  },
  "version": "0.1.0",
  "environment": "production"
}
```

If `database` or `redis` shows "error", check your DATABASE_URL and REDIS_URL values.

---

## Phase 3: Deploy Frontend to Vercel

### Step 1: Create Vercel Project

1. Go to https://vercel.com/dashboard
2. Click **"Add New..."** → **"Project"**
3. Click **"Import"** next to your `auto-timesheet` repository
4. If not visible, click **"Adjust GitHub App Permissions"**

### Step 2: Configure Project Settings

1. **Project Name:** `auto-timesheet` (or your preferred name)
2. **Framework Preset:** Should auto-detect as `Vite`
3. **Root Directory:** Click **"Edit"** and set to `/` (root)
4. **Build and Output Settings:**
   - Build Command: `pnpm build:web` (should be auto-detected from vercel.json)
   - Output Directory: `apps/web/dist` (should be auto-detected)
   - Install Command: `pnpm install`

### Step 3: Set Environment Variables

1. Expand **"Environment Variables"** section
2. Add ONE variable:

| Name | Value |
|------|-------|
| `VITE_API_URL` | `https://YOUR-RAILWAY-URL.railway.app` |

**Important:** Use the Railway URL from Phase 2, Step 4 (without trailing slash)

3. Click **"Deploy"**

### Step 4: Wait for Deployment

1. Vercel will build and deploy (2-3 minutes)
2. Once complete, note your Vercel URL (e.g., `auto-timesheet.vercel.app`)
3. Click **"Visit"** to see your frontend (it won't work yet - we need to update Railway)

---

## Phase 4: Update Railway with Vercel URL

### Step 1: Update FRONTEND_URL

1. Go back to Railway dashboard
2. Click on your service → **Variables**
3. Update `FRONTEND_URL`:
   ```
   FRONTEND_URL=https://YOUR-VERCEL-URL.vercel.app
   ```
4. Click **"Save Changes"**
5. Wait for redeployment (1-2 minutes)

---

## Phase 5: Configure Google OAuth

### Step 1: Set OAuth Consent Screen to Internal

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your project (where OAuth credentials are)
3. Navigate to **APIs & Services** → **OAuth consent screen**
4. Under "User Type", click **"Edit App"** (or check current setting)
5. Ensure it's set to **"Internal"**
   - This restricts login to your @customerexperience domain only
   - No verification required for internal apps
6. Click **"Save and Continue"** through remaining steps

### Step 2: Add Production Redirect URI

1. Navigate to **APIs & Services** → **Credentials**
2. Click on your OAuth 2.0 Client ID (the one matching your GOOGLE_CLIENT_ID)
3. Under **"Authorized redirect URIs"**, click **"Add URI"**
4. Add your Railway callback URL:
   ```
   https://YOUR-RAILWAY-URL.railway.app/auth/google/callback
   ```
5. Click **"Save"**

**Important:** The URI must match EXACTLY what you set in Railway's GOOGLE_REDIRECT_URI

### Step 3: Verify Scopes

1. Navigate to **APIs & Services** → **OAuth consent screen**
2. Click **"Edit App"**
3. Go to **"Scopes"** section
4. Ensure these scopes are added:
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/calendar.readonly`
5. If missing, click **"Add or Remove Scopes"** and add them

---

## Phase 6: End-to-End Testing

### Test 1: Health Check
```bash
curl https://your-railway-url.railway.app/health
# Should return status: "ok" with all checks passing
```

### Test 2: Frontend Loads
1. Visit `https://your-vercel-url.vercel.app`
2. Should see the login page without errors
3. Open browser console (F12) - no CORS errors should appear

### Test 3: Email/Password Signup
1. Click **"Sign up"** link
2. Enter test email and password (8+ characters)
3. Click **"Sign up"**
4. Should redirect to `/events` page
5. Check browser cookies (DevTools → Application → Cookies)
   - Should see `auth_session` cookie
   - Secure: ✓
   - SameSite: None

### Test 4: Google OAuth Flow
1. Log out (if logged in)
2. Go to login page
3. Click **"Continue with Google"**
4. Should redirect to Google sign-in (your @customerexperience domain)
5. Complete sign-in
6. Should redirect back to `/events` page
7. Check that calendar connection is created

### Test 5: Calendar Sync
1. After Google OAuth login, go to Events page
2. Click **"Sync Calendar"** button
3. Should see events populate (if you have calendar events)
4. Check Railway logs for any errors

---

## Phase 7: Invite Beta Testers

### Prepare Information for Testers

Send each beta tester:

1. **App URL:** `https://your-vercel-url.vercel.app`
2. **Login Method:** "Continue with Google" (using @customerexperience email)
3. **RM API Token:** (You'll provision these per-user from RM admin console)

### Monitor Initial Usage

1. **Railway Logs:** Check for errors during first logins
   - Go to Railway → Deployments → View Logs
2. **Upstash Usage:** Monitor Redis command count
   - Go to Upstash dashboard → Usage
   - Free tier: 10,000 commands/day
   - With 8 users: expect 5,000-8,000 commands/day
3. **Neon Database:** Check connection count
   - Go to Neon dashboard → Monitoring
   - Free tier: 100 concurrent connections

---

## Troubleshooting

### Common Issues

**1. "Not allowed by CORS" error**
- Check FRONTEND_URL in Railway matches your Vercel URL exactly
- Include `https://` but no trailing slash
- Redeploy after changing

**2. "OAuth redirect_uri_mismatch" error**
- Check GOOGLE_REDIRECT_URI in Railway matches Google Cloud Console exactly
- Must include full path: `/auth/google/callback`
- URLs are case-sensitive

**3. Cookies not being set**
- Verify Railway is deployed with `NODE_ENV=production`
- Check browser isn't blocking third-party cookies
- Try incognito mode

**4. Health check shows redis: "error"**
- Verify REDIS_URL uses `rediss://` (with 's' for TLS)
- Check Upstash credentials are correct
- Upstash free tier has connection limits

**5. "Database connection failed" on startup**
- Verify DATABASE_URL includes `connection_limit=20&pool_timeout=10`
- Check you're using the POOLED connection string from Neon
- Verify SSL mode: `sslmode=require`

**6. Build fails on Railway**
- Check pnpm-lock.yaml is committed to repo
- Verify Dockerfile path is `apps/api/Dockerfile`
- Check Railway logs for specific error

---

## Cost Management

### Current Setup (8 users)
- **Railway Hobby Plan:** $5/month (required for always-on service)
- **Vercel:** Free tier (sufficient)
- **Neon:** Free tier (sufficient)
- **Upstash:** Free tier (monitor closely)

### When to Upgrade

**Upstash Redis** ($10/month Pro):
- If hitting 10K commands/day limit
- Monitor usage at: Upstash Dashboard → Database → Usage

**Neon PostgreSQL** ($19/month):
- If hitting 256MB storage limit
- If needing more than 100 concurrent connections

**Railway** (Pro $20/month):
- If needing multiple team members to manage
- If needing more than one service (e.g., separate worker)

---

## Quick Reference

### URLs to Bookmark

- **Production App:** `https://your-vercel-url.vercel.app`
- **API Health:** `https://your-railway-url.railway.app/health`
- **Railway Dashboard:** https://railway.app/dashboard
- **Vercel Dashboard:** https://vercel.com/dashboard
- **Google Cloud Console:** https://console.cloud.google.com
- **Neon Dashboard:** https://console.neon.tech
- **Upstash Dashboard:** https://console.upstash.com

### Environment Variables Cheat Sheet

**Railway (API) - 11 variables:**
```
DATABASE_URL          → Neon pooled connection string
REDIS_URL             → Upstash TLS connection string
SESSION_SECRET        → 64-char hex (openssl rand -hex 32)
ENCRYPTION_KEY        → 64-char hex (openssl rand -hex 32)
GOOGLE_CLIENT_ID      → From Google Cloud Console
GOOGLE_CLIENT_SECRET  → From Google Cloud Console
GOOGLE_REDIRECT_URI   → https://railway-url/auth/google/callback
FRONTEND_URL          → https://vercel-url.vercel.app
NODE_ENV              → production
PORT                  → 3001
HOST                  → 0.0.0.0
```

**Vercel (Frontend) - 1 variable:**
```
VITE_API_URL          → https://railway-url.railway.app
```

---

## Next Steps After Deployment

1. **Test with your account** - Complete full flow before inviting others
2. **Monitor logs** - Check Railway logs daily for first week
3. **Collect feedback** - Ask testers about pain points
4. **Track Redis usage** - Upgrade Upstash if approaching limits
5. **Set up error monitoring** - Consider adding Sentry for production errors

---

## Support

If you encounter issues:
1. Check Railway logs for backend errors
2. Check browser console for frontend errors
3. Verify all environment variables are set correctly
4. Ensure Google OAuth redirect URI matches exactly
5. Test health endpoint to verify database/Redis connectivity

Good luck with your beta launch! 🚀
