-- Local-dev config gap: the remote project has pgvector installed in the
-- `extensions` schema (as Supabase's platform does by convention), but a
-- fresh local `supabase db reset` installs it wherever `create extension
-- if not exists vector;` lands (public) unless a schema is specified here
-- first. This makes `extensions.vector(1536)` (used by the RAG migrations
-- below) resolve locally the same way it already does on remote.
create extension if not exists vector with schema extensions;
