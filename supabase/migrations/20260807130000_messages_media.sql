alter table messages
  add column if not exists media_url text,
  add column if not exists media_mime_type text;
