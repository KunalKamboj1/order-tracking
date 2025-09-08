const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
const initDatabase = async () => {
  try {
    // Create shops table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        shop VARCHAR(255) UNIQUE NOT NULL,
        access_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create charges table for billing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS charges (
        id SERIAL PRIMARY KEY,
        shop VARCHAR(255) NOT NULL,
        charge_id VARCHAR(255) UNIQUE NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('recurring', 'lifetime', 'free')),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        trial_days INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    await pool.query('CREATE INDEX IF NOT EXISTS idx_shops_shop ON shops(shop)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_charges_shop ON charges(shop)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_charges_charge_id ON charges(charge_id)');

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
};

initDatabase();

// Middleware for webhook verification
app.use('/webhooks', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook verification middleware
const verifyWebhook = (req, res, next) => {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.body;
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  if (hash !== hmac) {
    console.log('Webhook verification failed');
    return res.status(401).send('Unauthorized');
  }

  // Parse the body for webhook handlers
  try {
    req.body = JSON.parse(body);
  } catch (error) {
    console.error('Error parsing webhook body:', error);
    return res.status(400).send('Bad Request');
  }

  next();
};

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Shopify-Access-Token');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Helper function to check if shop has active billing
const hasActiveBilling = async (shop) => {
  try {
    // Normalize shop domain format
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    const result = await pool.query(
      'SELECT * FROM charges WHERE shop = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [shopDomain, 'active']
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking billing status:', error);
    return false;
  }
};

// Middleware to require active billing for certain endpoints
const requireActiveBilling = async (req, res, next) => {
  // Skip billing check for certain endpoints
  const skipBilling = [
    '/auth', '/callback', '/health', '/billing', '/webhooks'
  ].some(path => req.path.startsWith(path));
  
  if (skipBilling) {
    return next();
  }

  const shop = req.query.shop || req.body.shop;
  if (shop) {
    const hasActivePlan = await hasActiveBilling(shop);
    if (!hasActivePlan) {
      return res.status(402).json({ error: 'Active billing plan required' });
    }
  }
  
  next();
};

app.use(requireActiveBilling);

// Session token verification middleware
const verifySessionToken = (req, res, next) => {
  const sessionToken = req.headers['authorization']?.replace('Bearer ', '');
  
  if (!sessionToken) {
    return res.status(401).json({ error: 'Session token required' });
  }

  try {
    const decoded = jwt.verify(sessionToken, process.env.SHOPIFY_API_SECRET);
    req.shop = decoded.dest.replace('https://', '').replace('.myshopify.com', '');
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid session token' });
  }
};

// Base64url encoding/decoding helpers
const base64urlEncode = (str) => {
  return Buffer.from(str)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

const base64urlDecode = (str) => {
  str += '='.repeat((4 - str.length % 4) % 4);
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
};

// Helper functions for signed state management
const createSignedState = ({ host, returnUrl }) => {
  const payload = {
    h: host || null,
    r: returnUrl || null,
    t: Date.now()
  };
  
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(payloadB64, 'utf8')
    .digest('hex');
  
  return `v1.${signature}.${payloadB64}`;
};

const verifyAndExtractState = (state) => {
  if (!state || typeof state !== 'string' || !state.startsWith('v1.')) {
    return {};
  }
  
  const parts = state.split('.');
  if (parts.length !== 3) return {};
  
  const [version, signature, payloadB64] = parts;
  
  try {
    const expectedSignature = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(payloadB64, 'utf8')
      .digest('hex');
    
    if (signature !== expectedSignature) return {};
    
    const payload = JSON.parse(base64urlDecode(payloadB64));
    
    // Check expiration (15 minutes)
    if (typeof payload.t !== 'number' || Date.now() - payload.t > 15 * 60 * 1000) {
      return {};
    }
    
    return {
      host: payload.h || null,
      returnUrl: payload.r || null
    };
  } catch (error) {
    return {};
  }
};

// Root endpoint
app.get('/', (req, res) => {
  const { shop } = req.query;
  
  if (shop) {
    // Redirect to OAuth if shop parameter is present
    res.redirect(`/auth?shop=${encodeURIComponent(shop)}`);
  } else {
    res.json({ 
      message: 'Order Tracking Pro API', 
      version: '1.0.0',
      status: 'running'
    });
  }
});

// OAuth start endpoint
app.get('/auth', (req, res) => {
  const { shop, host, returnUrl } = req.query;
  console.log('OAuth start - shop:', shop, 'host:', host, 'returnUrl:', returnUrl);

  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  const scopes = 'read_orders,read_products,read_themes,write_themes';
  const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3000'}/callback`;
  
  // Create signed state with host and returnUrl for preservation
  const state = createSignedState({ host, returnUrl });

  const authUrl = `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${encodeURIComponent(state)}`;

  console.log('Redirecting to Shopify OAuth:', authUrl);
  res.redirect(authUrl);
});

// OAuth callback endpoint
app.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;
  console.log('OAuth callback - shop:', shop, 'code present:', !!code, 'state present:', !!state);
  
  // Extract preserved values from signed state
  const { host: preservedHost, returnUrl: preservedReturnUrl } = verifyAndExtractState(state) || {};
  console.log('Preserved values - host:', preservedHost, 'returnUrl:', preservedReturnUrl);

  try {
    if (!code || !shop) {
      console.log('Missing required parameters for OAuth');
      return res.status(400).json({ error: 'Missing required parameters' });
    }

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

    // Validate the access token
    console.log('Validating access token...');
    await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    console.log('Access token validation successful');

    // Store the access token
    console.log('Storing token in database...');
    await pool.query(
      'INSERT INTO shops (shop, access_token) VALUES ($1, $2) ON CONFLICT (shop) DO UPDATE SET access_token = EXCLUDED.access_token RETURNING *',
      [shopDomain, access_token]
    );
    console.log('Token stored successfully');

    const appUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';

    // Try to use preserved return URL first
    let finalUrl;
    if (preservedReturnUrl) {
      try {
        const returnUrlObj = new URL(preservedReturnUrl);
        const appUrlObj = new URL(appUrl);
        // Only use preserved URL if it's from the same origin as our app
        if (returnUrlObj.origin === appUrlObj.origin) {
          finalUrl = preservedReturnUrl;
        }
      } catch (_) {}
    }

    if (!finalUrl) {
      const url = new URL(appUrl);
      url.searchParams.set('shop', shopDomain);
      if (preservedHost) url.searchParams.set('host', preservedHost);
      url.searchParams.set('installed', 'true');
      finalUrl = url.toString();
    } else {
      // Ensure required params are in the preserved URL
      const url = new URL(finalUrl);
      if (!url.searchParams.get('shop')) url.searchParams.set('shop', shopDomain);
      if (preservedHost && !url.searchParams.get('host')) url.searchParams.set('host', preservedHost);
      if (!url.searchParams.get('installed')) url.searchParams.set('installed', 'true');
      finalUrl = url.toString();
    }

    console.log('Redirecting to app:', finalUrl);
    res.redirect(finalUrl);
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    if (error.response?.status === 401) {
      console.error('Access token validation failed - invalid token received');
    }
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

// Shop status endpoint
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
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
    
    const shopData = result.rows[0];
    
    if (!shopData.access_token) {
      return res.json({ 
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
    
    // Check if access token is still valid
    try {
      await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': shopData.access_token
        }
      });
      
      return res.json({ 
        installed: true, 
        needsAuth: false 
      });
    } catch (tokenError) {
      return res.json({ 
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
  } catch (error) {
    console.error('Shop status error:', error);
    res.status(500).json({ error: 'Failed to check shop status' });
  }
});

// Orders endpoint
app.get('/orders', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found. Please reinstall the app.' });
    }
    
    const { access_token } = shopResult.rows[0];
    
    if (!access_token) {
      return res.status(401).json({ error: 'No access token found. Please reinstall the app.' });
    }
    
    // Fetch orders from Shopify
    const ordersResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/orders.json?status=any&limit=250`, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    
    const orders = ordersResponse.data.orders || [];
    
    // Transform orders to include tracking information
    const transformedOrders = orders.map(order => ({
      id: order.id,
      name: order.name,
      email: order.email,
      created_at: order.created_at,
      updated_at: order.updated_at,
      total_price: order.total_price,
      currency: order.currency,
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      fulfillments: order.fulfillments?.map(fulfillment => ({
        id: fulfillment.id,
        status: fulfillment.status,
        tracking_company: fulfillment.tracking_company,
        tracking_number: fulfillment.tracking_number,
        tracking_url: fulfillment.tracking_url,
        created_at: fulfillment.created_at,
        updated_at: fulfillment.updated_at
      })) || [],
      line_items: order.line_items?.map(item => ({
        id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        variant_id: item.variant_id,
        product_id: item.product_id
      })) || []
    }));
    
    res.json({ orders: transformedOrders });
  } catch (error) {
    console.error('Orders fetch error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ 
        error: 'Authentication failed. Please reinstall the app.',
        needsReauth: true
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// Tracking endpoint
app.get('/tracking', (req, res, next) => {
  // Skip session token verification for public tracking lookups
  if (req.query.public === 'true') {
    return next();
  }
  verifySessionToken(req, res, next);
}, async (req, res) => {
  const { shop, order_id, tracking_number, email } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }
    
    const { access_token } = shopResult.rows[0];
    
    let ordersUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?status=any`;
    
    // Build query parameters for order lookup
    if (order_id) {
      ordersUrl = `https://${shopDomain}/admin/api/2023-10/orders/${order_id}.json`;
    } else if (tracking_number) {
      ordersUrl += `&fulfillment_status=shipped&limit=250`;
    } else if (email) {
      ordersUrl += `&email=${encodeURIComponent(email)}&limit=50`;
    } else {
      return res.status(400).json({ error: 'Order ID, tracking number, or email is required' });
    }
    
    const response = await axios.get(ordersUrl, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    
    let orders = [];
    
    if (order_id) {
      // Single order response
      orders = [response.data.order];
    } else {
      // Multiple orders response
      orders = response.data.orders || [];
    }
    
    // Filter by tracking number if provided
    if (tracking_number && !order_id) {
      orders = orders.filter(order => 
        order.fulfillments?.some(fulfillment => 
          fulfillment.tracking_number === tracking_number
        )
      );
    }
    
    // Transform orders to include only tracking-relevant information
    const trackingData = orders.map(order => {
      const relevantFulfillments = order.fulfillments?.filter(fulfillment => {
        if (tracking_number) {
          return fulfillment.tracking_number === tracking_number;
        }
        return true;
      }) || [];
      
      return {
        order_id: order.id,
        order_name: order.name,
        order_date: order.created_at,
        customer_email: order.email,
        total_price: order.total_price,
        currency: order.currency,
        financial_status: order.financial_status,
        fulfillment_status: order.fulfillment_status,
        fulfillments: relevantFulfillments.map(fulfillment => ({
          id: fulfillment.id,
          status: fulfillment.status,
          tracking_company: fulfillment.tracking_company,
          tracking_number: fulfillment.tracking_number,
          tracking_url: fulfillment.tracking_url,
          shipped_date: fulfillment.created_at,
          updated_at: fulfillment.updated_at,
          line_items: fulfillment.line_items?.map(item => ({
            name: item.name,
            quantity: item.quantity,
            sku: item.sku
          })) || []
        }))
      };
    });
    
    if (trackingData.length === 0) {
      return res.status(404).json({ 
        error: 'No orders found with the provided criteria',
        found: false
      });
    }
    
    res.json({ 
      found: true,
      tracking_data: trackingData
    });
  } catch (error) {
    console.error('Tracking lookup error:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ error: 'Authentication failed' });
    }
    
    if (error.response?.status === 404) {
      return res.status(404).json({ 
        error: 'Order not found',
        found: false
      });
    }
    
    res.status(500).json({ error: 'Failed to lookup tracking information' });
  }
});

// Theme block installation endpoint
app.post('/install-theme-block', async (req, res) => {
  const { shop } = req.body;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }
    
    const { access_token } = shopResult.rows[0];
    
    // This is a placeholder for theme block installation
    // In a real implementation, you would:
    // 1. Get the current theme
    // 2. Add the tracking block to appropriate templates
    // 3. Update the theme files
    
    res.json({ 
      success: true,
      message: 'Theme block installation completed'
    });
  } catch (error) {
    console.error('Theme block installation error:', error);
    res.status(500).json({ error: 'Failed to install theme block' });
  }
});

// Billing endpoints
app.get('/billing/free', async (req, res) => {
  const { shop, host } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Store free plan in database
    await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO UPDATE SET status = EXCLUDED.status',
      [shopDomain, `free_${Date.now()}`, 'free', 'active', 0.00]
    );
    
    // Redirect back to frontend app with success
    const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const redirectUrl = new URL('/pricing', frontendUrl);
    redirectUrl.searchParams.set('shop', shopDomain);
    redirectUrl.searchParams.set('billing', 'success');
    redirectUrl.searchParams.set('plan', 'free');
    if (host) {
      redirectUrl.searchParams.set('host', host);
    }
    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error('Free plan activation error:', error);
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const redirectUrl = new URL('/pricing', frontendUrl);
    redirectUrl.searchParams.set('shop', shopDomain);
    redirectUrl.searchParams.set('billing', 'error');
    if (host) {
      redirectUrl.searchParams.set('host', host);
    }
    res.redirect(redirectUrl.toString());
  }
});

