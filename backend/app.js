const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Create tables if they don't exist
const initDatabase = async () => {
  try {
    // Create shops table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        shop TEXT UNIQUE,
        access_token TEXT
      )
    `);
    
    // Create charges table for billing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS charges (
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
      )
    `);
    
    // Create indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charges_shop ON charges(shop)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charges_charge_id ON charges(charge_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status)`);
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

initDatabase();

// Middleware
// Raw body parser for webhooks
app.use('/webhooks', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook verification middleware
const verifyWebhook = (req, res, next) => {
  console.log('[WEBHOOK VERIFY] Starting webhook verification');
  console.log('[WEBHOOK VERIFY] Headers:', {
    'X-Shopify-Hmac-Sha256': req.get('X-Shopify-Hmac-Sha256'),
    'X-Shopify-Shop-Domain': req.get('X-Shopify-Shop-Domain'),
    'X-Shopify-Topic': req.get('X-Shopify-Topic'),
    'Content-Type': req.get('Content-Type')
  });
  
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.body;
  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  
  console.log('[WEBHOOK VERIFY] HMAC from header:', hmac);
  console.log('[WEBHOOK VERIFY] Body type:', typeof body);
  console.log('[WEBHOOK VERIFY] Body length:', body ? body.length : 0);
  console.log('[WEBHOOK VERIFY] Webhook secret configured:', webhookSecret ? 'Yes' : 'No');
  
  if (!webhookSecret) {
    console.error('[WEBHOOK VERIFY] SHOPIFY_WEBHOOK_SECRET not configured!');
    return res.status(500).send('Webhook secret not configured');
  }
  
  if (!hmac) {
    console.error('[WEBHOOK VERIFY] No HMAC header found');
    return res.status(401).send('No HMAC header');
  }
  
  const hash = crypto.createHmac('sha256', webhookSecret).update(body, 'utf8').digest('base64');
  console.log('[WEBHOOK VERIFY] Calculated hash:', hash);
  console.log('[WEBHOOK VERIFY] Received HMAC:', hmac);
  console.log('[WEBHOOK VERIFY] Hashes match:', hash === hmac);
  
  if (hash === hmac) {
    console.log('[WEBHOOK VERIFY] Verification successful');
    next();
  } else {
    console.error('[WEBHOOK VERIFY] Verification failed - hash mismatch');
    res.status(401).send('Unauthorized');
  }
};

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// Helper function to check if shop has active billing
const hasActiveBilling = async (shop) => {
  try {
    const result = await pool.query(
      'SELECT * FROM charges WHERE shop = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [shop, 'active']
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking billing status:', error);
    return false;
  }
};

// Billing enforcement middleware
const requireActiveBilling = async (req, res, next) => {
  const { shop } = req.query;
  
  // Skip billing check for auth, callback, billing, and health endpoints
  const exemptPaths = ['/auth', '/callback', '/billing', '/health', '/'];
  const isExempt = exemptPaths.some(path => req.path.startsWith(path));
  
  if (isExempt || !shop) {
    return next();
  }

  try {
    const hasActive = await hasActiveBilling(shop);
    if (!hasActive) {
      return res.status(402).json({ 
        error: 'Payment required', 
        message: 'Please subscribe to continue using the app',
        redirectTo: '/pricing'
      });
    }
    next();
  } catch (error) {
    console.error('Billing enforcement error:', error);
    next(); // Continue on error to avoid breaking the app
  }
};

// Apply billing enforcement to protected routes
app.use(requireActiveBilling);

// JWT Session Token verification middleware
const verifySessionToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Session token required' });
  }

  try {
    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, process.env.SHOPIFY_API_SECRET);
    req.shop = decoded.dest.replace('https://', '').replace('/admin', '');
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid session token' });
  }
};

// Apply session token verification to API routes that need it
// (We'll add this to specific routes as needed)

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Shopify Order Tracking Backend API',
    status: 'running',
    endpoints: {
      auth: '/auth?shop=yourstore.myshopify.com',
      callback: '/callback',
      tracking: '/tracking?order_id=ORDER_ID&shop=SHOP_DOMAIN',
      health: '/health'
    }
  });
});

// OAuth start endpoint
app.get('/auth', (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  const scopes = process.env.SHOPIFY_SCOPES || 'read_orders,read_fulfillments';
  const redirectUri = `${process.env.HOST}/callback`;
  const state = Math.random().toString(36).substring(7);

  const authUrl = `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}&` +
    `scope=${scopes}&` +
    `redirect_uri=${redirectUri}&` +
    `state=${state}`;

  res.redirect(authUrl);
});

