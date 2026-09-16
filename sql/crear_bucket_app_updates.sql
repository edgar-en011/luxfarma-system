-- Bucket público para electron-updater (latest.yml + instaladores NSIS).
-- Correr una vez en el SQL Editor de Supabase.
-- La subida de archivos sigue haciéndose con SUPABASE_SERVICE_ROLE_KEY
-- desde `npm run electron:publish` (nunca desde el instalador).

insert into storage.buckets (id, name, public, file_size_limit)
values ('app-updates', 'app-updates', true, 230686720)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit;
