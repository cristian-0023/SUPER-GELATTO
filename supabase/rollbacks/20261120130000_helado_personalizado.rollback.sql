-- =====================================================================================
-- ROLLBACK de 20261120130000_helado_personalizado  (SOLO PARA EMERGENCIAS)
-- ATENCIÓN:
--   * Borra public.componente_personalizado (y los precios que se hayan cambiado en ella).
--   * Borra detalle_venta.personalizacion: las ventas personalizadas ya hechas se quedan con su
--     fila de detalle (producto, cantidad y precio) pero PIERDEN la composición elegida.
--   * Vuelve a dejar registrar_venta como en 20261111120000_super_points (sin personalizado).
--   * El producto "Helado personalizado 3D" se borra solo si nunca se vendió (detalle_venta lo
--     protege con on delete restrict). Si ya se vendió queda en la base, oculto (estado = false).
--   * ANTES: volver a publicar el código del servidor y de la página anteriores. El código nuevo
--     manda líneas personalizadas y lee la tabla que este rollback borra.
-- Es idempotente (se puede ejecutar 2 veces).
-- =====================================================================================

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop function if exists public.helado_personalizado_reglas();

alter table public.detalle_venta drop constraint if exists detalle_venta_personalizacion_objeto;
alter table public.detalle_venta drop column if exists personalizacion;

delete from public.producto p
where p.tipo = 'personalizado'
  and not exists (select 1 from public.detalle_venta d where d.id_producto = p.id_producto);
drop index if exists public.producto_tipo_personalizado_key;

drop table if exists public.componente_personalizado;

-- registrar_venta anterior (copia exacta de 20261111120000_super_points).
create or replace function public.registrar_venta(p_id_usuario bigint, p_items jsonb, p_estado text, p_puntos_usar integer default 0)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reglas      jsonb := public.super_points_reglas();
  v_item        jsonb;
  v_pos         integer := 0;
  v_ok          boolean;
  v_ids         bigint[];
  v_cantidades  integer[];
  v_fila        record;
  v_subtotal    numeric(10,2);
  v_total       numeric(10,2);
  v_puntos      integer := coalesce(p_puntos_usar, 0);
  v_descuento   numeric(10,2) := 0;
  v_ganados     integer := 0;
  v_resumen     jsonb;
  v_tope        integer;
  v_saldo       integer := 0;
  v_id_venta    bigint;
  v_items_out   jsonb;
begin
  -- Estado
  if p_estado is null or p_estado not in ('Pagado', 'Fallido') then
    raise exception using errcode = 'P0001', message = 'ESTADO_INVALIDO',
      detail = format('estado=%s (permitidos: Pagado, Fallido)', coalesce(p_estado, 'NULL'));
  end if;

  -- Puntos: nunca negativos. Un pago fallido no canjea nada.
  if v_puntos < 0 then
    raise exception using errcode = 'P0001', message = 'PUNTOS_INVALIDOS',
      detail = format('puntos=%s', v_puntos);
  end if;
  if p_estado = 'Fallido' then
    v_puntos := 0;
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

  -- Usuario (NULL = compra anónima). Si se pagó, se bloquea su fila antes de leer el saldo.
  -- NO KEY UPDATE: pone en fila a los pagos del mismo cliente sin frenar las claves foráneas.
  if p_id_usuario is not null then
    if p_estado = 'Pagado' then
      perform 1 from public.usuario u where u.id_usuario = p_id_usuario for no key update;
    else
      perform 1 from public.usuario u where u.id_usuario = p_id_usuario;
    end if;
    if not found then
      raise exception using errcode = 'P0001', message = 'USUARIO_NO_EXISTE',
        detail = format('id_usuario=%s', p_id_usuario);
    end if;
  end if;

  -- Si se pagó, bloquear los productos en orden de id (evita deadlocks).
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

  -- Subtotal calculado en la base con los precios reales
  select sum(p.precio * l.cantidad)
    into v_subtotal
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto;

  -- Saldo y nivel ANTES de esta compra (ya con la fila del cliente bloqueada)
  if p_id_usuario is not null then
    v_resumen := public.super_points_resumen(p_id_usuario);
    v_saldo := (v_resumen ->> 'saldo')::integer;
  end if;

  if v_puntos > 0 then
    if v_puntos > v_saldo then
      raise exception using errcode = 'P0001', message = 'PUNTOS_INSUFICIENTES',
        detail = format('pedidos=%s saldo=%s', v_puntos, v_saldo);
    end if;
    v_tope := floor(v_subtotal * (v_resumen ->> 'pct_max')::integer / 100
                    / (v_reglas ->> 'valor_punto')::integer)::integer;
    if v_puntos > v_tope then
      raise exception using errcode = 'P0001', message = 'PUNTOS_EXCEDEN_TOPE',
        detail = format('pedidos=%s tope=%s', v_puntos, v_tope);
    end if;
    v_descuento := v_puntos * (v_reglas ->> 'valor_punto')::integer;
  end if;

  v_total := v_subtotal - v_descuento;
  if p_estado = 'Pagado' and p_id_usuario is not null then
    v_ganados := floor(v_total / (v_reglas ->> 'pesos_por_punto')::integer)::integer;
  end if;

  insert into public.venta (total, tipo_venta, id_usuario, estado, puntos_usados, descuento_puntos)
  values (v_total, 'Online', p_id_usuario, p_estado, v_puntos, v_descuento)
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

  -- Libreta: lo canjeado y lo ganado en esta compra
  if v_puntos > 0 then
    insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados)
    values (p_id_usuario, v_id_venta, 'canjeado', -v_puntos);
  end if;
  if v_ganados > 0 then
    insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados)
    values (p_id_usuario, v_id_venta, 'ganado', v_ganados);
  end if;
  v_saldo := v_saldo - v_puntos + v_ganados;

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
    'subtotal', v_subtotal,
    'estado', p_estado,
    'items', v_items_out,
    'puntos_usados', v_puntos,
    'descuento', v_descuento,
    'puntos_ganados', v_ganados,
    'saldo', v_saldo
  );
end;
$$;

comment on function public.registrar_venta(bigint, jsonb, text, integer) is
  'Checkout transaccional (todo o nada) con canje de Super Points. Precios desde producto.precio. Solo service_role. Errores P0001 con message = código estable.';

revoke execute on function public.registrar_venta(bigint, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.registrar_venta(bigint, jsonb, text, integer) to service_role;

notify pgrst, 'reload schema';

commit;
