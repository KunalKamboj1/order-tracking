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

// Create shops table if it doesn't exist
const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shops (
        id SERIAL PRIMARY KEY,
        shop TEXT UNIQUE,
        access_token TEXT
      )
    `);
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
      
      // First try: Search by order number without #
      let orderSearchUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?name=${orderName}&status=any`;
      console.log('Making order search request (attempt 1):', orderSearchUrl);
      
      try {
        const orderSearchResponse = await axios.get(orderSearchUrl, {
          headers: {
            'X-Shopify-Access-Token': accessToken
          }
        });
        
        let orders = orderSearchResponse.data.orders;
        
        // If no orders found, try with # prefix
        if (!orders || orders.length === 0) {
          orderSearchUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?name=${encodeURIComponent(order_id)}&status=any`;
          console.log('Making order search request (attempt 2):', orderSearchUrl);
          
          const orderSearchResponse2 = await axios.get(orderSearchUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          });
          
          orders = orderSearchResponse2.data.orders;
        }
        
        // If still no orders, try searching by order_number field
        if (!orders || orders.length === 0) {
          orderSearchUrl = `https://${shopDomain}/admin/api/2023-10/orders.json?order_number=${orderName}&status=any`;
          console.log('Making order search request (attempt 3):', orderSearchUrl);
          
          const orderSearchResponse3 = await axios.get(orderSearchUrl, {
            headers: {
              'X-Shopify-Access-Token': accessToken
            }
          });
          
          orders = orderSearchResponse3.data.orders;
        }
        console.log('Order search returned', orders.length, 'orders');
        
        if (orders.length === 0) {
          console.log('No order found with name:', order_id);
          return res.json({
            tracking_number: null,
            tracking_company: null,
            tracking_url: null,
            message: 'Order not found'
          });
        }
        
        numericOrderId = orders[0].id;
        console.log('Resolved order name', order_id, 'to numeric ID:', numericOrderId);
        
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

// Health check endpoint
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