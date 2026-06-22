-- === RLS ===
-- backend/supabase/rls.sql
-- Run this in Supabase SQL editor after schema migration
-- Tables are created by Prisma migrations — this file adds RLS + Realtime

-- Enable RLS
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE bots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Helper: returns set of company_ids the current user belongs to
CREATE OR REPLACE FUNCTION user_company_ids()
RETURNS SETOF uuid AS $$
  SELECT company_id FROM company_members WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- companies: users see their own company only
CREATE POLICY "members see own company" ON companies
  FOR SELECT USING (id IN (SELECT user_company_ids()));

-- Allow insert during registration (new company creation before member row exists)
CREATE POLICY "allow insert for authenticated" ON companies
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "members update own company" ON companies
  FOR UPDATE USING (id IN (SELECT user_company_ids()))
  WITH CHECK (id IN (SELECT user_company_ids()));

-- company_members: see and manage members of own companies
CREATE POLICY "tenant select" ON company_members
  FOR SELECT USING (company_id IN (SELECT user_company_ids()));

CREATE POLICY "tenant update" ON company_members
  FOR UPDATE USING (company_id IN (SELECT user_company_ids()))
  WITH CHECK (company_id IN (SELECT user_company_ids()));

CREATE POLICY "tenant delete" ON company_members
  FOR DELETE USING (company_id IN (SELECT user_company_ids()));

-- Allow insert for self-registration (user inserts their own membership)
CREATE POLICY "allow self insert" ON company_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- bots
CREATE POLICY "tenant isolation" ON bots
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

-- bot_examples
CREATE POLICY "tenant isolation" ON bot_examples
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

-- contacts
CREATE POLICY "tenant isolation" ON contacts
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

-- conversations
CREATE POLICY "tenant isolation" ON conversations
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

-- messages
CREATE POLICY "tenant isolation" ON messages
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

-- Enable Realtime for inbox
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- === OBSERVABILITY ===
-- Daily token aggregation per company
-- Run in Supabase SQL editor before using the observability dashboard
CREATE OR REPLACE FUNCTION observability_daily(p_company_id uuid, p_since timestamptz)
RETURNS TABLE(date text, tokens_in bigint, tokens_out bigint, cost_usd numeric, message_count bigint)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    to_char(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') as date,
    COALESCE(SUM(tokens_in), 0)::bigint,
    COALESCE(SUM(tokens_out), 0)::bigint,
    COALESCE(SUM(cost_usd), 0),
    COUNT(*)::bigint
  FROM messages
  WHERE company_id = p_company_id AND created_at >= p_since
  GROUP BY 1
  ORDER BY 1;
$$;

-- Per-bot aggregation
CREATE OR REPLACE FUNCTION observability_by_bot(p_company_id uuid, p_since timestamptz)
RETURNS TABLE(bot_name text, tokens_total bigint, cost_usd numeric)
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    b.name as bot_name,
    COALESCE(SUM(m.tokens_in) + SUM(m.tokens_out), 0)::bigint as tokens_total,
    COALESCE(SUM(m.cost_usd), 0) as cost_usd
  FROM messages m
  JOIN bots b ON b.id = m.bot_id
  WHERE m.company_id = p_company_id AND m.created_at >= p_since AND m.bot_id IS NOT NULL
  GROUP BY b.name
  ORDER BY tokens_total DESC;
$$;
