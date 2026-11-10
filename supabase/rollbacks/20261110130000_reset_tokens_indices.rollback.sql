-- =====================================================================================
-- ROLLBACK de 20261110130000_reset_tokens_indices
-- Quita los dos índices de public.reset_tokens. No toca datos; la recuperación de contraseña
-- sigue funcionando, solo que sin índices. Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop index if exists public.reset_tokens_token_key;
drop index if exists public.reset_tokens_email_idx;

notify pgrst, 'reload schema';

commit;
