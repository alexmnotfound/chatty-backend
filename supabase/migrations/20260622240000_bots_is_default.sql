ALTER TABLE bots ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Only one default bot per company
CREATE UNIQUE INDEX bots_company_default_unique
  ON bots (company_id)
  WHERE is_default = true;
