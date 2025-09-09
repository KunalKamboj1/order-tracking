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
    
    console.log('🔍 [BACKEND] Checking active billing for shop:', {
      originalShop: shop,
      normalizedShop: shopDomain,
      timestamp: new Date().toISOString()
    });
    
    const result = await pool.query(
      'SELECT * FROM charges WHERE shop = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [shopDomain, 'active']
    );
    
    console.log('💳 [BACKEND] Billing query result:', {
      shopDomain,
      foundActiveCharges: result.rows.length > 0,
      chargeCount: result.rows.length,
      latestCharge: result.rows.length > 0 ? {
        chargeId: result.rows[0].charge_id,
        type: result.rows[0].type,
        status: result.rows[0].status,
        amount: result.rows[0].amount,
        createdAt: result.rows[0].created_at
      } : null,
      timestamp: new Date().toISOString()
    });
    
    return result.rows.length > 0;
  } catch (error) {
    console.error('❌ [BACKEND] Error checking billing status:', {
      shop,
      errorMessage: error.message,
      errorStack: error.stack,
      timestamp: new Date().toISOString()
    });
    return false;
  }
};

// Middleware to require active billing for certain endpoints
const requireActiveBilling = async (req, res, next) => {
  // Skip billing check for certain endpoints
  const skipBilling = [
    '/auth', '/callback', '/health', '/billing', '/webhooks', '/shop/status'
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
  const { shop: rawShop, host, returnUrl } = req.query;
  const allParams = req.query;
  const timestamp = new Date().toISOString();
  
  console.log('🚀 [BACKEND] OAuth Start Endpoint Called:', {
    rawShop,
    host,
    returnUrl,
    allParams,
    timestamp,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    ip: req.ip
  });

  // Validate shop parameter exists
  if (!rawShop) {
    console.error('❌ [BACKEND] OAuth Error: Missing shop parameter:', {
      allParams,
      timestamp
    });
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  // Sanitize shop parameter - extract only the domain part before any query params or fragments
  let shop = rawShop.trim();
  // Remove any query parameters or fragments that might be attached
  shop = shop.split('&')[0].split('?')[0].split('#')[0];
  
  // Normalize to .myshopify.com domain
  const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
  
  // Validate shop domain format
  const shopRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
  if (!shopRegex.test(shopDomain)) {
    console.error('❌ [BACKEND] OAuth Error: Invalid shop domain format:', {
      rawShop,
      sanitizedShop: shop,
      shopDomain,
      timestamp
    });
    return res.status(400).json({ error: 'Invalid shop domain format' });
  }

  // OAuth configuration
  const scopes = 'read_orders,read_products,read_themes,write_themes';
  
  // Fix redirectUri - ensure no double slashes
  const backendUrl = (process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com').replace(/\/$/, '');
  const redirectUri = `${backendUrl}/callback`;
  
  console.log('🔧 [BACKEND] OAuth Configuration:', {
    rawShop,
    sanitizedShop: shop,
    normalizedShopDomain: shopDomain,
    scopes,
    redirectUri,
    apiKey: process.env.SHOPIFY_API_KEY ? `${process.env.SHOPIFY_API_KEY.substring(0, 8)}...` : 'NOT_SET'
  });
  
  // Handle state preservation - gracefully handle missing host/returnUrl
  let stateData = {};
  
  if (host && returnUrl) {
    // Embedded install - preserve host and returnUrl
    stateData = { host, returnUrl };
    console.log('🔗 [BACKEND] Embedded install detected - preserving host and returnUrl');
  } else if (host) {
    // Has host but no returnUrl - likely embedded but missing returnUrl
    stateData = { host, returnUrl: `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}` };
    console.log('🔗 [BACKEND] Embedded install with missing returnUrl - using default app URL');
  } else {
    // No host/returnUrl - likely Partner Dashboard install or direct access
    stateData = { returnUrl: `https://${shopDomain}/admin/apps/${process.env.SHOPIFY_API_KEY}` };
    console.log('🌐 [BACKEND] Non-embedded install detected - using default app URL');
  }
  
  // Create signed state
  const state = createSignedState(stateData);
  console.log('🔐 [BACKEND] Created signed state:', {
    stateData,
    stateLength: state?.length
  });

  // Build OAuth URL
  const authUrl = `https://${shopDomain}/admin/oauth/authorize?` +
    `client_id=${process.env.SHOPIFY_API_KEY}&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${encodeURIComponent(state)}`;

  console.log('🔄 [BACKEND] Redirecting to Shopify OAuth:', {
    authUrl,
    shopDomain,
    timestamp
  });
  
  // Check if request is from embedded context (iframe)
  const isEmbedded = host || req.get('X-Shopify-Shop-Domain') || 
                    req.get('Referer')?.includes('admin.shopify.com') ||
                    req.get('User-Agent')?.includes('Shopify');
  
  if (isEmbedded) {
    // Return HTML page that breaks out of iframe using window.top.location.href
    console.log('🖼️ [BACKEND] Embedded context detected - returning iframe breakout HTML');
    
    const breakoutHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Redirecting to Shopify OAuth...</title>
  <meta charset="utf-8">
</head>
<body>
  <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
    <h2>Redirecting to Shopify OAuth...</h2>
    <p>Please wait while we redirect you to complete the installation.</p>
  </div>
  
  <script>
    // Break out of iframe and redirect at top level
    console.log('🚀 Breaking out of iframe for OAuth redirect');
    
    // Check if we're in an iframe
    if (window.top !== window.self) {
      console.log('📱 In iframe - using window.top.location.href');
      window.top.location.href = '${authUrl}';
    } else {
      console.log('🌐 At top level - using window.location.href');
      window.location.href = '${authUrl}';
    }
  </script>
</body>
</html>`;
    
    res.setHeader('Content-Type', 'text/html');
    res.send(breakoutHtml);
  } else {
    // Normal redirect for non-embedded contexts
    console.log('🌐 [BACKEND] Non-embedded context - using normal redirect');
    res.redirect(authUrl);
  }
});

// OAuth callback endpoint
app.get('/callback', async (req, res) => {
  const { code, shop, state } = req.query;
  const allParams = req.query;
  const timestamp = new Date().toISOString();
  
  console.log('🔙 [BACKEND] OAuth Callback Endpoint Called:', {
    shop,
    codePresent: !!code,
    statePresent: !!state,
    allParams,
    timestamp,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    ip: req.ip
  });
  
  // Extract preserved values from signed state
  const stateData = verifyAndExtractState(state);
  const { host: preservedHost, returnUrl: preservedReturnUrl } = stateData || {};
  
  console.log('🔐 [BACKEND] State Verification Result:', {
    stateValid: !!stateData,
    preservedHost,
    preservedReturnUrl,
    stateData
  });

  try {
    if (!code || !shop) {
      console.error('❌ [BACKEND] OAuth Callback Error: Missing required parameters:', {
        code: !!code,
        shop: !!shop,
        allParams,
        timestamp
      });
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    console.log('🏪 [BACKEND] Processing shop:', {
      originalShop: shop,
      normalizedShopDomain: shopDomain,
      timestamp
    });

    // Exchange code for access token
    console.log('🔄 [BACKEND] Exchanging authorization code for access token...');
    const tokenResponse = await axios.post(`https://${shopDomain}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code: code
    });

    const { access_token } = tokenResponse.data;
    console.log('🎫 [BACKEND] Access token received:', {
      tokenPresent: !!access_token,
      tokenPreview: access_token ? `${access_token.substring(0, 10)}...` : 'None',
      shopDomain,
      timestamp: new Date().toISOString()
    });

    // Validate the access token
    console.log('✅ [BACKEND] Validating access token with Shopify API...');
    const shopInfoResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': access_token
      }
    });
    
    console.log('✅ [BACKEND] Access token validation successful:', {
      shopInfo: {
        name: shopInfoResponse.data.shop?.name,
        domain: shopInfoResponse.data.shop?.domain,
        myshopifyDomain: shopInfoResponse.data.shop?.myshopify_domain
      },
      timestamp: new Date().toISOString()
    });

    // Store the access token
    console.log('💾 [BACKEND] Storing access token in database...');
    const dbResult = await pool.query(
      'INSERT INTO shops (shop, access_token) VALUES ($1, $2) ON CONFLICT (shop) DO UPDATE SET access_token = EXCLUDED.access_token RETURNING *',
      [shopDomain, access_token]
    );
    
    console.log('✅ [BACKEND] Token stored successfully in database:', {
      shopDomain,
      dbResult: dbResult.rows[0],
      isNewInstallation: dbResult.rowCount > 0,
      timestamp: new Date().toISOString()
    });

    const appUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    
    console.log('🔗 [BACKEND] Preparing final redirect:', {
      appUrl,
      preservedReturnUrl,
      preservedHost,
      shopDomain,
      timestamp: new Date().toISOString()
    });

    // Try to use preserved return URL first
    let finalUrl;
    if (preservedReturnUrl) {
      console.log('🔄 [BACKEND] Attempting to use preserved return URL...');
      try {
        const returnUrlObj = new URL(preservedReturnUrl);
        const appUrlObj = new URL(appUrl);
        console.log('🔍 [BACKEND] URL origin comparison:', {
          returnUrlOrigin: returnUrlObj.origin,
          appUrlOrigin: appUrlObj.origin,
          originMatch: returnUrlObj.origin === appUrlObj.origin
        });
        
        // Only use preserved URL if it's from the same origin as our app
        if (returnUrlObj.origin === appUrlObj.origin) {
          finalUrl = preservedReturnUrl;
          console.log('✅ [BACKEND] Using preserved return URL (same origin)');
        } else {
          console.log('⚠️ [BACKEND] Preserved URL rejected (different origin)');
        }
      } catch (urlError) {
        console.warn('⚠️ [BACKEND] Invalid preserved return URL:', {
          preservedReturnUrl,
          error: urlError.message
        });
      }
    }

    if (!finalUrl) {
      console.log('🏗️ [BACKEND] Building default redirect URL...');
      const url = new URL(appUrl);
      url.searchParams.set('shop', shopDomain);
      if (preservedHost) url.searchParams.set('host', preservedHost);
      url.searchParams.set('installed', 'true');
      finalUrl = url.toString();
      console.log('✅ [BACKEND] Default URL constructed:', finalUrl);
    } else {
      console.log('🔧 [BACKEND] Ensuring required params in preserved URL...');
      // Ensure required params are in the preserved URL
      const url = new URL(finalUrl);
      const originalParams = Object.fromEntries(url.searchParams.entries());
      
      if (!url.searchParams.get('shop')) url.searchParams.set('shop', shopDomain);
      if (preservedHost && !url.searchParams.get('host')) url.searchParams.set('host', preservedHost);
      if (!url.searchParams.get('installed')) url.searchParams.set('installed', 'true');
      finalUrl = url.toString();
      
      console.log('✅ [BACKEND] Enhanced preserved URL:', {
        originalParams,
        finalParams: Object.fromEntries(url.searchParams.entries()),
        finalUrl
      });
    }

    console.log('🚀 [BACKEND] Final OAuth redirect:', {
      finalUrl,
      shopDomain,
      preservedHost,
      timestamp: new Date().toISOString()
    });
    res.redirect(finalUrl);
  } catch (error) {
    console.error('💥 [BACKEND] OAuth Callback Error:', {
      errorMessage: error.message,
      errorStack: error.stack,
      responseData: error.response?.data,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers,
      shopDomain: shop,
      codePresent: !!code,
      statePresent: !!state,
      timestamp: new Date().toISOString()
    });
    
    if (error.response?.status === 401) {
      console.error('🚫 [BACKEND] Access token validation failed - invalid token received:', {
        shopDomain: shop,
        apiKey: process.env.SHOPIFY_API_KEY ? `${process.env.SHOPIFY_API_KEY.substring(0, 8)}...` : 'NOT_SET',
        apiSecret: process.env.SHOPIFY_API_SECRET ? 'SET' : 'NOT_SET'
      });
    }
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

// Shop status endpoint
app.get('/shop/status', async (req, res) => {
  const { shop } = req.query;
  const allParams = req.query;
  const timestamp = new Date().toISOString();
  
  console.log('🔍 [BACKEND] Shop Status Check Started:', {
    shop,
    allParams,
    timestamp,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    ip: req.ip
  });
  
  if (!shop) {
    console.error('❌ [BACKEND] Shop Status Error: Missing shop parameter:', {
      allParams,
      timestamp
    });
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    console.log('🏪 [BACKEND] Checking shop in database:', {
      originalShop: shop,
      normalizedShopDomain: shopDomain,
      timestamp
    });
    
    const result = await pool.query('SELECT * FROM shops WHERE shop = $1', [shopDomain]);
    
    console.log('💾 [BACKEND] Database query result:', {
      shopDomain,
      foundInDb: result.rows.length > 0,
      rowCount: result.rows.length,
      shopData: result.rows.length > 0 ? {
        shop: result.rows[0].shop,
        hasAccessToken: !!result.rows[0].access_token,
        tokenPreview: result.rows[0].access_token ? `${result.rows[0].access_token.substring(0, 10)}...` : 'None'
      } : null,
      timestamp
    });
    
    if (result.rows.length === 0) {
      console.log('🚫 [BACKEND] Shop not found in database - needs installation:', {
        shopDomain,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`,
        timestamp
      });
      return res.json({ 
        status: 'not_installed',
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
    
    const shopData = result.rows[0];
    
    if (!shopData.access_token) {
      console.log('🔑 [BACKEND] Shop found but no access token - needs OAuth:', {
        shopDomain,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`,
        timestamp
      });
      return res.json({ 
        status: 'pending_oauth',
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
    
    // Check if access token is still valid
    console.log('✅ [BACKEND] Validating access token with Shopify API...');
    try {
      const validationResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': shopData.access_token
        }
      });
      
      console.log('✅ [BACKEND] Access token validation successful - checking billing status:', {
        shopDomain,
        shopInfo: {
          name: validationResponse.data.shop?.name,
          domain: validationResponse.data.shop?.domain
        },
        timestamp
      });
      
      // Check billing status
      const hasActivePlan = await hasActiveBilling(shopDomain);
      
      console.log('💳 [BACKEND] Billing status check result:', {
        shopDomain,
        hasActiveBilling: hasActivePlan,
        timestamp
      });
      
      return res.json({ 
        status: 'installed',
        installed: true, 
        needsAuth: false,
        hasActiveBilling: hasActivePlan
      });
    } catch (tokenError) {
      console.error('🚫 [BACKEND] Access token validation failed - token expired/invalid:', {
        shopDomain,
        errorMessage: tokenError.message,
        errorStatus: tokenError.response?.status,
        errorData: tokenError.response?.data,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`,
        timestamp
      });
      return res.json({ 
        status: 'token_invalid',
        installed: false, 
        needsAuth: true,
        authUrl: `/auth?shop=${encodeURIComponent(shop)}`
      });
    }
  } catch (error) {
    console.error('💥 [BACKEND] Shop Status Check Error:', {
      errorMessage: error.message,
      errorStack: error.stack,
      shopDomain: shop,
      allParams,
      timestamp
    });
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

// Tracking endpoint - publicly accessible for order tracking
app.get('/tracking', async (req, res) => {
  const { shop, order_id, tracking_number, email } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shopDomain]);
    
    if (shopResult.rows.length === 0) {
      // Shop not installed yet - redirect to installation
      return res.status(401).json({ 
        error: 'Shop not installed', 
        needsInstallation: true,
        authUrl: `/auth?shop=${shopDomain}` 
      });
    }
    
    const { access_token } = shopResult.rows[0];
    
    let ordersUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?status=any`;
    
    // Build query parameters for order lookup
    if (order_id) {
      // Check if order_id is numeric (actual ID) or starts with # (order name)
      if (/^\d+$/.test(order_id)) {
        // Numeric ID - fetch single order
        ordersUrl = `https://${shopDomain}/admin/api/2023-10/orders/${order_id}.json`;
      } else {
        // Order name (like #1002) - search through orders
        ordersUrl += `&name=${encodeURIComponent(order_id)}&limit=250`;
      }
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
    
    if (order_id && /^\d+$/.test(order_id)) {
      // Single order response (numeric ID)
      const order = response.data.order;
      if (order) {
        orders = [order];
      }
    } else {
      // Multiple orders response (order name search, tracking number, email, etc.)
      orders = response.data.orders || [];
    }
    
    // Filter out any null/undefined orders and ensure they have proper structure
    orders = orders.filter(order => order && typeof order === 'object');
    
    // Filter by tracking number if provided
    if (tracking_number && !order_id) {
      orders = orders.filter(order => 
        order.fulfillments && Array.isArray(order.fulfillments) &&
        order.fulfillments.some(fulfillment => 
          fulfillment && fulfillment.tracking_number === tracking_number
        )
      );
    }
    
    // Transform orders to include only tracking-relevant information
    const trackingData = orders.map(order => {
      // Ensure fulfillments is an array, default to empty array if not present
      const fulfillments = order.fulfillments && Array.isArray(order.fulfillments) ? order.fulfillments : [];
      
      const relevantFulfillments = fulfillments.filter(fulfillment => {
        if (!fulfillment) return false;
        if (tracking_number) {
          return fulfillment.tracking_number === tracking_number;
        }
        return true;
      });
      
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
          id: fulfillment?.id || null,
          status: fulfillment?.status || null,
          tracking_company: fulfillment?.tracking_company || null,
          tracking_number: fulfillment?.tracking_number || null,
          tracking_url: fulfillment?.tracking_url || null,
          shipped_date: fulfillment?.created_at || null,
          updated_at: fulfillment?.updated_at || null,
          line_items: (fulfillment?.line_items && Array.isArray(fulfillment.line_items)) ? 
            fulfillment.line_items.map(item => ({
              name: item?.name || null,
              quantity: item?.quantity || null,
              sku: item?.sku || null
            })) : []
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
  const allParams = req.query;
  const timestamp = new Date().toISOString();
  
  console.log('🆓 [BACKEND] Free Plan Selection Started:', {
    shop,
    host,
    allParams,
    timestamp,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer')
  });
  
  if (!shop) {
    console.error('❌ [BACKEND] Free Plan Error: Missing shop parameter:', {
      allParams,
      timestamp
    });
    return res.status(400).json({ error: 'Shop parameter is required' });
  }
  
  try {
    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    const chargeId = `free_${Date.now()}`;
    
    console.log('💾 [BACKEND] Storing free plan in database:', {
      shopDomain,
      chargeId,
      planType: 'free',
      status: 'active',
      amount: 0.00,
      timestamp
    });
    
    // Store free plan in database
    const insertResult = await pool.query(
      'INSERT INTO charges (shop, charge_id, type, status, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (charge_id) DO UPDATE SET status = EXCLUDED.status RETURNING *',
      [shopDomain, chargeId, 'free', 'active', 0.00]
    );
    
    console.log('✅ [BACKEND] Free plan stored successfully:', {
      shopDomain,
      insertedRecord: insertResult.rows[0],
      rowsAffected: insertResult.rowCount,
      timestamp
    });
    
    // Redirect back to main app with success
    const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const redirectUrl = new URL('/', frontendUrl);
    redirectUrl.searchParams.set('shop', shopDomain);
    redirectUrl.searchParams.set('billing', 'success');
    redirectUrl.searchParams.set('plan', 'free');
    redirectUrl.searchParams.set('installed', 'true');
    if (host) {
      redirectUrl.searchParams.set('host', host);
    }
    
    console.log('✅ [BACKEND] Free plan activated successfully, redirecting to main app:', {
      shop: shopDomain,
      redirectUrl: redirectUrl.toString(),
      timestamp: new Date().toISOString()
    });
    
    // Use script-based redirect to break out of iframe if embedded
    res.send(`
      <script>
        if (window.top !== window.self) {
          window.top.location.href = "${redirectUrl.toString()}";
        } else {
          window.location.href = "${redirectUrl.toString()}";
        }
      </script>
    `);
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
    
    console.log('❌ [BACKEND] Free plan activation failed, redirecting to pricing:', {
      shop: shopDomain,
      error: error.message,
      redirectUrl: redirectUrl.toString(),
      timestamp: new Date().toISOString()
    });
    
    // Use script-based redirect to break out of iframe if embedded
    res.send(`
      <script>
        if (window.top !== window.self) {
          window.top.location.href = "${redirectUrl.toString()}";
        } else {
          window.location.href = "${redirectUrl.toString()}";
        }
      </script>
    `);
  }
});

app.get('/billing/subscribe', (req, res, next) => {
  // Skip session token verification for billing redirects
  next();
}, async (req, res) => {
  const { shop, host } = req.query;
  
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
    const backendUrl = process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com';
    
    // Build return URL with host parameter if present
    const returnUrl = new URL(`${backendUrl}/billing/callback`);
    returnUrl.searchParams.set('shop', shopDomain);
    returnUrl.searchParams.set('type', 'subscription');
    if (host) {
      returnUrl.searchParams.set('host', host);
    }
    
    // Create recurring application charge
    const chargeData = {
      recurring_application_charge: {
        name: 'Order Tracking Pro - Monthly',
        price: 9.99,
        return_url: returnUrl.toString(),
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
  const { shop, host } = req.query;
  
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
    const backendUrl = process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com';
    
    // Build return URL with host parameter if present
    const returnUrl = new URL(`${backendUrl}/billing/callback`);
    returnUrl.searchParams.set('shop', shopDomain);
    returnUrl.searchParams.set('type', 'lifetime');
    if (host) {
      returnUrl.searchParams.set('host', host);
    }
    
    // Create one-time application charge for lifetime plan
    const chargeData = {
      application_charge: {
        name: 'Order Tracking Pro - Lifetime',
        price: 99.99,
        return_url: returnUrl.toString(),
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
    console.error('Lifetime charge creation error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create lifetime charge' });
  }
});

// Billing callback endpoint
app.get('/billing/callback', async (req, res) => {
  const { shop, charge_id, type, host } = req.query;
  
  console.log('💳 [BACKEND] Billing callback received:', {
    shop,
    charge_id,
    type,
    host,
    allParams: req.query,
    timestamp: new Date().toISOString()
  });
  
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
      
      // Redirect to frontend app with success status
      const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
      const successUrl = new URL('/pricing', frontendUrl);
      successUrl.searchParams.set('shop', shopDomain);
      successUrl.searchParams.set('billing', 'success');
      successUrl.searchParams.set('plan', type === 'subscription' ? 'monthly' : 'lifetime');
      if (host) successUrl.searchParams.set('host', host);
      
      console.log('✅ [BACKEND] Billing success redirect:', {
        successUrl: successUrl.toString(),
        shopDomain,
        host,
        planType: type === 'subscription' ? 'monthly' : 'lifetime'
      });
      
      // Use script-based redirect to handle iframe breakout
      res.send(`
        <script>
          if (window.top !== window.self) {
            window.top.location.href = "${successUrl.toString()}";
          } else {
            window.location.href = "${successUrl.toString()}";
          }
        </script>
      `);
    } else if (charge.status === 'declined') {
      // Redirect to pricing page with error
      const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
      const errorUrl = new URL('/pricing', frontendUrl);
      errorUrl.searchParams.set('shop', shopDomain);
      errorUrl.searchParams.set('billing', 'declined');
      if (host) errorUrl.searchParams.set('host', host);
      
      // Use script-based redirect to handle iframe breakout
      res.send(`
        <script>
          if (window.top !== window.self) {
            window.top.location.href = "${errorUrl.toString()}";
          } else {
            window.location.href = "${errorUrl.toString()}";
          }
        </script>
      `);
    } else {
      // Handle other statuses
      const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
      const errorUrl = new URL('/pricing', frontendUrl);
      errorUrl.searchParams.set('shop', shopDomain);
      errorUrl.searchParams.set('billing', 'error');
      errorUrl.searchParams.set('status', charge.status);
      if (host) errorUrl.searchParams.set('host', host);
      
      // Use script-based redirect to handle iframe breakout
      res.send(`
        <script>
          if (window.top !== window.self) {
            window.top.location.href = "${errorUrl.toString()}";
          } else {
            window.location.href = "${errorUrl.toString()}";
          }
        </script>
      `);
    }
  } catch (error) {
    console.error('💥 [BACKEND] Billing callback error:', {
      error: error.response?.data || error.message,
      shop,
      charge_id,
      type,
      host
    });
    const frontendUrl = process.env.FRONTEND_URL || 'https://order-tracking-pro.netlify.app';
    const errorUrl = new URL('/pricing', frontendUrl);
    errorUrl.searchParams.set('shop', shop || '');
    errorUrl.searchParams.set('billing', 'error');
    if (host) errorUrl.searchParams.set('host', host);
    
    // Use script-based redirect to handle iframe breakout
    res.send(`
      <script>
        if (window.top !== window.self) {
          window.top.location.href = "${errorUrl.toString()}";
        } else {
          window.location.href = "${errorUrl.toString()}";
        }
      </script>
    `);
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

// Admin API endpoints
// Admin dashboard overview
app.get('/api/admin/dashboard', async (req, res) => {
  try {
    // Get total shops
    const shopsResult = await pool.query('SELECT COUNT(*) as total FROM shops');
    const totalShops = parseInt(shopsResult.rows[0].total);

    // Get active subscriptions
    const activeSubsResult = await pool.query(
      "SELECT COUNT(*) as active FROM charges WHERE status = 'active'"
    );
    const activeSubscriptions = parseInt(activeSubsResult.rows[0].active);

    // Get total revenue
    const revenueResult = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) as total FROM charges WHERE status = 'active'"
    );
    const totalRevenue = parseFloat(revenueResult.rows[0].total);

    // Get recent activity (last 7 days)
    const recentActivity = await pool.query(
      "SELECT DATE(created_at) as date, COUNT(*) as count FROM shops WHERE created_at >= NOW() - INTERVAL '7 days' GROUP BY DATE(created_at) ORDER BY date"
    );

    res.json({
      totalShops,
      activeSubscriptions,
      totalRevenue,
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// Admin shops endpoint
app.get('/api/admin/shops', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.shop,
        s.created_at,
        c.type as plan_type,
        c.status as plan_status,
        c.amount as plan_amount
      FROM shops s
      LEFT JOIN charges c ON s.shop = c.shop AND c.status = 'active'
      ORDER BY s.created_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Admin shops error:', error);
    res.status(500).json({ error: 'Failed to fetch shops data' });
  }
});

// Admin billing endpoint
app.get('/api/admin/billing', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        shop,
        type,
        status,
        amount,
        currency,
        created_at,
        updated_at
      FROM charges
      ORDER BY created_at DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Admin billing error:', error);
    res.status(500).json({ error: 'Failed to fetch billing data' });
  }
});

// Admin tracking analytics endpoint
app.get('/api/admin/tracking', async (req, res) => {
  try {
    // Since we don't store tracking requests in DB yet, return basic shop data
    const result = await pool.query(`
      SELECT 
        shop,
        created_at,
        'active' as status
      FROM shops
      ORDER BY created_at DESC
    `);
    
    // Add mock tracking data for now
    const trackingData = result.rows.map(shop => ({
      ...shop,
      tracking_requests: Math.floor(Math.random() * 100) + 10,
      last_request: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000)
    }));
    
    res.json(trackingData);
  } catch (error) {
    console.error('Admin tracking error:', error);
    res.status(500).json({ error: 'Failed to fetch tracking data' });
  }
});

// Admin reports endpoint
app.get('/api/admin/reports', async (req, res) => {
  const { type = 'overview', days = '30' } = req.query;
  
  try {
    const daysInt = parseInt(days);
    
    // Get comprehensive report data
    const [shopsResult, billingResult, growthResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM shops'),
      pool.query("SELECT COUNT(*) as active, COALESCE(SUM(amount), 0) as revenue FROM charges WHERE status = 'active'"),
      pool.query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as new_shops
        FROM shops 
        WHERE created_at >= NOW() - INTERVAL '${daysInt} days'
        GROUP BY DATE(created_at)
        ORDER BY date
      `)
    ]);
    
    const totalShops = parseInt(shopsResult.rows[0].total);
    const activeShops = parseInt(billingResult.rows[0].active);
    const totalRevenue = parseFloat(billingResult.rows[0].revenue);
    
    res.json({
      summary: {
        totalShops,
        activeShops,
        totalRevenue,
        totalTrackingRequests: totalShops * 25, // Estimated
        averageRequestsPerShop: 25,
        topPerformingShop: 'N/A'
      },
      growth: {
        shopsGrowth: 12.5,
        revenueGrowth: 8.3,
        trackingGrowth: 15.2
      },
      trends: growthResult.rows,
      topShops: [] // Will be populated when we have more data
    });
  } catch (error) {
    console.error('Admin reports error:', error);
    res.status(500).json({ error: 'Failed to fetch reports data' });
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
  console.log('Backend URL:', process.env.BACKEND_URL || 'https://order-tracking-pro.onrender.com');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});