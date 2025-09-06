const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');
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
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  const body = req.body;
  const hash = crypto.createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET).update(body, 'utf8').digest('base64');
  
  if (hash === hmac) {
    next();
  } else {
    console.log('Webhook verification failed');
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

    // Store token in database
    console.log('Storing token in database...');
    const result = await pool.query(
      'INSERT INTO shops (shop, access_token) VALUES ($1, $2) ON CONFLICT (shop) DO UPDATE SET access_token = EXCLUDED.access_token RETURNING *',
      [shopDomain, access_token]
    );
    console.log('Database update result:', result.rows[0] ? 'Success' : 'Failed');

    res.json({ success: true, message: 'App installed successfully' });
  } catch (error) {
    console.error('OAuth callback error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to complete OAuth flow' });
  }
});

// Tracking endpoint
app.get('/tracking', async (req, res) => {
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
    console.log('Access token found:', accessToken ? 'Yes' : 'No');
    console.log('Access token (first 10 chars):', accessToken ? `${accessToken.substring(0, 10)}...` : 'None');

    // Test access token with a simple API call first
    try {
      console.log('Testing access token with shop info API...');
      const shopInfoResponse = await axios.get(`https://${shopDomain}/admin/api/2023-10/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': accessToken
        }
      });
      console.log('Access token test successful - shop name:', shopInfoResponse.data.shop?.name || 'Unknown');
    } catch (tokenTestError) {
      console.error('Access token test failed:', tokenTestError.response?.status, tokenTestError.response?.data || tokenTestError.message);
      return res.status(401).json({ error: 'Invalid or expired access token' });
    }

    let numericOrderId = order_id;
    
    // If order_id starts with "#", resolve it to numeric ID
    if (order_id.startsWith('#')) {
      console.log('Resolving order name to numeric ID:', order_id);
      
      // Try multiple approaches to find the order
      const orderName = order_id.substring(1); // Remove the # prefix
      
      // Fetch recent orders with limit and filter client-side to avoid fetching all orders
      let orderSearchUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?limit=50&status=any&fields=id,name,order_number`;
      console.log('Making order search request:', orderSearchUrl);
      
      try {
        const orderSearchResponse = await axios.get(orderSearchUrl, {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        });
        
        let orders = orderSearchResponse.data.orders || [];
        console.log('API returned', orders.length, 'orders, filtering for:', order_id);
        
        // Filter orders client-side to find exact match
        let matchedOrder = null;
        
        // Try to match by name field (with or without #)
        matchedOrder = orders.find(order => 
          order.name === order_id || 
          order.name === orderName ||
          order.order_number === orderName ||
          order.order_number === parseInt(orderName)
        );
        
        console.log('Matched order:', matchedOrder ? `ID: ${matchedOrder.id}, Name: ${matchedOrder.name}` : 'None');
        
        if (!matchedOrder) {
          // If not found in first 50, try with different status filters
          console.log('Order not found in recent orders, trying with all statuses...');
          orderSearchUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?limit=100&fields=id,name,order_number`;
          
          const orderSearchResponse2 = await axios.get(orderSearchUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          });
          
          orders = orderSearchResponse2.data.orders || [];
          console.log('Second API call returned', orders.length, 'orders');
          
          matchedOrder = orders.find(order => 
            order.name === order_id || 
            order.name === orderName ||
            order.order_number === orderName ||
            order.order_number === parseInt(orderName)
          );
        }
        
        const finalOrders = matchedOrder ? [matchedOrder] : [];
        console.log('Final filtered result:', finalOrders.length, 'orders');
        
        if (finalOrders.length === 0) {
          console.log('No order found with name:', order_id);
          return res.json({
            tracking_number: null,
            tracking_company: null,
            tracking_url: null,
            message: 'Order not found'
          });
        }
        
        numericOrderId = finalOrders[0].id;
        console.log('Resolved order name', order_id, 'to numeric ID:', numericOrderId);
        console.log('Matched order details:', finalOrders[0]);
        
      } catch (searchError) {
        console.error('Error searching for order by name:', searchError.message);
        return res.json({
          tracking_number: null,
          tracking_company: null,
          tracking_url: null,
          message: 'Error searching for order'
        });
      }
    }
    
    console.log('Using numeric order ID:', numericOrderId);

    // Call Shopify Admin API to get fulfillments
    const apiUrl = `https://${shopDomain}/admin/api/2023-10/orders/${numericOrderId}/fulfillments.json`;
    console.log('Making Shopify API request to:', apiUrl);
    console.log('Request headers:', {
      'X-Shopify-Access-Token': accessToken ? `${accessToken.substring(0, 10)}...` : 'None'
    });
    
    const fulfillmentsResponse = await axios.get(apiUrl, {
      headers: {
        'X-Shopify-Access-Token': accessToken
      }
    });
    
    console.log('Shopify API response status:', fulfillmentsResponse.status);
    console.log('Shopify API response data:', JSON.stringify(fulfillmentsResponse.data, null, 2));

    const fulfillments = fulfillmentsResponse.data.fulfillments;
    console.log('Fulfillment count returned:', fulfillments ? fulfillments.length : 0);
    
    if (!fulfillments || fulfillments.length === 0) {
      console.log('No fulfillments found, returning null values');
      return res.json({
        tracking_number: null,
        tracking_company: null,
        tracking_url: null,
        message: 'No tracking info found for this order'
      });
    }

    // Get the first fulfillment with tracking info
    const fulfillment = fulfillments.find(f => f.tracking_number) || fulfillments[0];
    console.log('Selected fulfillment:', JSON.stringify(fulfillment, null, 2));
    
    const responseData = {
      tracking_number: fulfillment.tracking_number || null,
      tracking_company: fulfillment.tracking_company || null,
      tracking_url: fulfillment.tracking_url || null
    };
    
    console.log('Sending response:', JSON.stringify(responseData, null, 2));
    res.json(responseData);

  } catch (error) {
    console.log('=== ERROR IN TRACKING ENDPOINT ===');
    console.error('Error message:', error.message);
    console.error('Error response status:', error.response?.status);
    console.error('Error response data:', JSON.stringify(error.response?.data, null, 2));
    console.error('Full error:', error);
    
    if (error.response?.status === 404) {
      console.log('Order not found (404 error)');
      return res.status(404).json({ error: 'Order not found' });
    }
    
    console.log('Returning 500 error');
    res.status(500).json({ error: 'Failed to fetch tracking information' });
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
app.get('/billing/subscribe', async (req, res) => {
  const { shop } = req.query;
  console.log(`[BILLING] Starting recurring subscription for shop: ${shop}`);
  console.log(`[BILLING] Request query params:`, req.query);
  console.log(`[BILLING] BACKEND_URL: ${process.env.BACKEND_URL}`);
  
  if (!shop) {
    console.log(`[BILLING] ERROR: Missing shop parameter`);
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  try {
    // Get shop's access token
    console.log(`[BILLING] Fetching access token for shop: ${shop}`);
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      console.log(`[BILLING] ERROR: Shop not found in database: ${shop}`);
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    console.log(`[BILLING] Access token retrieved for shop: ${shop}`);
    
    // Create recurring charge via Shopify Billing API
    const backendUrl = process.env.BACKEND_URL.endsWith('/') ? process.env.BACKEND_URL.slice(0, -1) : process.env.BACKEND_URL;
    const returnUrl = `${backendUrl}/billing/callback?shop=${shop}&type=recurring`;
    const chargeData = {
      recurring_application_charge: {
        name: 'Order Tracking Pro - Monthly',
        price: 15.00,
        trial_days: 3,
        test: true, // Set to false in production
        return_url: returnUrl
      }
    };
    
    console.log(`[BILLING] Creating recurring charge with data:`, JSON.stringify(chargeData, null, 2));
    console.log(`[BILLING] Return URL: ${returnUrl}`);
    console.log(`[BILLING] Shopify API URL: https://${shop}/admin/api/2023-10/recurring_application_charges.json`);

    const response = await axios.post(
      `https://${shop}/admin/api/2023-10/recurring_application_charges.json`,
      chargeData,
      {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      }
    );

    const charge = response.data.recurring_application_charge;
    console.log(`[BILLING] Shopify API response:`, JSON.stringify(charge, null, 2));
    
    // Store charge in database
    console.log(`[BILLING] Storing charge in database: ${charge.id}`);
    await pool.query(
      'INSERT INTO charges (shop, charge_id, status, type, amount, trial_days) VALUES ($1, $2, $3, $4, $5, $6)',
      [shop, charge.id.toString(), 'pending', 'recurring', 15.00, 3]
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
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Create lifetime charge ($150 one-time with 3-day trial)
app.get('/billing/lifetime', async (req, res) => {
  const { shop } = req.query;
  console.log(`[BILLING] Starting lifetime payment for shop: ${shop}`);
  console.log(`[BILLING] Request query params:`, req.query);
  console.log(`[BILLING] BACKEND_URL: ${process.env.BACKEND_URL}`);
  
  if (!shop) {
    console.log(`[BILLING] ERROR: Missing shop parameter`);
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  try {
    // Get shop's access token
    console.log(`[BILLING] Fetching access token for shop: ${shop}`);
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      console.log(`[BILLING] ERROR: Shop not found in database: ${shop}`);
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    console.log(`[BILLING] Access token retrieved for shop: ${shop}`);
    
    // Create one-time charge via Shopify Billing API
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
      [shop, charge.id.toString(), 'pending', 'lifetime', 150.00, 3]
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
    res.status(500).json({ error: 'Failed to create lifetime payment' });
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

// Billing status check endpoint
app.get('/billing/status', async (req, res) => {
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

// Webhook endpoint for app uninstallation
app.post('/webhooks/app/uninstalled', verifyWebhook, async (req, res) => {
  const shop = req.get('X-Shopify-Shop-Domain');
  
  console.log(`[WEBHOOK] App uninstalled for shop: ${shop}`);
  console.log(`[WEBHOOK] Webhook payload:`, req.body);
  
  try {
    // Clean up shop data from database
    await pool.query('DELETE FROM shops WHERE shop = $1', [shop]);
    await pool.query('DELETE FROM charges WHERE shop = $1', [shop]);
    
    console.log(`[WEBHOOK] Successfully cleaned up data for shop: ${shop}`);
    res.status(200).send('OK');
  } catch (error) {
    console.error(`[WEBHOOK] Error cleaning up data for shop ${shop}:`, error);
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