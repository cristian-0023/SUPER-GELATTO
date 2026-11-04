-- =====================================================================================
-- ROLLBACK de 20261104120000_rls_tablas_publicas  (SOLO PARA EMERGENCIAS)
-- ATENCIÓN:
--   * Vuelve a ABRIR la base: con la llave pública, que no es secreta, se podrían leer y
--     cambiar los datos de clientes, contraseñas cifradas y ventas. Úsalo solo unos minutos.
--   * Apaga RLS únicamente en las 9 tablas que la migración encendió. Las que ya lo tenían
--     (detalle_venta, inventario, empleado, admin_face_rekognition, rostros_admin y
--     rostros_admin_muestras) lo conservan.
--   * Los privilegios vuelven a TODAS las tablas y secuencias de public, también a las
--     creadas después de la migración.
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated;

grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

alter table if exists public.pedido disable row level security;
alter table if exists public.producto disable row level security;
alter table if exists public.proveedor disable row level security;
alter table if exists public.reset_tokens disable row level security;
alter table if exists public.sucursal disable row level security;
alter table if exists public.super_points disable row level security;
alter table if exists public.users disable row level security;
alter table if exists public.usuario disable row level security;
alter table if exists public.venta disable row level security;

notify pgrst, 'reload schema';

commit;
