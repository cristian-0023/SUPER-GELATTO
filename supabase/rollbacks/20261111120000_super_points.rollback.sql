-- =====================================================================================
-- ROLLBACK de 20261111120000_super_points  (SOLO PARA EMERGENCIAS)
-- ATENCIÓN:
--   * Borra la libreta de Super Points: se pierden los saldos e historiales de los clientes
--     (las filas de super_points creadas por esta migración y sus columnas tipo e id_usuario).
--   * Borra venta.puntos_usados, venta.descuento_puntos y venta.cancelada_alguna_vez.
--     venta.total sigue siendo lo pagado.
--   * Quita super_points_reglas, super_points_resumen y cambiar_estado_venta, y vuelve a
--     dejar registrar_venta con 3 parámetros (la versión de 20261025120000, sin puntos).
--   * ANTES: volver a publicar el código del servidor anterior a Super Points. El código nuevo
--     llama a funciones que este rollback borra.
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.cambiar_estado_venta(bigint, text);
drop function if exists public.registrar_venta(bigint, jsonb, text, integer);
drop function if exists public.super_points_resumen(bigint);
drop function if exists public.super_points_reglas();

-- Libreta: las filas con tipo son las de esta migración (la tabla estaba vacía antes).
-- Se borran para que la migración se pueda volver a aplicar (tipo e id_usuario son NOT NULL).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'super_points' and column_name = 'tipo'
  ) then
    delete from public.super_points where tipo is not null;
  end if;
end $$;

drop index if exists public.super_points_id_usuario_fecha_idx;
alter table public.super_points drop constraint if exists super_points_venta_tipo_key;
alter table public.super_points drop constraint if exists super_points_id_usuario_fkey;
alter table public.super_points drop constraint if exists super_points_signo_check;
alter table public.super_points drop constraint if exists super_points_tipo_check;
alter table public.super_points drop column if exists id_usuario;
alter table public.super_points drop column if exists tipo;

alter table public.venta drop constraint if exists venta_puntos_no_negativos;
alter table public.venta drop column if exists cancelada_alguna_vez;
alter table public.venta drop column if exists descuento_puntos;
alter table public.venta drop column if exists puntos_usados;