// OAuth callback endpoint
app.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;

  console.log('=== OAUTH CALLBACK ===');
  console.log('Shop:', shop);
  console.log('Code:', code ? 'Present' : 'Missing');
  console.log('State:', state);

  if (!code || !shop) {
    console.log('Missing required parameters for OAuth');
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    console.log('Shop domain:', shopDomain);
    
    // Exchange code for access token
    console.log('Exchanging code for access token...');
    const tokenResponse = await axios.post(`https://${shopDomain}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code: code
    });

    const { access_token } = tokenResponse.data;
    console.log('Access token received:', access_token ? `${access_token.substring(0, 10)}...` : 'None');

    // Validate the new access token
    console.log('Validating access token...');
    const validationResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    console.log('Access token validation successful');

    // Store/update shop data (reinstallation handling via upsert)
    console.log('Processing shop installation/reinstallation...');

    // Store/update token in database
    console.log('Storing token in database...');
    const result = await pool.query(
      'INSERT INTO shops (shop, access_token) VALUES ($1, $2) ON CONFLICT (shop) DO UPDATE SET access_token = EXCLUDED.access_token RETURNING *',
      [shopDomain, access_token]
    );
    console.log('Database update result:', result.rows[0] ? 'Success' : 'Failed');
    console.log('Shop record:', result.rows[0] ? `ID: ${result.rows[0].id}, Shop: ${result.rows[0].shop}` : 'None');

    // Redirect back to the app after successful installation
    const appUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const redirectUrl = `${appUrl}?shop=${shopDomain}&installed=true`;
    
    console.log('Redirecting to app:', redirectUrl);
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('Access token validation failed - invalid token received');
    }
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

// Shop status endpoint - checks if shop needs OAuth completion
app.get('/shop/status', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    const result = await pool.query('SELECT * FROM shops WHERE shop = $1', [shopDomain]);
    
    if (result.rows.length === 0) {
      return res.json({ 
        status: 'not_installed',
        needsAuth: true,
        authUrl: `/auth?shop=${shopDomain}`
      });
    }
    
    const shopData = result.rows[0];
    
    if (shopData.access_token === 'pending_oauth') {
      return res.json({ 
        status: 'pending_oauth',
        needsAuth: true,
        authUrl: `/auth?shop=${shopDomain}`
      });
    }
    
    return res.json({ 
      status: 'installed',
      needsAuth: false
    });
    
  } catch (error) {
    console.error('Shop status check error:', error);
    res.status(500).json({ error: 'Failed to check shop status' });
  }
});

// Tracking endpoint (with optional session token verification for embedded apps)
app.get('/tracking', (req, res, next) => {
  // Check if request has Authorization header (from embedded app)
  if (req.headers.authorization) {
    return verifySessionToken(req, res, next);
  }
  // Skip session token verification for standalone/public access
  next();
}, async (req, res) => {
  const { shop, order_id } = req.query;
  
  console.log('=== TRACKING REQUEST ===');
  console.log('Shop:', shop);
  console.log('Order ID:', order_id);
  console.log('Full query params:', req.query);

  if (!shop || !order_id) {
    console.log('Missing required parameters');
    return res.status(400).json({ error: 'Shop and order_id parameters are required' });
  }

  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    console.log('Shop domain:', shopDomain);
    
    // Get access token from database
    const result = await pool.query('SELECT access_token FROM shops WHERE shop = $1 LIMIT 1', [shopDomain]);
    console.log('Database query result:', result.rows.length > 0 ? 'Found shop' : 'Shop not found');

    if (result.rows.length === 0) {
      console.log('Shop not authenticated');
      return res.status(404).json({ error: 'Shop not found or not authenticated' });
    }

    const accessToken = result.rows[0].access_token;
    console.log(`[BILLING] Access token retrieved for shop: ${shop}`);
    
    // Create one-time lifetime charge via Shopify Billing API
    const backendUrl = process.env.BACKEND_URL.endsWith('/') ? process.env.BACKEND_URL.slice(0, -1) : process.env.BACKEND_URL;
    const returnUrl = `${backendUrl}/billing/callback?shop=${shop}&type=lifetime`;
    const chargeData = {
      application_charge: {
        name: 'Order Tracking Pro - Lifetime',
        price: 150.00,
        test: true, // Set to false in production
        return_url: returnUrl
      }
    };
    
    console.log(`[BILLING] Creating lifetime charge with data:`, JSON.stringify(chargeData, null, 2));
    console.log(`[BILLING] Return URL: ${returnUrl}`);
    console.log(`[BILLING] Shopify API URL: https://${shop}/admin/api/2023-10/application_charges.json`);

    const response = await axios.post(
      `https://${shop}/admin/api/2023-10/application_charges.json`,
      chargeData,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const charge = response.data.application_charge;
    console.log(`[BILLING] Shopify API response:`, JSON.stringify(charge, null, 2));
    
    // Store charge in database
    console.log(`[BILLING] Storing charge in database: ${charge.id}`);
    await pool.query(
      'INSERT INTO charges (shop, charge_id, status, type, amount, trial_days) VALUES ($1, $2, $3, $4, $5, $6)',
      [shop, charge.id.toString(), 'pending', 'lifetime', 150.00, 0]
    );
    console.log(`[BILLING] Charge stored successfully`);

    // Redirect to Shopify's confirmation URL (break out of iframe)
    console.log(`[BILLING] Redirecting to confirmation URL: ${charge.confirmation_url}`);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting to Shopify...</title>
        </head>
        <body>
          <script>
            if (window.top !== window.self) {
              // We're in an iframe, redirect the parent window
              window.top.location.href = "${charge.confirmation_url}";
            } else {
              // We're not in an iframe, redirect normally
              window.location.href = "${charge.confirmation_url}";
            }
          </script>
          <p>Redirecting to Shopify billing confirmation...</p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('[BILLING] ERROR creating recurring charge:', error);
    console.error('[BILLING] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
    res.status(500).json({ error: 'Failed to create subscription', details: error.message });
  }
});

// Theme block installation endpoint - Returns instructions directly
app.post('/install-theme-block', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  console.log('Providing theme block installation instructions for shop:', shop);
  
  // Return installation instructions directly without database dependency
  res.json({ 
    success: true, 
    message: 'The Order Tracking Widget is ready to use! Please follow these steps to add it to your theme:',
    instructions: [
      '1. Go to your Shopify Admin → Online Store → Themes',
      '2. Click "Customize" on your active theme',
      '3. Navigate to the page where you want to add the tracking widget',
      '4. Click "Add section" or "Add block" (depending on your theme)',
      '5. Look for "Order Tracking Widget" in the Apps section',
      '6. Add the widget and customize its settings as needed',
      '7. Click "Save" to publish your changes'
    ],
    manual_steps: true,
    widget_name: 'Order Tracking Widget',
    extension_handle: 'tracking-widget'
  });
});

