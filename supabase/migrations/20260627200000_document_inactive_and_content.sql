-- Add 'inactive' status for soft-disabling documents
alter table bot_documents drop constraint bot_documents_status_check;
alter table bot_documents add constraint bot_documents_status_check
  check (status in ('processing', 'active', 'inactive', 'error'));

-- Store original text for paste-type docs (enables editing)
alter table bot_documents add column if not exists content text;

-- Update match_chunks to skip inactive documents
create or replace function match_chunks(
  query_embedding extensions.vector(1536),
  match_bot_id    uuid,
  match_count     int default 5
)
returns table (content text, similarity float)
language plpgsql as $$
begin
  return query
  select dc.content,
         1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  join bot_documents bd on bd.id = dc.document_id
  where dc.bot_id = match_bot_id
    and bd.status = 'active'
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;
