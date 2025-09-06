-- Migration: Add 'free' plan type to charges table
-- This migration updates the CHECK constraint to include 'free' as a valid type

-- Drop the existing constraint
ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_type_check;

-- Add the new constraint with 'free' included
ALTER TABLE charges ADD CONSTRAINT charges_type_check CHECK (type IN ('recurring', 'lifetime', 'free'));

-- Update any existing records if needed (optional)
-- This is safe to run even if no records exist
UPDATE charges SET type = 'free' WHERE type NOT IN ('recurring', 'lifetime', 'free');