-- registrar_venta original (copia exacta de 20261025120000_ventas_pagos_y_productos).
create or replace function public.registrar_venta(p_id_usuario bigint, p_items jsonb, p_estado text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item        jsonb;
  v_pos         integer := 0;
  v_ok          boolean;
  v_ids         bigint[];
  v_cantidades  integer[];
  v_fila        record;
  v_total       numeric(10,2);
  v_id_venta    bigint;
  v_items_out   jsonb;
begin
  -- Estado
  if p_estado is null or p_estado not in ('Pagado', 'Fallido') then
    raise exception using errcode = 'P0001', message = 'ESTADO_INVALIDO',
      detail = format('estado=%s (permitidos: Pagado, Fallido)', coalesce(p_estado, 'NULL'));
  end if;

  -- Carrito
  if coalesce(jsonb_typeof(p_items), '') <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception using errcode = 'P0001', message = 'CARRITO_VACIO';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception using errcode = 'P0001', message = 'CARRITO_DEMASIADO_GRANDE',
      detail = format('lineas=%s (maximo 50)', jsonb_array_length(p_items));
  end if;

  -- Validar cada línea ANTES de convertir tipos (evita errores 22P02 genéricos)
  -- (CASE garantiza el orden: solo se convierte a numeric cuando ya se sabe que es número)
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    v_ok := case
         when jsonb_typeof(v_item) <> 'object' then false
         when coalesce(jsonb_typeof(v_item -> 'id_producto'), '') <> 'number' then false
         else (v_item ->> 'id_producto')::numeric = trunc((v_item ->> 'id_producto')::numeric)
              and (v_item ->> 'id_producto')::numeric between 1 and 9223372036854775807
       end;
    if not v_ok then
      raise exception using errcode = 'P0001', message = 'ITEM_INVALIDO',
        detail = format('linea=%s', v_pos);
    end if;
    v_ok := case
         when coalesce(jsonb_typeof(v_item -> 'cantidad'), '') <> 'number' then false
         else (v_item ->> 'cantidad')::numeric = trunc((v_item ->> 'cantidad')::numeric)
              and (v_item ->> 'cantidad')::numeric between 1 and 99
       end;
    if not v_ok then
      raise exception using errcode = 'P0001', message = 'CANTIDAD_INVALIDA',
        detail = format('linea=%s (entero entre 1 y 99)', v_pos);
    end if;
  end loop;

  -- Sumar productos repetidos (ordenados por id para bloquear siempre en el mismo orden)
  select array_agg(l.id_producto order by l.id_producto),
         array_agg(l.cantidad order by l.id_producto)
    into v_ids, v_cantidades
  from (
    select (e ->> 'id_producto')::numeric::bigint as id_producto,
           sum((e ->> 'cantidad')::numeric::integer)::integer as cantidad
    from jsonb_array_elements(p_items) as e
    group by 1
  ) as l;

  select l.id_producto, l.cantidad into v_fila
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  where l.cantidad > 99
  limit 1;
  if found then
    raise exception using errcode = 'P0001', message = 'CANTIDAD_INVALIDA',
      detail = format('id_producto=%s cantidad_total=%s (maximo 99)', v_fila.id_producto, v_fila.cantidad);
  end if;

  -- Usuario (NULL = compra anónima)
  if p_id_usuario is not null
     and not exists (select 1 from public.usuario u where u.id_usuario = p_id_usuario) then
    raise exception using errcode = 'P0001', message = 'USUARIO_NO_EXISTE',
      detail = format('id_usuario=%s', p_id_usuario);
  end if;

  -- Si se pagó, bloquear los productos en orden de id (evita deadlocks). NO KEY UPDATE basta
  -- para cambiar stock y no choca con los FOR KEY SHARE de las FKs de otras compras.
  -- Un pago 'Fallido' no toca stock, así que no bloquea nada.
  if p_estado = 'Pagado' then
    perform 1 from public.producto p
    where p.id_producto = any (v_ids)
    order by p.id_producto
    for no key update;
  end if;

  -- Existencia, estado y stock (ya bajo bloqueo, así los datos no cambian hasta el COMMIT)
  for v_fila in
    select l.id_producto, l.cantidad, p.id_producto as encontrado, p.estado, p.stock
    from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
    left join public.producto p on p.id_producto = l.id_producto
    order by l.id_producto
  loop
    if v_fila.encontrado is null then
      raise exception using errcode = 'P0001', message = 'PRODUCTO_NO_EXISTE',
        detail = format('id_producto=%s', v_fila.id_producto);
    elsif v_fila.estado is distinct from true then
      raise exception using errcode = 'P0001', message = 'PRODUCTO_INACTIVO',
        detail = format('id_producto=%s', v_fila.id_producto);
    elsif p_estado = 'Pagado' and v_fila.stock < v_fila.cantidad then
      raise exception using errcode = 'P0001', message = 'STOCK_INSUFICIENTE',
        detail = format('id_producto=%s solicitado=%s disponible=%s',
                        v_fila.id_producto, v_fila.cantidad, v_fila.stock);
    end if;
  end loop;

  -- Total calculado en la base con los precios reales
  select sum(p.precio * l.cantidad)
    into v_total
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto;

  insert into public.venta (total, tipo_venta, id_usuario, estado)
  values (v_total, 'Online', p_id_usuario, p_estado)
  returning id_venta into v_id_venta;

  insert into public.detalle_venta (id_venta, id_producto, cantidad, precio_unitario)
  select v_id_venta, l.id_producto, l.cantidad, p.precio
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto
  order by l.id_producto;

  -- Descontar stock solo si se pagó (con guarda "stock >= cantidad" por seguridad)
  if p_estado = 'Pagado' then
    for v_fila in
      select l.id_producto, l.cantidad
      from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
      order by l.id_producto
    loop
      update public.producto
         set stock = stock - v_fila.cantidad
       where id_producto = v_fila.id_producto
         and stock >= v_fila.cantidad;
      if not found then
        raise exception using errcode = 'P0001', message = 'STOCK_INSUFICIENTE',
          detail = format('id_producto=%s', v_fila.id_producto);
      end if;
    end loop;
  end if;

  select jsonb_agg(jsonb_build_object(
           'id_producto', l.id_producto,
           'nombre', p.nombre,
           'cantidad', l.cantidad,
           'precio_unitario', p.precio,
           'subtotal', p.precio * l.cantidad
         ) order by l.id_producto)
    into v_items_out
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto;

  return jsonb_build_object(
    'id_venta', v_id_venta,
    'total', v_total,
    'estado', p_estado,
    'items', v_items_out
  );
end;
$$;

comment on function public.registrar_venta(bigint, jsonb, text) is
  'Checkout transaccional (todo o nada). Precios desde producto.precio. Solo service_role. Errores P0001 con message = código estable.';

-- Privilegios mínimos: solo el backend (service_role). Postgres/Supabase dan EXECUTE por
-- defecto a PUBLIC/anon/authenticated, por eso se revoca explícitamente en cada ejecución.
revoke execute on function public.registrar_venta(bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.registrar_venta(bigint, jsonb, text) to service_role;

notify pgrst, 'reload schema';

commit;
