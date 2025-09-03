const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  try {
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    
    // Create recurring charge via Shopify Billing API
    const chargeData = {
      recurring_application_charge: {
        name: 'Order Tracking Pro - Monthly',
        price: 15.00,
        trial_days: 3,
        test: true, // Set to false in production
        return_url: `${process.env.BACKEND_URL}/billing/callback?shop=${shop}&type=recurring`
      }
    };

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
    
    // Store charge in database
    await pool.query(
      'INSERT INTO charges (shop, charge_id, status, type, amount, trial_days) VALUES ($1, $2, $3, $4, $5, $6)',
      [shop, charge.id.toString(), 'pending', 'recurring', 15.00, 3]
    );

    // Redirect to Shopify's confirmation URL
    res.redirect(charge.confirmation_url);
    
  } catch (error) {
    console.error('Error creating recurring charge:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// Create lifetime charge ($150 one-time with 3-day trial)
app.get('/billing/lifetime', async (req, res) => {
  const { shop } = req.query;
  
  if (!shop) {
    return res.status(400).json({ error: 'Shop parameter is required' });
  }

  try {
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    
    // Create one-time charge via Shopify Billing API
    const chargeData = {
      application_charge: {
        name: 'Order Tracking Pro - Lifetime',
        price: 150.00,
        test: true, // Set to false in production
        return_url: `${process.env.BACKEND_URL}/billing/callback?shop=${shop}&type=lifetime`
      }
    };

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
    
    // Store charge in database
    await pool.query(
      'INSERT INTO charges (shop, charge_id, status, type, amount, trial_days) VALUES ($1, $2, $3, $4, $5, $6)',
      [shop, charge.id.toString(), 'pending', 'lifetime', 150.00, 3]
    );

    // Redirect to Shopify's confirmation URL
    res.redirect(charge.confirmation_url);
    
  } catch (error) {
    console.error('Error creating lifetime charge:', error);
    res.status(500).json({ error: 'Failed to create lifetime payment' });
  }
});

// Handle billing callback after merchant approval
app.get('/billing/callback', async (req, res) => {
  const { shop, type, charge_id } = req.query;
  
  if (!shop || !type) {
    return res.status(400).json({ error: 'Shop and type parameters are required' });
  }

  try {
    // Get shop's access token
    const shopResult = await pool.query('SELECT access_token FROM shops WHERE shop = $1', [shop]);
    if (shopResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const accessToken = shopResult.rows[0].access_token;
    let chargeStatus = 'declined';
    let actualChargeId = charge_id;

    if (type === 'recurring') {
      // Get recurring charge details
      const response = await axios.get(
        `https://${shop}/admin/api/2023-10/recurring_application_charges/${charge_id}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        }
      );
      
      const charge = response.data.recurring_application_charge;
      chargeStatus = charge.status;
      actualChargeId = charge.id.toString();
      
      // Activate recurring charge if accepted
      if (chargeStatus === 'accepted') {
        await axios.post(
          `https://${shop}/admin/api/2023-10/recurring_application_charges/${charge_id}/activate.json`,
          {},
          {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          }
        );
        chargeStatus = 'active';
      }
    } else if (type === 'lifetime') {
      // Get one-time charge details
      const response = await axios.get(
        `https://${shop}/admin/api/2023-10/application_charges/${charge_id}.json`,
        {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        }
      );
      
      const charge = response.data.application_charge;
      chargeStatus = charge.status;
      actualChargeId = charge.id.toString();
    }

    // Update charge status in database
    await pool.query(
      'UPDATE charges SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE shop = $2 AND charge_id = $3',
      [chargeStatus, shop, actualChargeId]
    );

    // Redirect based on status
    if (chargeStatus === 'active' || chargeStatus === 'accepted') {
      res.redirect(`${process.env.FRONTEND_URL}/?billing=success`);
    } else {
      res.redirect(`${process.env.FRONTEND_URL}/pricing?billing=declined`);
    }
    
  } catch (error) {
    console.error('Error handling billing callback:', error);
    res.redirect(`${process.env.FRONTEND_URL}/pricing?billing=error`);
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
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});