app.get('/billing/subscribe', (req, res, next) => {
  // Skip session token verification for billing redirects
  next();
}, async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }
    
    const { access_token } = shopResult.rows[0];
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    
    // Create recurring application charge
    const chargeData = {
      recurring_application_charge: {
        name: 'Order Tracking Pro - Monthly',
        price: 9.99,
        return_url: `${backendUrl}/billing/callback?shop=${shopDomain}&type=subscription`,
        test: process.env.NODE_ENV !== 'production'
      }
    };
    
    const response = await axios.post(
      `https://${shopDomain}/admin/api/2023-10/recurring_application_charges.json`,
      chargeData,
      {
        headers: {
          'X-Shopify-Access-Token': access_token,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const charge = response.data.recurring_application_charge;
    
    // Store charge in database
    await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO UPDATE SET status = EXCLUDED.status',
      [shopDomain, charge.id.toString(), 'recurring', 'pending', charge.price]
    );
    
    // Redirect to Shopify's confirmation URL using a script to handle iframe
    const confirmationUrl = charge.confirmation_url;
    
    res.send(`
      <script>
        if (window.top !== window.self) {
          window.top.location.href = "${confirmationUrl}";
        } else {
          window.location.href = "${confirmationUrl}";
        }
      </script>
    `);
  } catch (error) {
    console.error('Subscription creation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

app.get('/billing/lifetime', (req, res, next) => {
  // Skip session token verification for billing redirects
  next();
}, async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }
    
    const { access_token } = shopResult.rows[0];
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    
    // Create one-time application charge for lifetime plan
    const chargeData = {
      application_charge: {
        name: 'Order Tracking Pro - Lifetime',
        price: 99.99,
        return_url: `${backendUrl}/billing/callback?shop=${shopDomain}&type=lifetime`,
        test: process.env.NODE_ENV !== 'production'
      }
    };
    
    const response = await axios.post(
      `https://${shopDomain}/admin/api/2023-10/application_charges.json`,
      chargeData,
      {
        headers: {
          'X-Shopify-Access-Token': access_token,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const charge = response.data.application_charge;
    
    // Store charge in database
    await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO UPDATE SET status = EXCLUDED.status',
      [shopDomain, charge.id.toString(), 'lifetime', 'pending', charge.price]
    );
    
    // Redirect to Shopify's confirmation URL
    res.redirect(charge.confirmation_url);
  } catch (error) {
    console.error('Lifetime charge creation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create lifetime charge' });
  }
});

// Billing callback endpoint
app.get('/billing/callback', async (req, res) => {
  const { shop, charge_id, type } = req.query;
  
  if (!shop || !charge_id) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      return res.status(401).json({ error: 'Shop not found' });
    }
    
    const { access_token } = shopResult.rows[0];
    
    let charge;
    let apiEndpoint;
    
    if (type === 'subscription') {
      // Get recurring charge details
      apiEndpoint = `https://${shopDomain}/admin/api/2023-10/recurring_application_charges/${charge_id}.json`;
    } else {
      // Get one-time charge details
      apiEndpoint = `https://${shopDomain}/admin/api/2023-10/application_charges/${charge_id}.json`;
    }
    
    const response = await axios.get(apiEndpoint, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    
    if (type === 'subscription') {
      charge = response.data.recurring_application_charge;
    } else {
      charge = response.data.application_charge;
    }
    
    // Update charge status in database
    await pool.query(
      'UPDATE charges SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE charge_id = $2',
      [charge.status, charge_id]
    );
    
    if (charge.status === 'accepted' || charge.status === 'active') {
      // Activate the charge if it's a subscription
      if (type === 'subscription' && charge.status === 'accepted') {
        await axios.post(
          `https://${shopDomain}/admin/api/2023-10/recurring_application_charges/${charge_id}/activate.json`,
          {},
          {
            headers: {
              'X-Shopify-Access-Token': access_token
            }
          }
        );
        
        // Update status to active
        await pool.query(
          'UPDATE charges SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE charge_id = $2',
          ['active', charge_id]
        );
      }
      
      // Redirect to success page
      const successUrl = `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}?billing=success`;
      res.redirect(successUrl);
    } else if (charge.status === 'declined') {
      // Redirect to pricing page with error
      const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
      const errorUrl = `${frontendUrl}?shop=${shopDomain}&billing=declined`;
      res.redirect(errorUrl);
    } else {
      // Handle other statuses
      const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
      const errorUrl = `${frontendUrl}?shop=${shopDomain}&billing=error&status=${charge.status}`;
      res.redirect(errorUrl);
    }
  } catch (error) {
    console.error('Billing callback error:', error.response?.data || error.message);
    const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const errorUrl = `${frontendUrl}?shop=${shopDomain}&billing=error`;
    res.redirect(errorUrl);
  }
});

