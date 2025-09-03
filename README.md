# Shopify Order Tracking App

A complete Shopify app that provides order tracking functionality with both admin interface and customer-facing widget.

## Features

- **Backend API**: Express.js server with OAuth authentication and tracking endpoints
- **Admin Interface**: Next.js app embedded in Shopify Admin using App Bridge and Polaris
- **Customer Widget**: Embeddable tracking widget for storefronts
- **Theme App Extension**: Shopify theme block for easy widget integration
- **PostgreSQL Database**: Secure token storage using pg

## Project Structure

```
trae_tracking/
├── backend/                 # Express.js API server
│   ├── app.js              # Main server file
│   ├── package.json        # Backend dependencies
│   └── .env.example        # Environment variables template
├── frontend/               # Next.js admin interface
│   ├── pages/
│   │   ├── _app.js         # App Bridge & Polaris providers
│   │   ├── _document.js    # Custom document with Tailwind
│   │   ├── index.js        # Admin tracking interface
│   │   └── widget.js       # Customer tracking widget
│   ├── package.json        # Frontend dependencies
│   ├── next.config.js      # Next.js configuration
│   └── .env.local.example  # Frontend environment template
└── extensions/             # Shopify theme app extension
    └── tracking-widget/
        ├── schema.json     # Block configuration
        └── tracking-widget.liquid  # Liquid template
```

## Setup Instructions

### 1. Environment Variables

#### Backend (.env)
```bash
SHOPIFY_API_KEY=your_shopify_api_key_here
SHOPIFY_API_SECRET=your_shopify_api_secret_here
SHOPIFY_SCOPES=read_orders,read_fulfillments
HOST=https://your-render-app.onrender.com
PORT=3000
DATABASE_URL=postgresql://username:password@hostname:port/database_name
```

#### Frontend (.env.local)
```bash
NEXT_PUBLIC_SHOPIFY_API_KEY=your_shopify_api_key_here
NEXT_PUBLIC_BACKEND_URL=https://your-render-app.onrender.com
```

### 2. Set up PostgreSQL Database on Render

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click "New" → "PostgreSQL"
3. Choose a name for your database (e.g., "shopify-tracking-db")
4. Select the free plan
5. Click "Create Database"
6. Once created, copy the "External Database URL" from the database info page
7. This will be your `DATABASE_URL` environment variable

### 3. Deploy Backend to Render

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Set the following:
   - **Build Command**: `cd backend && npm install`
   - **Start Command**: `cd backend && npm start`
   - **Root Directory**: Leave empty
4. Add environment variables in Render dashboard:
   - `SHOPIFY_API_KEY`
   - `SHOPIFY_API_SECRET`
   - `SHOPIFY_SCOPES`
   - `HOST`
   - `DATABASE_URL` (use the PostgreSQL URL from step 2)
5. Deploy and note your Render URL

### 4. Deploy Frontend to Netlify

1. Create a new site on [Netlify](https://netlify.com)
2. Connect your GitHub repository
3. Set the following:
   - **Build Command**: `cd frontend && npm run build`
   - **Publish Directory**: `frontend/.next`
   - **Base Directory**: `frontend`
4. Add environment variables in Netlify dashboard
5. Deploy and note your Netlify URL

### 5. Configure Shopify Partner Dashboard

1. Go to [Shopify Partners](https://partners.shopify.com)
2. Create a new app or edit existing app
3. Set the following URLs:
   - **App URL**: `https://your-netlify-app.netlify.app`
   - **Allowed Redirection URL(s)**: `https://your-render-app.onrender.com/callback`
4. Set scopes: `read_orders,read_fulfillments`
5. Save the configuration

### 6. Install and Test the App

#### Install the App
1. In Shopify Partners, click "Test on development store"
2. Or use the installation URL: `https://your-render-app.onrender.com/auth?shop=your-shop.myshopify.com`
3. Complete the OAuth flow
4. The app will appear in your Shopify Admin under "Apps"

#### Test Admin Interface
1. Go to Shopify Admin → Apps → Your App
2. Enter an order ID and click "Fetch Tracking"
3. View tracking information if available

#### Test Customer Widget
1. Visit: `https://your-netlify-app.netlify.app/widget?shop=your-shop.myshopify.com`
2. Enter an order ID and test tracking lookup

### 7. Add Theme App Extension

#### Option A: Manual Integration
Add this code to your theme where you want the tracking widget:

```liquid
<iframe 
  src="https://your-netlify-app.netlify.app/widget?shop={{ shop.permanent_domain }}"
  style="width:100%; height:400px; border:none;"
  title="Order Tracking Widget"
></iframe>
```

#### Option B: Theme App Extension (Recommended)
1. Use Shopify CLI to create the extension:
   ```bash
   shopify app generate extension --type=theme
   ```
2. Replace the generated files with the ones in `/extensions/tracking-widget/`
3. Deploy the extension:
   ```bash
   shopify app deploy
   ```
4. Merchants can then add the block via:
   - Online Store → Themes → Customize
   - Add block → Order Tracking Widget

## API Endpoints

### Backend Endpoints

- `GET /auth?shop={shop}` - Start OAuth flow
- `GET /callback` - OAuth callback handler
- `GET /tracking?shop={shop}&order_id={id}` - Get tracking info
- `GET /health` - Health check

### Response Format

```json
{
  "tracking_number": "1234567890",
  "tracking_company": "UPS",
  "tracking_url": "https://www.ups.com/track?tracknum=1234567890"
}
```

## Local Development

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your values
npm run dev
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
# Edit .env.local with your values
npm run dev
```

## Troubleshooting

### Common Issues

1. **OAuth Error**: Check that redirect URL matches exactly in Partner Dashboard
2. **CORS Issues**: Ensure backend has proper CORS headers
3. **Token Not Found**: Verify shop domain format (should include .myshopify.com)
4. **Tracking Not Found**: Check that order exists and has fulfillments
5. **Widget Not Loading**: Verify iframe permissions and CSP headers

### Debug Steps

1. Check browser console for JavaScript errors
2. Verify environment variables are set correctly
3. Test API endpoints directly with curl or Postman
4. Check server logs for detailed error messages
5. Check PostgreSQL connection and credentials

## Security Considerations

- Never commit `.env` files to version control
- Use HTTPS for all production URLs
- Validate all input parameters
- Store access tokens securely in database
- Implement rate limiting for production use
- Use CSP headers for iframe security

## Dependencies

### Backend
- express: Web framework
- axios: HTTP client
- pg: PostgreSQL database client
- dotenv: Environment variables

### Frontend
- next: React framework
- @shopify/app-bridge-react: Shopify App Bridge
- @shopify/polaris: Shopify design system
- axios: HTTP client

## License

MIT License - feel free to modify and use for your projects.

## Support

For issues and questions:
1. Check the troubleshooting section above
2. Review Shopify's [App Development Documentation](https://shopify.dev/apps)
3. Check [Shopify Community Forums](https://community.shopify.com/)

---

**Note**: Replace all placeholder URLs (`your-render-app.onrender.com`, `your-netlify-app.netlify.app`) with your actual deployment URLs.