-- Migration: Add created_at and updated_at columns to shops table
-- This adds timestamp columns to track when shops are created and updated

-- Add created_at column if it doesn't exist
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add updated_at column if it doesn't exist
ALTER TABLE shops 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Update existing rows to have created_at timestamp (set to current time for existing records)
UPDATE shops 
SET created_at = CURRENT_TIMESTAMP 
WHERE created_at IS NULL;

-- Update existing rows to have updated_at timestamp
UPDATE shops 
SET updated_at = CURRENT_TIMESTAMP 
WHERE updated_at IS NULL;

-- Create trigger to automatically update updated_at column
CREATE TRIGGER IF NOT EXISTS update_shops_updated_at
    BEFORE UPDATE ON shops
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();