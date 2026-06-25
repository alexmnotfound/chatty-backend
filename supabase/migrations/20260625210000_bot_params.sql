-- Add missing bot configuration columns
ALTER TABLE "bots"
  ADD COLUMN IF NOT EXISTS "greeting"       TEXT,
  ADD COLUMN IF NOT EXISTS "max_length"     TEXT NOT NULL DEFAULT 'short',
  ADD COLUMN IF NOT EXISTS "business_hours" JSONB,
  ADD COLUMN IF NOT EXISTS "human_handoff"  JSONB;
