-- One-off data reshape, not a schema change (extracted is jsonb) — not
-- tracked in supabase_migrations. Remaps the old 8-field extraction shape
-- to the new 12-field origen/destino shape:
--   cuit         -> cuit_remitente
--   cbu_alias    -> cbu_alias_destino
--   banco_origen -> banco_remitente
--   + adds coelsa_id, destinatario, cuit_destinatario, banco_destinatario
--     as empty placeholders (not present in the old shape, cannot backfill).
update receipts
set extracted =
  (extracted - 'cuit' - 'cbu_alias' - 'banco_origen')
  || jsonb_build_object(
    'cuit_remitente', coalesce(extracted->'cuit', '{"value":null,"confidence":"baja"}'::jsonb),
    'cbu_alias_destino', coalesce(extracted->'cbu_alias', '{"value":null,"confidence":"baja"}'::jsonb),
    'banco_remitente', coalesce(extracted->'banco_origen', '{"value":null,"confidence":"baja"}'::jsonb),
    'coelsa_id', '{"value":null,"confidence":"baja"}'::jsonb,
    'destinatario', '{"value":null,"confidence":"baja"}'::jsonb,
    'cuit_destinatario', '{"value":null,"confidence":"baja"}'::jsonb,
    'banco_destinatario', '{"value":null,"confidence":"baja"}'::jsonb
  )
where extracted ? 'cuit' or extracted ? 'cbu_alias' or extracted ? 'banco_origen';
