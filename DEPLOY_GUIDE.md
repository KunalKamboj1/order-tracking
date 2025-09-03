# Shopify Order Tracking App - Deployment Guide

## 🔑 App Credentials
```
SHOPIFY_API_KEY=2d20e8e11bb0f54c316c6394ad8488d1
SHOPIFY_API_SECRET=b1e6881a1db2a0dd5090764fa156122c
```

---

## 🚀 Backend Deployment (Render)

### Step 1: Create PostgreSQL Database
1. Go to [render.com](https://render.com) → Sign in
2. Click **"New +"** → **"PostgreSQL"**
3. Configure:
   - **Name**: `shopify-tracking-db`
   - **Database**: `shopify_tracking`
   - **Region**: `Oregon (US West)`
   - **PostgreSQL Version**: `15`
   - **Datadog API Key**: (leave empty)
4. Click **"Create Database"**
5. **Copy the Internal Database URL** (starts with `postgres://`)

### Step 2: Create Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Configure:
   - **Name**: `shopify-tracking-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node app.js`
   - **Instance Type**: `Free`

### Step 3: Set Environment Variables
In the **Environment** tab, add:
```
SHOPIFY_API_KEY=2d20e8e11bb0f54c316c6394ad8488d1
SHOPIFY_API_SECRET=b1e6881a1db2a0dd5090764fa156122c
SHOPIFY_SCOPES=read_orders,read_fulfillments
HOST=https://shopify-tracking-backend.onrender.com
PORT=10000
DATABASE_URL=postgres://user:password@host:port/database
```
**Replace `DATABASE_URL` with your actual PostgreSQL Internal Database URL**

### Step 4: Deploy & Verify
1. Click **"Create Web Service"**
2. Wait for deployment (5-10 minutes)
3. Check logs for:
   ```
   ✅ Server running on port 10000
   ✅ Connected to PostgreSQL
   ✅ Table 'shops' ready
   ```
4. **Copy your Render service URL**: `https://shopify-tracking-backend.onrender.com`

---

## 🌐 Frontend Deployment (Netlify)

### Step 1: Create Site
1. Go to [netlify.com](https://netlify.com) → Sign in
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect your GitHub repository
4. Configure:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/.next`
   - **Functions directory**: (leave empty)

### Step 2: Set Environment Variables
In **Site settings** → **Environment variables**, add:
```
NEXT_PUBLIC_SHOPIFY_API_KEY=2d20e8e11bb0f54c316c6394ad8488d1
NEXT_PUBLIC_BACKEND_URL=https://shopify-tracking-backend.onrender.com
NODE_VERSION=18
```
**Replace `NEXT_PUBLIC_BACKEND_URL` with your actual Render service URL**

### Step 3: Deploy & Verify
1. Click **"Deploy site"**
2. Wait for build completion (3-5 minutes)
3. **Copy your Netlify site URL**: `https://amazing-app-name.netlify.app`
4. Test: Visit the URL and verify the admin interface loads

---

## 🎨 Theme App Extension Deployment

### Step 1: Install Shopify CLI
```bash
npm install -g @shopify/cli @shopify/theme
```

### Step 2: Authenticate
```bash
shopify auth login
```

### Step 3: Deploy Extension
```bash
# Navigate to project root
cd c:\Users\DELL\Desktop\trae_tracking

# Deploy the extension
shopify app deploy
```

### Step 4: Verify Extension
1. Go to your development store admin
2. Navigate: **Online Store** → **Themes** → **Customize**
3. Click **"Add section"** or **"Add block"**
4. Look for **"Order Tracking Widget"** in the list
5. Add it and configure:
   - **Widget URL**: `https://amazing-app-name.netlify.app/widget`
   - **Height**: `400px`
   - **Show Border**: `true`

---

## 🔧 Shopify Partner Dashboard Configuration

### Update App URLs
1. Go to [partners.shopify.com](https://partners.shopify.com)
2. Select your app
3. Go to **App setup** → **URLs**
4. Update:
   - **App URL**: `https://amazing-app-name.netlify.app`
   - **Allowed redirection URL(s)**: `https://shopify-tracking-backend.onrender.com/callback`

### Verify App Scopes
Ensure **App scopes** includes:
- `read_orders`
- `read_fulfillments`

---

## 🧪 Testing Checklist

### ☐ Backend Testing
```bash
# Test OAuth endpoint
curl "https://shopify-tracking-backend.onrender.com/auth?shop=your-dev-store.myshopify.com"

# Should redirect to Shopify OAuth
```

### ☐ App Installation
1. Visit: `https://shopify-tracking-backend.onrender.com/auth?shop=your-dev-store.myshopify.com`
2. Complete OAuth flow
3. Verify app appears in **Apps** section of Shopify Admin

### ☐ Admin Interface Testing
1. In Shopify Admin → **Apps** → Click your app
2. Create a test order with tracking number
3. Enter order ID in the admin interface
4. Verify tracking information displays correctly

### ☐ Customer Widget Testing
1. In **Online Store** → **Themes** → **Customize**
2. Add **"Order Tracking Widget"** block
3. Configure widget URL: `https://amazing-app-name.netlify.app/widget`
4. Save and visit storefront
5. Test widget with valid order ID
6. Verify tracking information loads

---

## 🚨 Troubleshooting Commands

### Check Backend Logs
```bash
# In Render dashboard, go to your service → Logs tab
# Look for:
# ✅ "Server running on port 10000"
# ✅ "Connected to PostgreSQL"
# ❌ Any error messages
```

### Check Frontend Build
```bash
# In Netlify dashboard, go to your site → Deploys tab
# Look for:
# ✅ "Deploy succeeded"
# ❌ Build errors in logs
```

### Test Database Connection
```bash
# Connect to your Render PostgreSQL instance
psql "postgres://user:password@host:port/database"

# Check if shops table exists
\dt

# Should show 'shops' table
```

### Verify Environment Variables
```bash
# Backend (Render) - check Environment tab
echo $SHOPIFY_API_KEY
echo $DATABASE_URL

# Frontend (Netlify) - check Site settings → Environment variables
echo $NEXT_PUBLIC_BACKEND_URL
```

---

## 📋 Quick Reference URLs

**Replace these with your actual URLs:**

- **Backend (Render)**: `https://shopify-tracking-backend.onrender.com`
- **Frontend (Netlify)**: `https://amazing-app-name.netlify.app`
- **Customer Widget**: `https://amazing-app-name.netlify.app/widget`
- **OAuth URL**: `https://shopify-tracking-backend.onrender.com/auth?shop=STORE.myshopify.com`

---

## ✅ Deployment Complete!

Your Shopify Order Tracking App is now live with:
- ✅ Backend API running on Render with PostgreSQL
- ✅ Admin interface hosted on Netlify
- ✅ Theme extension deployed via Shopify CLI
- ✅ Customer widget embedded in storefront

**Next Steps:**
1. Test thoroughly on your development store
2. Submit for App Store review (optional)
3. Install on production stores

*Happy tracking! 🚚📦*