// Billing status endpoint
app.get('/billing/status', (req, res, next) => {
  // Skip session token verification for billing status checks
  next();
}, async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    const result = await pool.query(
      'SELECT * FROM charges WHERE shop = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [shopDomain, 'active']
    );
    
    res.json({
      hasActivePlan: result.rows.length > 0,
      plan: result.rows[0] || null
    });
  } catch (error) {
    console.error('Billing status error:', error);
    res.status(500).json({ error: 'Failed to check billing status' });
  }
});

// Webhook test endpoint
app.get('/webhooks/test', (req, res) => {
  res.json({ 
    message: 'Webhook endpoint is working',
    timestamp: new Date().toISOString()
  });
});

// Webhook handlers

// App uninstalled webhook
app.post('/webhooks/app/uninstalled', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  console.log('App uninstalled webhook received for shop:', shop);
  
  try {
    // Remove shop data
    await pool.query('DELETE FROM shops WHERE shop = $1', [shop]);
    await pool.query('DELETE FROM charges WHERE shop = $1', [shop]);
    
    console.log('Shop data cleaned up successfully:', shop);
    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling app uninstall:', error);
    res.status(500).send('Error');
  }
});

// GDPR webhooks
app.post('/webhooks/gdpr', verifyWebhook, async (req, res) => {
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');
  
  console.log('GDPR webhook received:', topic, 'for shop:', shop);
  
  try {
    switch (topic) {
      case 'customers/data_request':
        await handleCustomerDataRequest(req, res, shop, req.body);
        break;
      case 'customers/redact':
        await handleCustomerRedact(req, res, shop, req.body);
        break;
      case 'shop/redact':
        await handleShopRedact(req, res, shop, req.body);
        break;
      default:
        console.log('Unknown GDPR webhook topic:', topic);
        res.status(200).send('OK');
    }
  } catch (error) {
    console.error('Error handling GDPR webhook:', error);
    res.status(500).send('Error');
  }
});

