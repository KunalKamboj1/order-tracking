-- Migration: Create charges table for Shopify billing
-- This table stores billing information for each shop

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
);

-- Create index on shop for faster lookups
CREATE INDEX IF NOT EXISTS idx_charges_shop ON charges(shop);

-- Create index on charge_id for faster lookups during callbacks
CREATE INDEX IF NOT EXISTS idx_charges_charge_id ON charges(charge_id);

-- Create index on status for billing enforcement queries
CREATE INDEX IF NOT EXISTS idx_charges_status ON charges(status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_charges_updated_at 
    BEFORE UPDATE ON charges 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();