// Billing Routes

// Create recurring subscription charge ($15/month with 3-day trial)
// Billing subscription endpoint with conditional JWT verification
app.get('/billing/subscribe', (req, res, next) => {
  console.log('=== BILLING SUBSCRIBE REQUEST ===');
  console.log('Authorization header present:', !!req.headers.authorization);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  
  // Check if request has Authorization header (from embedded app)
  if (req.headers.authorization) {
    console.log('Using session token verification for embedded app');
    return verifySessionToken(req, res, next);
  }
  console.log('Skipping session token verification for Partner dashboard access');
  // Skip session token verification for Partner dashboard access
  next();
}, async (req, res) => {
  try {
    // Extract shop from both JWT token and query parameters
    const shopFromJWT = req.shop; // Set by verifySessionToken middleware
    const shopFromQuery = req.query.shop;
    
    console.log('=== BILLING SUBSCRIBE DEBUG ===');
    console.log('Shop from JWT token:', shopFromJWT);
    console.log('Shop from query params:', shopFromQuery);
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('Request query:', JSON.stringify(req.query, null, 2));
    
    // Use shop from JWT token if available, otherwise fall back to query parameter
    const shop = shopFromJWT || shopFromQuery;
    
    console.log('Final shop parameter used:', shop);
    
    if (!shop) {
      console.log('ERROR: No shop parameter found in JWT token or query params');
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    console.log(`Processing billing subscription for shop: ${shop}`);

    // Get access token from database
    console.log('Fetching access token from database...');
    const result = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    
    console.log('Database query result:', {
      rowCount: result.rowCount,
      hasRows: result.rows.length > 0
    });
    
    if (result.rows.length === 0) {
      console.log('ERROR: Shop not found in database');
      
      // Show available shops for debugging
      const allShops = await pool.query('SELECT shop FROM shops ORDER BY shop');
      console.log('Available shops in database:', allShops.rows.map(row => row.shop));
      
      return res.status(404).json({ 
        error: 'Shop not found',
        requestedShop: shop,
        availableShops: allShops.rows.map(row => row.shop)
      });
    }

    const accessToken = result.rows[0].access_token;
    console.log('Access token retrieved successfully');

    // Create recurring charge
    console.log('Creating recurring charge via Shopify API...');
    const charge = {
      recurring_application_charge: {
        name: 'Monthly Plan',
        price: 15.00,
        trial_days: 3,
        return_url: `${process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com'}/billing/callback?shop=${shop}&type=recurring`,
        test: false
      }
    };

    const response = await fetch(`https://${shop}/admin/api/2023-10/recurring_application_charges.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(charge)
    });

    const data = await response.json();
    console.log('Shopify API response:', { status: response.status, ok: response.ok });
    
    if (!response.ok) {
      console.log('ERROR: Shopify API error:', data);
      throw new Error(`Shopify API error: ${response.status}`);
    }

    console.log('Recurring charge created successfully');
    
    // Store charge in database
    const chargeId = data.recurring_application_charge.id.toString();
    await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount, trial_days, created_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) ON CONFLICT (charge_id) DO UPDATE SET status = $4, updated_at = CURRENT_TIMESTAMP',
      [shop, chargeId, 'recurring', 'pending', 15.00, 3]
    );
    console.log(`Stored recurring charge in database: ${chargeId}`);
    
    console.log('Redirecting to confirmation URL:', data.recurring_application_charge.confirmation_url);
    
    // Handle iframe redirect for Partner dashboard access
    const confirmationUrl = data.recurring_application_charge.confirmation_url;
    res.send(`
       <!DOCTYPE html>
       <html>
         <head>
           <title>Redirecting to Shopify...</title>
         </head>
         <body>
           <script>
             if (window.top !== window.self) {
               // We're in an iframe, redirect the parent window
               window.top.location.href = "${confirmationUrl}";
             } else {
               // We're not in an iframe, redirect normally
               window.location.href = "${confirmationUrl}";
             }
           </script>
           <p>Redirecting to Shopify billing confirmation...</p>
         </body>
       </html>
     `);
  } catch (error) {
    console.error('Billing subscription error:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Create lifetime charge ($150 one-time with 3-day trial)
app.get('/billing/lifetime', (req, res, next) => {
  console.log('=== BILLING LIFETIME REQUEST ===');
  console.log('Authorization header present:', !!req.headers.authorization);
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query params:', JSON.stringify(req.query, null, 2));
  
  // Check if request has Authorization header (from embedded app)
  if (req.headers.authorization) {
    console.log('Using session token verification for embedded app');
    return verifySessionToken(req, res, next);
  }
  console.log('Skipping session token verification for Partner dashboard access');
  // Skip session token verification for Partner dashboard access
  next();
}, async (req, res) => {
  try {
    // Extract shop from both JWT token and query parameters
    const shopFromJWT = req.shop; // Set by verifySessionToken middleware
    const shopFromQuery = req.query.shop;
    
    console.log('=== BILLING LIFETIME DEBUG ===');
    console.log('Shop from JWT token:', shopFromJWT);
    console.log('Shop from query params:', shopFromQuery);
    console.log('Request headers:', JSON.stringify(req.headers, null, 2));
    console.log('Request query:', JSON.stringify(req.query, null, 2));
    
    // Use shop from JWT token if available, otherwise fall back to query parameter
    const shop = shopFromJWT || shopFromQuery;
    
    console.log('Final shop parameter used:', shop);
    console.log(`[BILLING] Starting lifetime payment for shop: ${shop}`);
    console.log(`[BILLING] BACKEND_URL: ${process.env.BACKEND_URL}`);
    
    if (!shop) {
      console.log('ERROR: No shop parameter found in JWT token or query params');
      console.log(`[BILLING] ERROR: Missing shop parameter`);
      return res.status(400).json({ error: 'Shop parameter is required' });
    }

    // Get shop's access token
    console.log(`[BILLING] Fetching access token for shop: ${shop}`);
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    
    console.log('Database query result:', {
      rowCount: shopResult.rowCount,
      hasRows: shopResult.rows.length > 0
    });
    
    if (shopResult.rows.length === 0) {
      console.log(`[BILLING] ERROR: Shop not found in database: ${shop}`);
      
      // Show available shops for debugging
      const allShops = await pool.query('SELECT shop FROM shops ORDER BY shop');
      console.log('Available shops in database:', allShops.rows.map(row => row.shop));
      
      return res.status(404).json({ 
        error: 'Shop not found',
        requestedShop: shop,
        availableShops: allShops.rows.map(row => row.shop)
      });
    }

    const accessToken = shopResult.rows[0].access_token;
    console.log(`[BILLING] Access token retrieved for shop: ${shop}`);
    
    // Create one-time application charge via Shopify Billing API
    const backendUrl = process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com';
    const returnUrl = `${backendUrl}/billing/callback?shop=${shop}&type=lifetime`;
    const chargeData = {
      application_charge: {
        name: 'Order Tracking Pro - Lifetime',
        price: 150.00,
        test: false,
        return_url: returnUrl
      }
    };
    
    console.log(`[BILLING] Creating application charge with data:`, JSON.stringify(chargeData, null, 2));
    console.log(`[BILLING] Return URL: ${returnUrl}`);
    console.log(`[BILLING] Shopify API URL: https://${shop}/admin/api/2023-10/application_charges.json`);

    const response = await axios.post(
      `https://${shop}/admin/api/2023-10/application_charges.json`,
      chargeData,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const charge = response.data.application_charge;
    console.log(`[BILLING] Shopify API response:`, JSON.stringify(charge, null, 2));
    
    // Store charge in database
    console.log(`[BILLING] Storing charge in database: ${charge.id}`);
    await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount, trial_days, created_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) ON CONFLICT (charge_id) DO UPDATE SET status = $4, updated_at = CURRENT_TIMESTAMP',
      [shop, charge.id.toString(), 'lifetime', 'pending', 150.00, 0]
    );
    console.log(`[BILLING] Charge stored successfully`);

    // Redirect to Shopify's confirmation URL (break out of iframe)
    console.log(`[BILLING] Redirecting to confirmation URL: ${charge.confirmation_url}`);
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Redirecting to Shopify...</title>
        </head>
        <body>
          <script>
            if (window.top !== window.self) {
              // We're in an iframe, redirect the parent window
              window.top.location.href = "${charge.confirmation_url}";
            } else {
              // We're not in an iframe, redirect normally
              window.location.href = "${charge.confirmation_url}";
            }
          </script>
          <p>Redirecting to Shopify billing confirmation...</p>
        </body>
      </html>
    `);
    
  } catch (error) {
    console.error('[BILLING] ERROR creating lifetime charge:', error);
    console.error('[BILLING] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers
    });
    res.status(500).json({ error: 'Failed to create lifetime payment', details: error.message });
  }
});



// Handle billing callback after merchant approval
app.get('/billing/callback', async (req, res) => {
  const { shop, type, charge_id } = req.query;
  console.log(`[BILLING CALLBACK] Starting callback processing`);
  console.log(`[BILLING CALLBACK] Request query params:`, req.query);
  console.log(`[BILLING CALLBACK] Request headers:`, req.headers);
  console.log(`[BILLING CALLBACK] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  
  if (!shop || !type) {
    console.log(`[BILLING CALLBACK] ERROR: Missing required parameters - shop: ${shop}, type: ${type}`);
    return res.status(400).json({ error: 'Shop and type parameters are required' });
  }

  try {
    // Get shop's access token
    console.log(`[BILLING CALLBACK] Fetching access token for shop: ${shop}`);
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      console.log(`[BILLING CALLBACK] ERROR: Shop not found in database: ${shop}`);
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    console.log(`[BILLING CALLBACK] Access token retrieved for shop: ${shop}`);
    let chargeStatus = 'declined';
    let actualChargeId = charge_id;
    
    console.log(`[BILLING CALLBACK] Initial charge_id from URL: ${charge_id}`);
    
    // If charge_id is not provided, get the latest pending charge for this shop
    if (!charge_id) {
      console.log(`[BILLING CALLBACK] No charge_id provided, searching for latest pending charge`);
      const latestCharge = await pool.query(
        'SELECT charge_id FROM charges WHERE shop = $1 AND type = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
        [shop, type, 'pending']
      );
      if (latestCharge.rows.length > 0) {
        actualChargeId = latestCharge.rows[0].charge_id;
        console.log(`[BILLING CALLBACK] Found latest pending charge: ${actualChargeId}`);
      } else {
        console.log(`[BILLING CALLBACK] ERROR: No pending charge found for shop: ${shop}, type: ${type}`);
        // Redirect to the app in Shopify admin with error parameter
        const errorUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=error`;
        console.log(`[BILLING CALLBACK] Redirecting to error URL: ${errorUrl}`);
        return res.redirect(errorUrl);
      }
    } else {
      console.log(`[BILLING CALLBACK] Using charge_id from URL: ${actualChargeId}`);
    }

    console.log(`[BILLING CALLBACK] Processing ${type} charge with ID: ${actualChargeId}`);
    
    if (type === 'recurring') {
      // Get recurring charge details
      const apiUrl = `https://${shop}/admin/api/2023-10/recurring_application_charges/${actualChargeId}.json`;
      console.log(`[BILLING CALLBACK] Fetching recurring charge details from: ${apiUrl}`);
      
      const response = await axios.get(
        apiUrl,
        {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        }
      );
      
      const charge = response.data.recurring_application_charge;
      console.log(`[BILLING CALLBACK] Recurring charge details:`, JSON.stringify(charge, null, 2));
      chargeStatus = charge.status;
      actualChargeId = charge.id.toString();
      console.log(`[BILLING CALLBACK] Recurring charge status: ${chargeStatus}, ID: ${actualChargeId}`);
      
      // Activate recurring charge if accepted
      if (chargeStatus === 'accepted') {
        const activateUrl = `https://${shop}/admin/api/2023-10/recurring_application_charges/${actualChargeId}/activate.json`;
        console.log(`[BILLING CALLBACK] Activating recurring charge at: ${activateUrl}`);
        
        await axios.post(
          activateUrl,
          {},
          {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          }
        );
        chargeStatus = 'active';
        console.log(`[BILLING CALLBACK] Recurring charge activated successfully`);
      }
    } else if (type === 'lifetime') {
      // Get one-time charge details
      const apiUrl = `https://${shop}/admin/api/2023-10/application_charges/${actualChargeId}.json`;
      console.log(`[BILLING CALLBACK] Fetching lifetime charge details from: ${apiUrl}`);
      
      const response = await axios.get(
        apiUrl,
        {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        }
      );
      
      const charge = response.data.application_charge;
      console.log(`[BILLING CALLBACK] Lifetime charge details:`, JSON.stringify(charge, null, 2));
      chargeStatus = charge.status;
      actualChargeId = charge.id.toString();
      console.log(`[BILLING CALLBACK] Lifetime charge status: ${chargeStatus}, ID: ${actualChargeId}`);
    }

    // Update charge status in database
    console.log(`[BILLING CALLBACK] Updating database with status: ${chargeStatus} for charge: ${actualChargeId}`);
    await pool.query(
      'UPDATE charges SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE shop = $2 AND charge_id = $3',
      [chargeStatus, shop, actualChargeId]
    );
    console.log(`[BILLING CALLBACK] Database updated successfully`);

    // Redirect based on status - keep users in Shopify admin
    let redirectUrl;
    if (chargeStatus === 'active' || chargeStatus === 'accepted') {
      // Redirect to the app in Shopify admin with success parameter
      redirectUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=success`;
      console.log(`[BILLING CALLBACK] Charge successful, redirecting to: ${redirectUrl}`);
    } else {
      // Redirect to the app in Shopify admin with declined parameter
      redirectUrl = `https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=declined`;
      console.log(`[BILLING CALLBACK] Charge declined, redirecting to: ${redirectUrl}`);
    }
    
    console.log(`[BILLING CALLBACK] Final redirect to: ${redirectUrl}`);
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('[BILLING CALLBACK] ERROR handling billing callback:', error);
    console.error('[BILLING CALLBACK] Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      headers: error.response?.headers,
      stack: error.stack
    });
    const frontendUrl = process.env.FRONTEND_URL.endsWith('/') ? process.env.FRONTEND_URL.slice(0, -1) : process.env.FRONTEND_URL;
    const errorUrl = `${frontendUrl}/pricing?billing=error`;
    console.log(`[BILLING CALLBACK] Redirecting to error URL: ${errorUrl}`);
    res.redirect(errorUrl);
  }
});

// Billing status check endpoint (with optional session token verification for embedded apps)
app.get('/billing/status', (req, res, next) => {
  // Check if request has Authorization header (from embedded app)
  if (req.headers.authorization) {
    return verifySessionToken(req, res, next);
  }
  // Skip session token verification for standalone/public access
  next();
}, async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  try {
    const hasActive = await hasActiveBilling(shop);
    res.json({ hasActiveBilling: hasActive });
  } catch (error) {
    console.error('Error checking billing status:', error);
    res.status(500).json({ error: 'Failed to check billing status' });
  }
});

// Test endpoint to verify webhook connectivity
app.get('/webhooks/test', (req, res) => {
  console.log('[WEBHOOK TEST] Test endpoint accessed at:', new Date().toISOString());
  console.log('[WEBHOOK TEST] Headers:', JSON.stringify(req.headers, null, 2));
  console.log('[WEBHOOK TEST] Query params:', JSON.stringify(req.query, null, 2));
  res.status(200).json({ 
    status: 'success', 
    message: 'Webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
    server: 'order-tracking-pro'
  });
});

// Note: app/installed webhook is not supported by Shopify
// Partner dashboard installations are handled by the frontend shop status check

// Webhook endpoint for app uninstallation
app.post('/webhooks/app/uninstalled', verifyWebhook, async (req, res) => {
  console.log('\n=== APP UNINSTALL WEBHOOK RECEIVED ===');
  console.log('[UNINSTALL] Timestamp:', new Date().toISOString());
  console.log('[UNINSTALL] Request method:', req.method);
  console.log('[UNINSTALL] Request URL:', req.url);
  console.log('[UNINSTALL] Request headers:', req.headers);
  console.log('[UNINSTALL] Raw body:', req.body);
  
  const shop = req.get('X-Shopify-Shop-Domain');
  const topic = req.get('X-Shopify-Topic');
  
  console.log(`[UNINSTALL] Shop domain: ${shop}`);
  console.log(`[UNINSTALL] Topic: ${topic}`);
  
  if (!shop) {
    console.error('[UNINSTALL] ERROR: No shop domain in headers');
    return res.status(400).send('No shop domain');
  }
  
  try {
    console.log(`[UNINSTALL] Starting cleanup for shop: ${shop}`);
    
    // Check existing data before cleanup
    const shopResult = await pool.query('SELECT * FROM shops WHERE shop = $1', [shop]);
    const chargesResult = await pool.query('SELECT * FROM charges WHERE shop = $1', [shop]);
    
    console.log(`[UNINSTALL] Found ${shopResult.rows.length} shop records`);
    console.log(`[UNINSTALL] Found ${chargesResult.rows.length} charge records`);
    
    if (shopResult.rows.length > 0) {
      console.log('[UNINSTALL] Shop data:', shopResult.rows[0]);
    }
    
    if (chargesResult.rows.length > 0) {
      console.log('[UNINSTALL] Charge data:', chargesResult.rows);
    }
    
    // Clean up shop data from database
    const deleteShopsResult = await pool.query('DELETE FROM shops WHERE shop = $1', [shop]);
    const deleteChargesResult = await pool.query('DELETE FROM charges WHERE shop = $1', [shop]);
    
    console.log(`[UNINSTALL] Deleted ${deleteShopsResult.rowCount} shop records`);
    console.log(`[UNINSTALL] Deleted ${deleteChargesResult.rowCount} charge records`);
    
    console.log(`[UNINSTALL] ✅ Successfully cleaned up data for shop: ${shop}`);
    console.log('=== UNINSTALL WEBHOOK COMPLETED ===\n');
    
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[UNINSTALL] ❌ Error cleaning up data for shop ${shop}:`, error);
    console.error('[UNINSTALL] Error stack:', error.stack);
    console.log('=== UNINSTALL WEBHOOK FAILED ===\n');
    res.status(500).send('Error');
  }
});

// Unified GDPR Webhook Handler
app.post('/webhooks/gdpr', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  const topic = req.get('X-Shopify-Topic');
  
  // Verify Content-Type header as required by Shopify
  if (req.get('Content-Type') !== 'application/json') {
    console.log(`[GDPR] Invalid Content-Type for ${topic} from shop: ${shop}`);
    return res.status(400).send('Invalid Content-Type');
  }
  
  try {
    const payload = JSON.parse(req.body);
    
    // Route to appropriate handler based on topic
    switch (topic) {
      case 'customers/data_request':
        return await handleCustomerDataRequest(req, res, shop, payload);
      case 'customers/redact':
        return await handleCustomerRedact(req, res, shop, payload);
      case 'shop/redact':
        return await handleShopRedact(req, res, shop, payload);
      default:
        console.log(`[GDPR] Unknown topic: ${topic}`);
        return res.status(400).json({ error: 'Unknown GDPR topic' });
    }
  } catch (error) {
    console.error(`[GDPR] Error processing ${topic} request:`, error);
    res.status(500).json({ error: 'Error processing GDPR request' });
  }
});

// GDPR Data Request Handler
async function handleCustomerDataRequest(req, res, shop, payload) {
  const customerId = payload.customer?.id;
  const customerEmail = payload.customer?.email;
  
  console.log(`[GDPR] Data request received for shop: ${shop}`);
  console.log(`[GDPR] Customer ID: ${customerId}, Email: ${customerEmail}`);
  
  // Log the request for compliance tracking
  const requestTimestamp = new Date().toISOString();
  console.log(`[GDPR] Data request logged at: ${requestTimestamp}`);
  
  // Collect customer data (we don't store personal data beyond order tracking)
  const customerData = {
    request_id: `${shop}-${customerId}-${Date.now()}`,
    shop: shop,
    customer_id: customerId,
    customer_email: customerEmail,
    request_date: requestTimestamp,
    data_collected: 'No personal customer data stored beyond order tracking functionality',
    message: 'This app only accesses order and fulfillment data through Shopify APIs and does not store personal customer information in our database.',
    compliance_note: 'Data request will be completed within 30 days as required by privacy regulations'
  };
  
  // In production, you would:
  // 1. Store this request in a compliance tracking system
  // 2. Generate a comprehensive data export
  // 3. Provide the data to the merchant within 30 days
  
  console.log(`[GDPR] Data request acknowledged for customer: ${customerId}`);
  res.status(200).json({ 
    status: 'acknowledged',
    message: 'Data request received and will be processed within 30 days',
    request_id: customerData.request_id
  });
}
 
 // GDPR Customer Redact Handler
 async function handleCustomerRedact(req, res, shop, payload) {
   const customerId = payload.customer?.id;
   const customerEmail = payload.customer?.email;
   
   console.log(`[GDPR] Data redaction request received for shop: ${shop}`);
   console.log(`[GDPR] Customer ID: ${customerId}, Email: ${customerEmail}`);
   
   // Log the redaction request for compliance tracking
   const redactionTimestamp = new Date().toISOString();
   console.log(`[GDPR] Redaction request logged at: ${redactionTimestamp}`);
   
   // Since we don't store personal customer data in our database,
   // we acknowledge the request and log it for compliance
   const redactionRecord = {
     redaction_id: `${shop}-${customerId}-${Date.now()}`,
     shop: shop,
     customer_id: customerId,
     customer_email: customerEmail,
     redaction_date: redactionTimestamp,
     action_taken: 'No personal data to redact - app does not store customer personal information',
     compliance_note: 'Redaction request acknowledged and logged for compliance purposes'
   };
   
   console.log(`[GDPR] Data redaction acknowledged for customer: ${customerId}`);
   res.status(200).json({ 
     status: 'acknowledged',
     message: 'Customer data redaction request received and processed',
     redaction_id: redactionRecord.redaction_id,
     action: 'No personal customer data stored to redact'
   });
 }
 
 // GDPR Shop Redact Handler
 async function handleShopRedact(req, res, shop, payload) {
   const shopId = payload.shop_id;
   const shopDomain = payload.shop_domain || shop;
   
   console.log(`[GDPR] Shop data redaction request received for: ${shopDomain}`);
   console.log(`[GDPR] Shop ID: ${shopId}`);
   
   // Log the redaction request for compliance tracking
   const redactionTimestamp = new Date().toISOString();
   console.log(`[GDPR] Shop redaction request logged at: ${redactionTimestamp}`);
   
   // This webhook is called 48 hours after app uninstallation
   // Clean up all shop-related data from our database
   const deletedShops = await pool.query('DELETE FROM shops WHERE shop = $1 RETURNING *', [shopDomain]);
   const deletedCharges = await pool.query('DELETE FROM charges WHERE shop = $1 RETURNING *', [shopDomain]);
   
   const redactionRecord = {
     redaction_id: `shop-${shopId}-${Date.now()}`,
     shop_domain: shopDomain,
     shop_id: shopId,
     redaction_date: redactionTimestamp,
     shops_deleted: deletedShops.rowCount,
     charges_deleted: deletedCharges.rowCount,
     compliance_note: 'Shop data redaction completed 48 hours after uninstallation as required by Shopify'
   };
   
   console.log(`[GDPR] Shop data redaction completed for: ${shopDomain}`);
   console.log(`[GDPR] Deleted ${deletedShops.rowCount} shop records and ${deletedCharges.rowCount} charge records`);
   
   res.status(200).json({ 
     status: 'completed',
     message: 'Shop data redaction completed successfully',
     redaction_id: redactionRecord.redaction_id,
     records_deleted: {
       shops: deletedShops.rowCount,
       charges: deletedCharges.rowCount
     }
   });
 }
 
 // Keep individual endpoints for backward compatibility
 app.post('/webhooks/customers/data_request', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  // Verify Content-Type header as required by Shopify
  if (req.get('Content-Type') !== 'application/json') {
    console.log(`[GDPR] Invalid Content-Type for data request from shop: ${shop}`);
    return res.status(400).send('Invalid Content-Type');
  }
  
  try {
    const payload = JSON.parse(req.body);
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`[GDPR] Data request received for shop: ${shop}`);
    console.log(`[GDPR] Customer ID: ${customerId}, Email: ${customerEmail}`);
    
    // Log the request for compliance tracking
    const requestTimestamp = new Date().toISOString();
    console.log(`[GDPR] Data request logged at: ${requestTimestamp}`);
    
    // Collect customer data (we don't store personal data beyond order tracking)
    const customerData = {
      request_id: `${shop}-${customerId}-${Date.now()}`,
      shop: shop,
      customer_id: customerId,
      customer_email: customerEmail,
      request_date: requestTimestamp,
      data_collected: 'No personal customer data stored beyond order tracking functionality',
      message: 'This app only accesses order and fulfillment data through Shopify APIs and does not store personal customer information in our database.',
      compliance_note: 'Data request will be completed within 30 days as required by privacy regulations'
    };
    
    // In production, you would:
    // 1. Store this request in a compliance tracking system
    // 2. Generate a comprehensive data export
    // 3. Provide the data to the merchant within 30 days
    
    console.log(`[GDPR] Data request acknowledged for customer: ${customerId}`);
    res.status(200).json({ 
      status: 'acknowledged',
      message: 'Data request received and will be processed within 30 days',
      request_id: customerData.request_id
    });
  } catch (error) {
    console.error(`[GDPR] Error processing data request:`, error);
    res.status(500).json({ error: 'Error processing data request' });
  }
});

