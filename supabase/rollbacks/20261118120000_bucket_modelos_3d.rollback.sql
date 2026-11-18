-- =====================================================================================
-- ROLLBACK de 20261118120000_bucket_modelos_3d  (SOLO PARA EMERGENCIAS)
-- Quita la política de lectura pública del bucket "modelos-3d" y borra el bucket SOLO si está vacío.
--   * Si el bucket todavía tiene modelos guardados, NO se borra: borrarlo desde SQL dejaría los
--     archivos huérfanos en Storage. En ese caso hay que vaciarlo antes desde el panel de Supabase
--     (Storage -> modelos-3d) y volver a ejecutar este archivo.
--   * Supabase bloquea los DELETE directos sobre storage.buckets (trigger protect_buckets_delete);
--     se permite solo dentro de esta transacción con storage.allow_delete_query, y solo cuando
--     el bucket no tiene archivos.
-- Ojo: sin la política, la tienda deja de poder mostrar los modelos 3D guardados en el bucket.
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists "modelos_3d_lectura_publica" on storage.objects;

do $$
begin
  if not exists (select 1 from storage.objects where bucket_id = 'modelos-3d') then
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.buckets where id = 'modelos-3d';
  else
    raise notice 'El bucket modelos-3d todavía tiene archivos: no se borra. Vacíalo desde el panel y vuelve a ejecutar.';
  end if;
end;
$$;

notify pgrst, 'reload schema';

commit;
