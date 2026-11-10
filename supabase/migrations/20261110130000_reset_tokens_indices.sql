-- =====================================================================================
-- Migración 20261110130000_reset_tokens_indices
-- Objetivo: que "Olvidé mi contraseña" busque rápido en public.reset_tokens.
--   * Índice ÚNICO por token (el servidor guarda ahí el sha256 del enlace y busca por él).
--   * Índice por email (al pedir un enlace nuevo se anulan los anteriores de esa cuenta).
-- No cambia columnas ni datos. El código funciona igual sin esta migración (solo más lento
-- cuando la tabla crezca), así que el orden de publicación no importa.
--
-- Es ADITIVA e IDEMPOTENTE (if not exists: se puede ejecutar 2 veces).
-- Deshacer en emergencia: supabase/rollbacks/20261110130000_reset_tokens_indices.rollback.sql
-- =====================================================================================

begin;

-- La tabla es pequeña: si alguien la tiene bloqueada, fallar rápido en vez de esperar.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create unique index if not exists reset_tokens_token_key on public.reset_tokens (token);
create index if not exists reset_tokens_email_idx on public.reset_tokens (email);

notify pgrst, 'reload schema';

commit;