// GDPR Data Redaction Webhook
app.post('/webhooks/customers/redact', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  // Verify Content-Type header as required by Shopify
  if (req.get('Content-Type') !== 'application/json') {
    console.log(`[GDPR] Invalid Content-Type for redaction request from shop: ${shop}`);
    return res.status(400).send('Invalid Content-Type');
  }
  
  try {
    const payload = JSON.parse(req.body);
    const customerId = payload.customer?.id;
    const customerEmail = payload.customer?.email;
    
    console.log(`[GDPR] Data redaction request received for shop: ${shop}`);
    console.log(`[GDPR] Customer ID: ${customerId}, Email: ${customerEmail}`);
    
    // Log the redaction request for compliance tracking
    const redactionTimestamp = new Date().toISOString();
    console.log(`[GDPR] Redaction request logged at: ${redactionTimestamp}`);
    
    // Since we don't store personal customer data in our database,
    // we acknowledge the request and log it for compliance
    const redactionRecord = {
      redaction_id: `${shop}-${customerId}-${Date.now()}`,
      shop: shop,
      customer_id: customerId,
      customer_email: customerEmail,
      redaction_date: redactionTimestamp,
      action_taken: 'No personal data to redact - app does not store customer personal information',
      compliance_note: 'Redaction request acknowledged and logged for compliance purposes'
    };
    
    // In production, you would:
    // 1. Search all databases for customer data
    // 2. Delete or anonymize all personal information
    // 3. Log the redaction action for audit purposes
    // 4. Confirm completion within required timeframe
    
    console.log(`[GDPR] Data redaction acknowledged for customer: ${customerId}`);
    res.status(200).json({ 
      status: 'acknowledged',
      message: 'Customer data redaction request received and processed',
      redaction_id: redactionRecord.redaction_id,
      action: 'No personal customer data stored to redact'
    });
  } catch (error) {
    console.error(`[GDPR] Error processing redaction request:`, error);
    res.status(500).json({ error: 'Error processing redaction request' });
  }
});

