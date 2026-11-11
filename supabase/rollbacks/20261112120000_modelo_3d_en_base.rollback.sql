-- =====================================================================================
-- ROLLBACK de 20261112120000_modelo_3d_en_base
-- Quita producto.model_3d_task_id, model_3d_estado y model_3d_prompt (y sus restricciones).
-- Se pierden las tareas 3D en curso; model_3d_url NO se toca. Antes de ejecutarlo, volver al
-- código anterior: el código nuevo usa estas columnas. Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.producto drop constraint if exists producto_model_3d_estado_check;
alter table public.producto drop constraint if exists producto_model_3d_task_id_largo;
alter table public.producto drop constraint if exists producto_model_3d_prompt_largo;

alter table public.producto drop column if exists model_3d_task_id;
alter table public.producto drop column if exists model_3d_estado;
alter table public.producto drop column if exists model_3d_prompt;

notify pgrst, 'reload schema';

commit;
