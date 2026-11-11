-- =====================================================================================
-- Migración 20261112120000_modelo_3d_en_base
-- Objetivo: que la tarea de modelado 3D (Tripo) de cada producto viva en la base y no en un
-- archivo JSON del servidor (en Vercel el disco es de solo lectura y cada instancia arranca
-- desde el repositorio, así que ese archivo se perdía).
--   * producto.model_3d_task_id: id de la tarea en Tripo.
--   * producto.model_3d_estado:  'generando' | 'listo' | 'error' (vacío = sin modelo).
--   * producto.model_3d_prompt:  descripción usada para generar el modelo.
--   * producto.model_3d_url ya existe (migración 20261025120000) y se reutiliza.
-- Solo agrega columnas que aceptan vacío: no cambia datos ni permisos (RLS ya está activo y
-- anon/authenticated no tienen permisos sobre producto).
--
-- Orden de publicación: primero esta migración, después el código. Si el código llega antes,
-- crear productos sigue funcionando, pero las rutas de modelos 3D responden 500.
--
-- Es ADITIVA e IDEMPOTENTE (se puede ejecutar 2 veces).
-- Deshacer en emergencia: supabase/rollbacks/20261112120000_modelo_3d_en_base.rollback.sql
-- =====================================================================================

begin;

-- Si alguien tiene la tabla bloqueada, fallar rápido en vez de esperar.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.producto add column if not exists model_3d_task_id text;
alter table public.producto add column if not exists model_3d_estado text;
alter table public.producto add column if not exists model_3d_prompt text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'producto_model_3d_estado_check' and conrelid = 'public.producto'::regclass
  ) then
    alter table public.producto
      add constraint producto_model_3d_estado_check
      check (model_3d_estado is null or model_3d_estado in ('generando', 'listo', 'error'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'producto_model_3d_task_id_largo' and conrelid = 'public.producto'::regclass
  ) then
    alter table public.producto
      add constraint producto_model_3d_task_id_largo
      check (model_3d_task_id is null or char_length(model_3d_task_id) <= 200);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'producto_model_3d_prompt_largo' and conrelid = 'public.producto'::regclass
  ) then
    alter table public.producto
      add constraint producto_model_3d_prompt_largo
      check (model_3d_prompt is null or char_length(model_3d_prompt) <= 1000);
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
