-- =====================================================================================
-- Migración 20261120120000_nivel_por_saldo
-- Regla nueva (aprobada por el dueño el 2026-11-19): el nivel del cliente (Lover, Fan, Pro,
-- Master) sale de su SALDO ACTUAL de puntos, no de los puntos ganados en toda su historia.
-- Gastar puntos puede bajar el nivel, y con él el % máximo pagable con puntos en la compra
-- siguiente.
--   * public.super_points_resumen(id): nivel, pct_max, puntos_para_siguiente y siguiente_nivel
--     se calculan con el saldo. 'ganados' se sigue devolviendo solo como dato informativo.
--   * public.registrar_venta NO cambia: ya toma el pct_max de super_points_resumen() con la fila
--     del cliente bloqueada y ANTES de anotar el canje y lo ganado de esa compra. Por eso el tope
--     del canje usa el nivel del saldo ANTES de la compra sin tocar su código.
--   * public.cambiar_estado_venta NO cambia: no calcula niveles (solo mueve puntos).
--   * public.super_points_reglas NO cambia: los rangos son los mismos, ahora contra el saldo.
-- Misma firma, stable, security invoker, search_path vacío y EXECUTE solo para service_role.
-- Es IDEMPOTENTE (create or replace + revoke/grant): se puede ejecutar 2 veces.
-- Punto de partida: la definición real de la base (pg_get_functiondef, 2026-11-19), igual a la
-- de 20261111120000_super_points.sql salvo los finales de línea.
-- Orden de publicación: PRIMERO esta migración, DESPUÉS el código del servidor y de la página
-- (el código no depende de ella: solo cambia qué nivel devuelve la base).
-- Deshacer en emergencia: supabase/rollbacks/20261120120000_nivel_por_saldo.rollback.sql
-- =====================================================================================

begin;

-- Si la app tiene bloqueada alguna tabla, fallar rápido en vez de dejar la web colgada esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -------------------------------------------------------------------------------------
-- Resumen de un cliente
--   saldo   = suma de todos sus movimientos (decide el nivel)
--   ganados = puntos 'ganado' de ventas que NO fueron revertidas (solo informativo)
-- Devuelve: {saldo, ganados, nivel, pct_max, valor_saldo, puntos_para_siguiente, siguiente_nivel}
-- (en Master: puntos_para_siguiente = 0 y siguiente_nivel = null)
-- -------------------------------------------------------------------------------------
create or replace function public.super_points_resumen(p_id_usuario bigint)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_reglas    jsonb := public.super_points_reglas();
  v_saldo     integer;
  v_ganados   integer;
  v_base      integer;
  v_nivel     jsonb;
  v_siguiente jsonb;
begin
  select coalesce(sum(sp.puntos_generados), 0)::integer,
         coalesce(sum(sp.puntos_generados) filter (
           where sp.tipo = 'ganado'
             and not exists (
               select 1 from public.super_points r
               where r.id_venta = sp.id_venta and r.tipo = 'revertido'
             )
         ), 0)::integer
    into v_saldo, v_ganados
  from public.super_points sp
  where sp.id_usuario = p_id_usuario;

  -- El saldo nunca baja de cero (la cancelación lo protege); por si acaso, un saldo negativo
  -- cuenta como 0 para que siempre haya nivel (Lover) y pct_max nunca sea null.
  v_base := greatest(v_saldo, 0);

  select n into v_nivel
  from jsonb_array_elements(v_reglas -> 'niveles') as n
  where (n ->> 'min')::integer <= v_base
  order by (n ->> 'min')::integer desc
  limit 1;

  select n into v_siguiente
  from jsonb_array_elements(v_reglas -> 'niveles') as n
  where (n ->> 'min')::integer > v_base
  order by (n ->> 'min')::integer
  limit 1;

  return jsonb_build_object(
    'saldo', v_saldo,
    'ganados', v_ganados,
    'nivel', v_nivel ->> 'nombre',
    'pct_max', (v_nivel ->> 'pct')::integer,
    'valor_saldo', v_saldo * (v_reglas ->> 'valor_punto')::integer,
    'puntos_para_siguiente', coalesce((v_siguiente ->> 'min')::integer - v_base, 0),
    'siguiente_nivel', v_siguiente ->> 'nombre'
  );
end;
$$;

comment on function public.super_points_resumen(bigint) is
  'Saldo, nivel (según el SALDO actual, regla del 2026-11-19), % máximo canjeable y lo que falta para el siguiente nivel. ganados es solo informativo. Solo service_role.';

-- -------------------------------------------------------------------------------------
-- Privilegios mínimos: solo el backend (service_role). create or replace conserva los permisos,
-- pero se repiten para que cada ejecución deje el estado correcto aunque alguien los haya cambiado.
-- -------------------------------------------------------------------------------------
revoke execute on function public.super_points_resumen(bigint) from public, anon, authenticated;
grant execute on function public.super_points_resumen(bigint) to service_role;

-- Avisar a la API REST de Supabase (PostgREST) que recargue el esquema (se envía al COMMIT).
notify pgrst, 'reload schema';

commit;
