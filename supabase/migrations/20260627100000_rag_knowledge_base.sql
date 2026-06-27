create extension if not exists vector;

drop table if exists document_chunks cascade;
drop table if exists bot_documents cascade;

create table bot_documents (
  id          uuid primary key default gen_random_uuid(),
  bot_id      uuid not null references bots(id) on delete cascade,
  company_id  uuid not null,
  name        text not null,
  source_type text not null check (source_type in ('pdf', 'txt', 'paste')),
  size_bytes  int,
  status      text not null default 'processing'
              check (status in ('processing', 'active', 'error')),
  created_at  timestamptz default now()
);

create table document_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references bot_documents(id) on delete cascade,
  bot_id       uuid not null references bots(id) on delete cascade,
  company_id   uuid not null,
  content      text not null,
  embedding    extensions.vector(1536),
  chunk_index  int not null,
  created_at   timestamptz default now()
);

create index on document_chunks (bot_id);
create index on document_chunks using hnsw (embedding extensions.vector_cosine_ops);

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
  where dc.bot_id = match_bot_id
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;
