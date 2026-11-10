-- =====================================================================================
-- Migración 20261110120000_storage_helados_solo_lectura
-- Objetivo: que nadie pueda SUBIR ni CAMBIAR imágenes del bucket "helados" con la llave pública.
--   * Borra las políticas de INSERT y UPDATE sobre storage.objects para el rol public.
--   * Conserva "Public Read Access on helados": la tienda sigue mostrando las imágenes.
-- Ningún código del proyecto sube archivos a Storage: las imágenes se suben a mano desde el panel
-- de Supabase, que no depende de estas políticas.
--
-- Es IDEMPOTENTE (drop policy if exists: se puede ejecutar 2 veces) y no borra archivos.
-- Se aplica desde el SQL Editor (rol postgres, que puede manejar políticas de storage.objects).
-- Deshacer en emergencia: supabase/rollbacks/20261110120000_storage_helados_solo_lectura.rollback.sql
-- =====================================================================================

begin;

-- Si Storage tiene la tabla ocupada, fallar rápido en vez de quedar esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "Public Insert Access on helados" on storage.objects;
drop policy if exists "Public Update Access on helados" on storage.objects;

notify pgrst, 'reload schema';

commit;
