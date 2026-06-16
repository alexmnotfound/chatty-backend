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
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- company_members: see and manage members of own companies
CREATE POLICY "tenant isolation" ON company_members
  FOR ALL USING (company_id IN (SELECT user_company_ids()));

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
