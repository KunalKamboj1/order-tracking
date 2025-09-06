const { Pool } = require('pg');
require('dotenv').config();

// For production Render database, we need to handle SSL properly
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('DATABASE_URL configured:', process.env.DATABASE_URL ? 'Yes' : 'No');
if (process.env.DATABASE_URL) {
  const url = new URL(process.env.DATABASE_URL);
  console.log('Database host:', url.hostname);
  console.log('Database port:', url.port);
  console.log('Database name:', url.pathname.substring(1));
}

async function checkTokens() {
  try {
    console.log('=== DATABASE TOKEN CHECK ===');
    
    // Check if shops table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'shops'
      );
    `);
    
    console.log('Shops table exists:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      console.log('ERROR: shops table does not exist!');
      return;
    }
    
    // Get all shops and their token status
    const result = await pool.query(`
      SELECT 
        shop,
        CASE 
          WHEN access_token IS NOT NULL THEN 'Present' 
          ELSE 'Missing' 
        END as token_status,
        CASE 
          WHEN access_token IS NOT NULL THEN LENGTH(access_token) 
          ELSE 0 
        END as token_length
      FROM shops 
      ORDER BY shop;
    `);
    
    console.log('\n=== SHOPS AND TOKENS ===');
    console.log('Total shops found:', result.rows.length);
    
    if (result.rows.length === 0) {
      console.log('No shops found in database!');
    } else {
      console.log('\nShop Details:');
      result.rows.forEach((row, index) => {
        console.log(`${index + 1}. Shop: ${row.shop}`);
        console.log(`   Token Status: ${row.token_status}`);
        console.log(`   Token Length: ${row.token_length}`);
        console.log('');
      });
    }
    
    // Check table structure
    console.log('=== TABLE STRUCTURE ===');
    const structure = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'shops' 
      ORDER BY ordinal_position;
    `);
    
    console.log('Shops table columns:');
    structure.rows.forEach(col => {
      console.log(`- ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
    });
    
  } catch (error) {
    console.error('Database check error:', error);
  } finally {
    await pool.end();
  }
}

checkTokens();