// Shop Data Redaction Webhook (48 hours after uninstall)
app.post('/webhooks/shop/redact', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  // Verify Content-Type header as required by Shopify
  if (req.get('Content-Type') !== 'application/json') {
    console.log(`[GDPR] Invalid Content-Type for shop redaction request from shop: ${shop}`);
    return res.status(400).send('Invalid Content-Type');
  }
  
  try {
    const payload = JSON.parse(req.body);
    const shopId = payload.shop_id;
    const shopDomain = payload.shop_domain || shop;
    
    console.log(`[GDPR] Shop data redaction request received for: ${shopDomain}`);
    console.log(`[GDPR] Shop ID: ${shopId}`);
    
    // Log the redaction request for compliance tracking
    const redactionTimestamp = new Date().toISOString();
    console.log(`[GDPR] Shop redaction request logged at: ${redactionTimestamp}`);
    
    // This webhook is called 48 hours after app uninstallation
    // Clean up all shop-related data from our database
    const deletedShops = await pool.query('DELETE FROM shops WHERE shop = $1 RETURNING *', [shopDomain]);
    const deletedCharges = await pool.query('DELETE FROM charges WHERE shop = $1 RETURNING *', [shopDomain]);
    
    const redactionRecord = {
      redaction_id: `shop-${shopId}-${Date.now()}`,
      shop_domain: shopDomain,
      shop_id: shopId,
      redaction_date: redactionTimestamp,
      shops_deleted: deletedShops.rowCount,
      charges_deleted: deletedCharges.rowCount,
      compliance_note: 'Shop data redaction completed 48 hours after uninstallation as required by Shopify'
    };
    
    console.log(`[GDPR] Shop data redaction completed for: ${shopDomain}`);
    console.log(`[GDPR] Deleted ${deletedShops.rowCount} shop records and ${deletedCharges.rowCount} charge records`);
    
    res.status(200).json({ 
      status: 'completed',
      message: 'Shop data redaction completed successfully',
      redaction_id: redactionRecord.redaction_id,
      records_deleted: {
        shops: deletedShops.rowCount,
        charges: deletedCharges.rowCount
      }
    });
  } catch (error) {
    console.error(`[GDPR] Error processing shop redaction:`, error);
    res.status(500).json({ error: 'Error processing shop redaction request' });
  }
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      hasApiKey: !!process.env.SHOPIFY_API_KEY,
      hasWebhookSecret: !!process.env.SHOPIFY_WEBHOOK_SECRET,
      host: process.env.HOST,
      port: process.env.PORT
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[STARTUP] Environment variables check:`);
  console.log(`[STARTUP] NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`[STARTUP] HOST: ${process.env.HOST}`);
  console.log(`[STARTUP] BACKEND_URL: ${process.env.BACKEND_URL}`);
  console.log(`[STARTUP] FRONTEND_URL: ${process.env.FRONTEND_URL}`);
  console.log(`[STARTUP] SHOPIFY_API_KEY: ${process.env.SHOPIFY_API_KEY ? 'SET' : 'NOT SET'}`);
  console.log(`[STARTUP] SHOPIFY_API_SECRET: ${process.env.SHOPIFY_API_SECRET ? 'SET' : 'NOT SET'}`);
  console.log(`[STARTUP] DATABASE_URL: ${process.env.DATABASE_URL ? 'SET' : 'NOT SET'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});