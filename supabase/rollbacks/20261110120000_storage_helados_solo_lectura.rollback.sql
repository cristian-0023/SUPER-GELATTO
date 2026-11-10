-- =====================================================================================
-- ROLLBACK de 20261110120000_storage_helados_solo_lectura  (SOLO PARA EMERGENCIAS)
-- ATENCIÓN: vuelve a dejar que CUALQUIERA, sin cuenta, suba o reemplace imágenes del bucket
-- "helados" con la llave pública. Úsalo solo si de verdad algo dejó de funcionar.
-- Recrea las dos políticas con la misma definición que tenían.
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "Public Insert Access on helados" on storage.objects;
create policy "Public Insert Access on helados" on storage.objects
  for insert to public
  with check (bucket_id = 'helados'::text);

drop policy if exists "Public Update Access on helados" on storage.objects;
create policy "Public Update Access on helados" on storage.objects
  for update to public
  using (bucket_id = 'helados'::text);

notify pgrst, 'reload schema';

commit;