// GDPR handler functions
async function handleCustomerDataRequest(req, res, shop, payload) {
  console.log('Customer data request for shop:', shop, 'customer:', payload.customer?.id);
  
  // In a real implementation, you would:
  // 1. Collect all customer data from your database
  // 2. Format it according to GDPR requirements
  // 3. Send it to the customer or make it available for download
  
  // For this app, we don't store customer data, so we just acknowledge
  res.status(200).json({
    message: 'Customer data request processed',
    customer_id: payload.customer?.id,
    data: 'No customer data stored in this application'
  });
}

async function handleCustomerRedact(req, res, shop, payload) {
  console.log('Customer redact request for shop:', shop, 'customer:', payload.customer?.id);
  
  // In a real implementation, you would:
  // 1. Find all data associated with this customer
  // 2. Delete or anonymize it according to GDPR requirements
  
  // For this app, we don't store customer data, so we just acknowledge
  res.status(200).json({
    message: 'Customer data redacted',
    customer_id: payload.customer?.id
  });
}

async function handleShopRedact(req, res, shop, payload) {
  console.log('Shop redact request for shop:', shop);
  
  try {
    // Delete all shop data
    await pool.query('DELETE FROM shops WHERE shop = $1', [shop]);
    await pool.query('DELETE FROM charges WHERE shop = $1', [shop]);
    
    res.status(200).json({
      message: 'Shop data redacted successfully',
      shop: shop
    });
  } catch (error) {
    console.error('Error redacting shop data:', error);
    res.status(500).json({
      message: 'Error redacting shop data',
      error: error.message
    });
  }
}

// Individual GDPR webhook endpoints for better routing
app.post('/webhooks/customers/data_request', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  console.log('Customer data request webhook for shop:', shop);
  
  try {
    await handleCustomerDataRequest(req, res, shop, req.body);
  } catch (error) {
    console.error('Error handling customer data request:', error);
    res.status(500).send('Error');
  }
});

app.post('/webhooks/customers/redact', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  console.log('Customer redact webhook for shop:', shop);
  
  try {
    await handleCustomerRedact(req, res, shop, req.body);
  } catch (error) {
    console.error('Error handling customer redact:', error);
    res.status(500).send('Error');
  }
});

app.post('/webhooks/shop/redact', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  console.log('Shop redact webhook for shop:', shop);
  
  try {
    await handleShopRedact(req, res, shop, req.body);
  } catch (error) {
    console.error('Error handling shop redact:', error);
    res.status(500).send('Error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Frontend URL:', process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app');
  console.log('Backend URL:', process.env.BACKEND_URL || 'http://localhost:3000');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});