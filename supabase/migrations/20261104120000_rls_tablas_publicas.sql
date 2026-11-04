-- =====================================================================================
-- Migración 20261104120000_rls_tablas_publicas
-- Objetivo: que la llave pública de la base no sirva para leer ni escribir nada. La página
-- no habla con la base: todo pasa por el servidor, que entra con service_role.
--   * Activa RLS en las tablas que lo tenían apagado (sin políticas: nadie entra por RLS).
--   * Quita a anon y authenticated todos los privilegios sobre TODAS las tablas y secuencias
--     de public, incluidas las que ya tenían RLS y las que no están en schema_base.
--   * Hace lo mismo con los privilegios por defecto: las tablas futuras nacen cerradas.
-- service_role conserva su acceso: tiene sus propios privilegios y BYPASSRLS.
--
-- Es ADITIVA (no borra tablas, datos ni políticas) e IDEMPOTENTE (se puede ejecutar 2 veces).
-- ALTER TABLE IF EXISTS cubre las tablas que no existen en todas las bases, sin SQL dinámico.
--
-- Los privilegios por defecto se cambian solo para las tablas que crea el rol postgres (el del
-- SQL Editor y las migraciones): ese rol no puede cambiar los de otros roles del sistema.
--
-- ANTES DE APLICAR: el servidor debe usar SUPABASE_SERVICE_ROLE_KEY. Con la llave pública, todas
-- las consultas fallarían.
-- Deshacer en emergencia: supabase/rollbacks/20261104120000_rls_tablas_publicas.rollback.sql
-- =====================================================================================

begin;

-- Si la app tiene bloqueada alguna tabla, fallar rápido en vez de dejar la web colgada esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -------------------------------------------------------------------------------------
-- 1. RLS en las tablas que lo tenían apagado
-- -------------------------------------------------------------------------------------
alter table if exists public.pedido enable row level security;
alter table if exists public.producto enable row level security;
alter table if exists public.proveedor enable row level security;
alter table if exists public.reset_tokens enable row level security;
alter table if exists public.sucursal enable row level security;
alter table if exists public.super_points enable row level security;
alter table if exists public.users enable row level security;
alter table if exists public.usuario enable row level security;
alter table if exists public.venta enable row level security;

-- -------------------------------------------------------------------------------------
-- 2. Sin privilegios para los roles de la llave pública, en lo que ya existe
-- -------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 3. Ni en lo que se cree después
-- -------------------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

notify pgrst, 'reload schema';

commit;
