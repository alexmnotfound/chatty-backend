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
