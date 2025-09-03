# Shopify Order Tracking App - Deployment Checklist

## 📋 Pre-Deployment Setup

### Shopify Partner Dashboard Configuration
☐ Create Shopify Partner account at [partners.shopify.com](https://partners.shopify.com)
☐ Create new app in Partner Dashboard
☐ Note down **API Key** and **API Secret** (keep these secure)
☐ Set **App URL** to your Netlify frontend URL (e.g., `https://your-app.netlify.app`)
☐ Set **Allowed redirection URL(s)** to your Render backend callback (e.g., `https://your-backend.onrender.com/callback`)
☐ Configure **App scopes**: `read_orders,read_fulfillments`

---

## 🚀 Backend Deployment (Render)

### Repository Setup
☐ Push your code to GitHub repository
☐ Ensure `backend/` folder contains `app.js`, `package.json`, and `.env.example`

### Render Service Creation
☐ Sign up/login to [render.com](https://render.com)
☐ Click "New +" → "Web Service"
☐ Connect your GitHub repository
☐ Configure service settings:
   - **Name**: `shopify-tracking-backend` (or your preferred name)
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (for testing)

### PostgreSQL Database Setup
☐ In Render Dashboard, click "New +" → "PostgreSQL"
☐ Create free PostgreSQL instance:
   - **Name**: `shopify-tracking-db`
   - **Database**: `shopify_tracking`
   - **User**: (auto-generated)
   - **Region**: Same as your web service
☐ Copy the **Internal Database URL** from PostgreSQL dashboard

### Environment Variables Configuration
☐ In your web service settings, go to "Environment" tab
☐ Add the following environment variables:
   - `SHOPIFY_API_KEY`: Your Shopify app's API key
   - `SHOPIFY_API_SECRET`: Your Shopify app's API secret
   - `SHOPIFY_SCOPES`: `read_orders,read_fulfillments`
   - `HOST`: Your Render service URL (e.g., `https://your-backend.onrender.com`)
   - `PORT`: `10000` (Render's default)
   - `DATABASE_URL`: Your PostgreSQL Internal Database URL

### Deployment Verification
☐ Deploy the service and wait for build completion
☐ Check service logs for successful startup message
☐ Verify database connection in logs (no PostgreSQL errors)
☐ Test OAuth endpoint: Visit `https://your-backend.onrender.com/auth?shop=your-dev-store.myshopify.com`

---

## 🌐 Frontend Deployment (Netlify)

### Repository Setup
☐ Ensure `frontend/` folder contains all Next.js files
☐ Verify `package.json` has correct build scripts

### Netlify Site Creation
☐ Sign up/login to [netlify.com](https://netlify.com)
☐ Click "Add new site" → "Import an existing project"
☐ Connect your GitHub repository
☐ Configure build settings:
   - **Base directory**: `frontend`
   - **Build command**: `npm run build`
   - **Publish directory**: `frontend/.next` or `frontend/out` (check Next.js config)
   - **Node version**: `18` (in Environment variables)

### Environment Variables Configuration
☐ In Netlify site settings, go to "Environment variables"
☐ Add the following variables:
   - `NEXT_PUBLIC_SHOPIFY_API_KEY`: Your Shopify app's API key
   - `NEXT_PUBLIC_BACKEND_URL`: Your Render backend URL (e.g., `https://your-backend.onrender.com`)

### Deployment Verification
☐ Deploy the site and wait for build completion
☐ Verify site is publicly accessible
☐ Test admin interface loads correctly
☐ Check browser console for any JavaScript errors

### Update Shopify Partner Dashboard
☐ Update **App URL** in Partner Dashboard to your Netlify URL
☐ Ensure **Allowed redirection URL(s)** points to your Render backend

---

## 🎨 Theme App Extension Deployment

### Shopify CLI Setup
☐ Install Shopify CLI: `npm install -g @shopify/cli @shopify/theme`
☐ Authenticate with Shopify: `shopify auth login`
☐ Navigate to your project root directory

### Extension Deployment
☐ Run `shopify app deploy` from project root
☐ Select your app from the list (or create new if first time)
☐ Confirm deployment when prompted
☐ Note the extension ID provided after successful deployment

### Extension Verification
☐ Go to your development store admin
☐ Navigate to **Online Store** → **Themes**
☐ Click **Customize** on your active theme
☐ Try adding a new section/block
☐ Verify "Order Tracking Widget" appears in the block list
☐ Add the block and configure its settings

---

## 🧪 End-to-End Testing

### App Installation Testing
☐ Create a Shopify development store (if not already done)
☐ Install your app on the development store:
   - Visit: `https://your-backend.onrender.com/auth?shop=your-dev-store.myshopify.com`
   - Complete OAuth flow
   - Verify app appears in store's admin under "Apps"

### Admin Interface Testing
☐ Open app from Shopify Admin → Apps → Your App
☐ Verify admin interface loads correctly
☐ Create a test order in your development store (with tracking number)
☐ Enter the order ID in admin interface
☐ Confirm tracking information displays correctly
☐ Test error handling with invalid order ID

### Customer Widget Testing
☐ Add "Order Tracking Widget" block to your storefront theme
☐ Configure widget settings (heading, height, etc.)
☐ Visit storefront and locate the tracking widget
☐ Test widget with valid order ID
☐ Verify tracking information displays in customer-facing widget
☐ Test responsive design on mobile devices

### Performance & Security Testing
☐ Check backend response times (should be < 2 seconds)
☐ Verify HTTPS is working on all endpoints
☐ Test with multiple concurrent requests
☐ Confirm no sensitive data is exposed in client-side code
☐ Verify database connections are properly closed

---

## 📝 Post-Deployment Tasks

### Documentation
☐ Update README.md with live URLs
☐ Document any deployment-specific configurations
☐ Create user guide for store owners

### Monitoring Setup
☐ Set up Render service monitoring/alerts
☐ Configure Netlify deployment notifications
☐ Monitor database usage and performance

### App Store Submission (Optional)
☐ Complete app listing in Partner Dashboard
☐ Add app screenshots and descriptions
☐ Submit for Shopify App Store review (if desired)

---

## 🚨 Troubleshooting Common Issues

### Backend Issues
☐ **Database connection errors**: Check DATABASE_URL format and PostgreSQL service status
☐ **OAuth failures**: Verify API key/secret and redirect URLs match Partner Dashboard
☐ **CORS errors**: Ensure frontend URL is whitelisted in backend CORS settings

### Frontend Issues
☐ **Build failures**: Check Node.js version compatibility and dependency conflicts
☐ **API call failures**: Verify NEXT_PUBLIC_BACKEND_URL is correct and accessible
☐ **App Bridge errors**: Confirm NEXT_PUBLIC_SHOPIFY_API_KEY matches Partner Dashboard

### Extension Issues
☐ **Extension not appearing**: Re-run `shopify app deploy` and check CLI output for errors
☐ **Widget not loading**: Verify iframe src URL and check browser console for errors
☐ **Theme compatibility**: Test with different themes and check for CSS conflicts

---

**🎉 Congratulations! Your Shopify Order Tracking App is now live!**

*Last updated: [Current Date]*
*App Version: 1.0.0*