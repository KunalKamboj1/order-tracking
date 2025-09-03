# Shopify Billing Integration Setup Guide

This guide covers the complete setup of Shopify Billing API integration with both recurring subscriptions and one-time payments.

## Overview

The billing system includes:
- **Monthly Plan**: $15/month recurring subscription with 3-day free trial
- **Lifetime Plan**: $150 one-time payment with 3-day trial period
- Automatic billing enforcement on protected routes
- PostgreSQL database for charge tracking
- Test mode enabled for safe development

## Backend Setup

### 1. Environment Variables

Add these variables to your backend `.env` file:

```env
# Required for billing callbacks
BACKEND_URL=https://your-render-app.onrender.com
FRONTEND_URL=https://your-netlify-app.netlify.app

# Existing variables
SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here
DATABASE_URL=your_postgresql_connection_string
```

### 2. Database Migration

The `charges` table is automatically created when the app starts. It includes:

```sql
CREATE TABLE charges (
  id SERIAL PRIMARY KEY,
  shop VARCHAR(255) NOT NULL,
  charge_id VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  type VARCHAR(20) NOT NULL CHECK (type IN ('recurring', 'lifetime')),
  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'USD',
  trial_days INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Billing API Endpoints

- `GET /billing/subscribe?shop={shop}` - Creates recurring subscription
- `GET /billing/lifetime?shop={shop}` - Creates one-time payment
- `GET /billing/callback?shop={shop}&type={type}&charge_id={id}` - Handles Shopify callbacks
- `GET /billing/status?shop={shop}` - Checks billing status

### 4. Billing Enforcement

The middleware automatically:
- Checks for active billing on protected routes
- Exempts auth, callback, billing, and health endpoints
- Returns 402 Payment Required for merchants without active billing
- Redirects to pricing page when billing is required

## Frontend Setup

### 1. Dependencies

Install Tailwind CSS dependencies:

```bash
cd frontend
npm install -D tailwindcss postcss autoprefixer
```

### 2. Pricing Page

The pricing page (`/pricing`) includes:
- Two plan options with feature comparison
- Responsive design with Tailwind CSS
- Integration with Shopify Polaris components
- Automatic redirect to backend billing endpoints
- Success/error handling from billing callbacks

### 3. Billing Status Check

The main app automatically:
- Checks billing status on page load
- Redirects to pricing page if no active billing
- Handles errors gracefully to avoid breaking the app

## Shopify App Configuration

### 1. App Scopes

Ensure your Shopify app has these scopes:
```
read_orders,read_fulfillments,write_application_charges
```

### 2. App URLs

Configure these URLs in your Shopify Partner Dashboard:
- **App URL**: `https://your-netlify-app.netlify.app`
- **Allowed redirection URLs**: 
  - `https://your-render-app.onrender.com/callback`
  - `https://your-render-app.onrender.com/billing/callback`

## Testing the Billing Flow

### 1. Test Mode

Billing is currently in test mode (`"test": true`). This means:
- No actual charges are created
- Merchants can test the full flow safely
- Shopify shows test payment screens

### 2. Testing Steps

1. Install the app on a development store
2. Navigate to the main app page
3. You should be redirected to `/pricing` (no active billing)
4. Click either "Start Free Trial" or "Get Lifetime Access"
5. Complete the Shopify billing flow
6. Verify redirect back to main app with success message
7. Check database for charge record with `active` status

### 3. Database Verification

Check the charges table:
```sql
SELECT * FROM charges WHERE shop = 'your-test-store.myshopify.com';
```

## Production Deployment

### 1. Disable Test Mode

Before going live, update both billing routes in `backend/app.js`:

```javascript
// Change from:
test: true,

// To:
test: false,
```

### 2. Environment Variables

Ensure production environment variables are set:
- Render: Set `BACKEND_URL` and `FRONTEND_URL`
- Netlify: Set `NEXT_PUBLIC_BACKEND_URL`

### 3. SSL Requirements

Shopify requires HTTPS for all billing endpoints. Both Render and Netlify provide SSL by default.

## Troubleshooting

### Common Issues

1. **"Shop not found" error**: Ensure the shop has completed OAuth flow
2. **Billing callback fails**: Check `BACKEND_URL` and `FRONTEND_URL` environment variables
3. **Pricing page not loading**: Verify Tailwind CSS is properly configured
4. **Database connection errors**: Check `DATABASE_URL` and PostgreSQL connection

### Debug Endpoints

- `GET /health` - Check backend status
- `GET /billing/status?shop={shop}` - Check billing status for specific shop
- Check browser network tab for API call errors
- Check backend logs for billing API responses

## Security Considerations

1. **Access Tokens**: Stored securely in PostgreSQL
2. **Charge Verification**: All charges verified via Shopify API
3. **HTTPS Only**: All billing endpoints require SSL
4. **Input Validation**: Shop parameters validated and sanitized
5. **Error Handling**: Graceful fallbacks prevent app breakage

## Support

For billing-related issues:
1. Check Shopify Partner Dashboard for app charges
2. Review backend logs for API errors
3. Verify database charge records
4. Test with development store first