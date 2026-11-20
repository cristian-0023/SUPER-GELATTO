-- =====================================================================================
-- ROLLBACK de 20261120120000_nivel_por_saldo  (SOLO PARA EMERGENCIAS)
-- Vuelve a la regla anterior: el nivel sale de los puntos GANADOS en toda la historia (gastar
-- puntos no baja el nivel). Deja public.super_points_resumen exactamente como la dejó
-- 20261111120000_super_points.sql y quita el comentario que agregó esta migración.
-- No toca datos: la libreta y los saldos quedan iguales; solo cambia qué nivel se calcula.
-- El código del servidor y de la página funciona con las dos versiones (la respuesta tiene la
-- misma forma); solo los textos de la página hablan de "puntos actuales".
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- super_points_resumen original (copia exacta de 20261111120000_super_points, sección 4).
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

  select n into v_nivel
  from jsonb_array_elements(v_reglas -> 'niveles') as n
  where (n ->> 'min')::integer <= v_ganados
  order by (n ->> 'min')::integer desc
  limit 1;

  select n into v_siguiente
  from jsonb_array_elements(v_reglas -> 'niveles') as n
  where (n ->> 'min')::integer > v_ganados
  order by (n ->> 'min')::integer
  limit 1;

  return jsonb_build_object(
    'saldo', v_saldo,
    'ganados', v_ganados,
    'nivel', v_nivel ->> 'nombre',
    'pct_max', (v_nivel ->> 'pct')::integer,
    'valor_saldo', v_saldo * (v_reglas ->> 'valor_punto')::integer,
    'puntos_para_siguiente', coalesce((v_siguiente ->> 'min')::integer - v_ganados, 0),
    'siguiente_nivel', v_siguiente ->> 'nombre'
  );
end;
$$;

comment on function public.super_points_resumen(bigint) is null;

revoke execute on function public.super_points_resumen(bigint) from public, anon, authenticated;
grant execute on function public.super_points_resumen(bigint) to service_role;

notify pgrst, 'reload schema';

commit;
