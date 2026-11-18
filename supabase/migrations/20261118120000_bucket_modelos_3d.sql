-- =====================================================================================
-- Migración 20261118120000_bucket_modelos_3d
-- Objetivo: guardar en un lugar propio los modelos 3D (GLB) que genera Tripo. Los enlaces de Tripo
-- vencen a los pocos minutos; el servidor descarga cada modelo terminado y lo sube a este bucket.
--   * Bucket "modelos-3d": público de LECTURA (la tienda muestra los modelos con su URL pública),
--     50 MB por archivo como máximo y solo archivos model/gltf-binary (.glb).
--   * Política "modelos_3d_lectura_publica": solo SELECT. No hay políticas de INSERT, UPDATE ni
--     DELETE: con la llave pública nadie puede subir, cambiar ni borrar archivos. El servidor usa
--     service_role, que salta RLS y no necesita política.
--
-- Orden de publicación: primero esta migración, después el código. Si el código llega antes, la
-- subida falla, el modelo queda "generando" y se reintenta en cada consulta hasta que exista el bucket.
--
-- Es ADITIVA e IDEMPOTENTE (se puede ejecutar 2 veces): on conflict + drop policy if exists.
-- Se aplica desde el SQL Editor (rol postgres).
-- Deshacer en emergencia: supabase/rollbacks/20261118120000_bucket_modelos_3d.rollback.sql
-- =====================================================================================

begin;

-- Si Storage tiene la tabla ocupada, fallar rápido en vez de quedar esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('modelos-3d', 'modelos-3d', true, 52428800, array['model/gltf-binary'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "modelos_3d_lectura_publica" on storage.objects;
create policy "modelos_3d_lectura_publica" on storage.objects
  for select to public
  using (bucket_id = 'modelos-3d'::text);

notify pgrst, 'reload schema';

commit;
