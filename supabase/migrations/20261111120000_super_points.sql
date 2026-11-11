-- =====================================================================================
-- Migración 20261111120000_super_points
-- Objetivo: Super Points reales. Cada compra cobrada da puntos y los puntos se canjean por
-- descuento según el nivel del cliente.
--   * public.super_points pasa a ser una LIBRETA de movimientos: tipo (ganado, canjeado,
--     devuelto, revertido), puntos con signo, cliente y venta. El saldo es la suma.
--   * public.venta: puntos_usados y descuento_puntos. venta.total = lo realmente pagado.
--     cancelada_alguna_vez: marca permanente; una venta que estuvo en 'Cancelado' (antes o
--     después de esta migración) nunca más gana puntos.
--   * public.super_points_reglas(): ÚNICO lugar con los valores del programa.
--   * public.super_points_resumen(id): saldo, nivel y lo que falta para el siguiente.
--   * public.registrar_venta(...): nuevo parámetro opcional p_puntos_usar (default 0).
--     Reemplaza a la versión de 3 parámetros (se quita para no dejar dos versiones: con las
--     dos, la API no sabría cuál usar). Las llamadas de 3 argumentos siguen funcionando.
--   * public.cambiar_estado_venta(id, estado): cambia el estado y mueve los puntos en la
--     misma transacción.
-- Es ADITIVA en tablas (no borra ni cambia columnas existentes) e IDEMPOTENTE (se puede
-- ejecutar 2 veces). La tabla super_points está vacía, así que no hay datos que migrar; solo
-- se marcan (cancelada_alguna_vez = true) las ventas que ya están en 'Cancelado'.
-- id_points ya es identity en la base real: no se toca.
-- Orden de publicación: PRIMERO esta migración, DESPUÉS el código del servidor.
-- Deshacer en emergencia: supabase/rollbacks/20261111120000_super_points.rollback.sql
-- =====================================================================================

begin;

-- Si la app tiene bloqueada alguna tabla, fallar rápido en vez de dejar la web colgada esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -------------------------------------------------------------------------------------
-- 1. Libreta de movimientos: public.super_points
-- -------------------------------------------------------------------------------------
alter table public.super_points add column if not exists tipo text not null;
alter table public.super_points add column if not exists id_usuario bigint not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'super_points_tipo_check' and conrelid = 'public.super_points'::regclass
  ) then
    alter table public.super_points
      add constraint super_points_tipo_check
      check (tipo = any (array['ganado', 'canjeado', 'devuelto', 'revertido']::text[]));
  end if;

  -- Signo según el tipo: ganado y devuelto suman; canjeado resta; revertido resta o es 0
  -- (un 0 marca la venta como revertida cuando el cliente ya había gastado esos puntos).
  if not exists (
    select 1 from pg_constraint
    where conname = 'super_points_signo_check' and conrelid = 'public.super_points'::regclass
  ) then
    alter table public.super_points
      add constraint super_points_signo_check check (
        (tipo in ('ganado', 'devuelto') and puntos_generados > 0)
        or (tipo = 'canjeado' and puntos_generados < 0)
        or (tipo = 'revertido' and puntos_generados <= 0)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'super_points_id_usuario_fkey' and conrelid = 'public.super_points'::regclass
  ) then
    alter table public.super_points
      add constraint super_points_id_usuario_fkey
      foreign key (id_usuario) references public.usuario (id_usuario) on delete cascade;
  end if;

  -- Un mismo tipo de movimiento no se repite en la misma venta (los puntos se mueven una vez).
  -- También sirve de índice para la clave foránea id_venta.
  if not exists (
    select 1 from pg_constraint
    where conname = 'super_points_venta_tipo_key' and conrelid = 'public.super_points'::regclass
  ) then
    alter table public.super_points
      add constraint super_points_venta_tipo_key unique (id_venta, tipo);
  end if;
end $$;

-- Saldo e historial de un cliente (más recientes primero).
create index if not exists super_points_id_usuario_fecha_idx
  on public.super_points (id_usuario, fecha_generacion desc);

-- La página nunca habla con la base: solo el servidor (service_role).
revoke all on public.super_points from anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 2. public.venta: puntos usados y descuento en pesos
-- -------------------------------------------------------------------------------------
alter table public.venta add column if not exists puntos_usados integer not null default 0;
alter table public.venta add column if not exists descuento_puntos numeric(10,2) not null default 0;
alter table public.venta add column if not exists cancelada_alguna_vez boolean not null default false;

-- Las ventas que YA están canceladas quedan marcadas: sacarlas de 'Cancelado' no les da puntos.
update public.venta
   set cancelada_alguna_vez = true
 where estado = 'Cancelado' and not cancelada_alguna_vez;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'venta_puntos_no_negativos' and conrelid = 'public.venta'::regclass
  ) then
    alter table public.venta
      add constraint venta_puntos_no_negativos check (puntos_usados >= 0 and descuento_puntos >= 0);
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 3. Reglas del programa (ÚNICO lugar con estos valores; el servidor y la página las leen)
--   pesos_por_punto: cada $100 pagados = 1 punto (piso)
--   valor_punto    : 1 punto = $5 de descuento
--   niveles        : por puntos GANADOS; pct = % máximo de la compra pagable con puntos
-- -------------------------------------------------------------------------------------
create or replace function public.super_points_reglas()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'pesos_por_punto', 100,
    'valor_punto', 5,
    'niveles', jsonb_build_array(
      jsonb_build_object('nombre', 'Lover',  'min', 0,    'max', 100,  'pct', 5),
      jsonb_build_object('nombre', 'Fan',    'min', 101,  'max', 500,  'pct', 10),
      jsonb_build_object('nombre', 'Pro',    'min', 501,  'max', 1000, 'pct', 15),
      jsonb_build_object('nombre', 'Master', 'min', 1001, 'max', null, 'pct', 20)
    )
  );
$$;

-- -------------------------------------------------------------------------------------
-- 4. Resumen de un cliente
--   saldo  = suma de todos sus movimientos
--   ganados = puntos 'ganado' de ventas que NO fueron revertidas (deciden el nivel)
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

-- -------------------------------------------------------------------------------------
-- 5. public.registrar_venta con canje de puntos
--   p_id_usuario  : comprador o NULL (compra anónima, no gana ni canjea). Se usa tal cual.
--   p_items       : [{"id_producto": <int>, "cantidad": <int>}, ...] (1..50 líneas)
--   p_estado      : 'Pagado' (descuenta stock y mueve puntos) o 'Fallido' (solo registra)
--   p_puntos_usar : puntos a canjear (entero >= 0, default 0). En 'Fallido' se ignora.
-- Reglas (además de las de la versión anterior):
--   * Bloquea la fila del cliente ANTES de leer el saldo: dos pagos simultáneos del mismo
--     cliente se hacen en fila y el segundo ve el saldo ya descontado.
--   * Máximo canjeable = menor entre el saldo y piso(subtotal x pct del nivel / 100 / valor_punto),
--     con el nivel que tiene ANTES de esta compra.
--   * total = subtotal - descuento. Gana piso(total / pesos_por_punto) puntos.
-- Errores nuevos (P0001): PUNTOS_INVALIDOS, PUNTOS_INSUFICIENTES, PUNTOS_EXCEDEN_TOPE.
-- Devuelve: {id_venta, total, subtotal, estado, items, puntos_usados, descuento, puntos_ganados, saldo}
-- -------------------------------------------------------------------------------------
drop function if exists public.registrar_venta(bigint, jsonb, text);

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

-- -------------------------------------------------------------------------------------
-- 6. public.cambiar_estado_venta: estado + puntos en una sola transacción
--   * A un estado cobrado desde 'Pendiente' o 'Fallido': otorga piso(total / pesos_por_punto)
--     si la venta tiene cliente, nunca estuvo en 'Cancelado' (cancelada_alguna_vez = false) y
--     aún no tiene 'ganado' ni 'revertido'.
--   * A 'Cancelado' (desde otro estado): devuelve lo canjeado y quita lo ganado sin dejar el
--     saldo bajo cero. Si tenía 'ganado' escribe SIEMPRE 'revertido' (aunque quite 0): esa fila
--     marca la venta como revertida y saca sus puntos del nivel.
--   * Entrar o salir de 'Cancelado' marca cancelada_alguna_vez para siempre (lo segundo cubre
--     ventas canceladas por otro camino). Salir de 'Cancelado' no mueve nada.
--     Cada movimiento ocurre una sola vez por venta.
-- Errores (P0001): ESTADO_INVALIDO, VENTA_NO_EXISTE.
-- Devuelve: {id_venta, id_usuario, total, estado, estado_anterior, puntos_usados, descuento_puntos}
-- -------------------------------------------------------------------------------------
create or replace function public.cambiar_estado_venta(p_id_venta bigint, p_estado text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reglas    jsonb := public.super_points_reglas();
  v_venta     record;
  v_ganado    integer;
  v_canjeado  integer;
  v_saldo     integer;
  v_puntos    integer;
begin
  if p_estado is null or p_estado not in ('Pendiente', 'Pagado', 'Fallido', 'En proceso', 'En entrega',
                                          'Enviado', 'Entregado', 'Completado', 'Cancelado') then
    raise exception using errcode = 'P0001', message = 'ESTADO_INVALIDO',
      detail = format('estado=%s', coalesce(p_estado, 'NULL'));
  end if;

  -- Bloquear la venta (y después al cliente) para leer el estado anterior sin carreras.
  select v.id_venta, v.id_usuario, v.total, v.estado, v.puntos_usados, v.descuento_puntos,
         v.cancelada_alguna_vez
    into v_venta
  from public.venta v
  where v.id_venta = p_id_venta
  for no key update;
  if not found then
    raise exception using errcode = 'P0001', message = 'VENTA_NO_EXISTE',
      detail = format('id_venta=%s', p_id_venta);
  end if;

  -- En el SET, "estado" es el valor anterior: entrar o salir de 'Cancelado' deja la marca.
  update public.venta
     set estado = p_estado,
         cancelada_alguna_vez = cancelada_alguna_vez or p_estado = 'Cancelado' or estado = 'Cancelado'
   where id_venta = p_id_venta;

  if v_venta.id_usuario is not null and v_venta.estado <> 'Cancelado' then
    perform 1 from public.usuario u where u.id_usuario = v_venta.id_usuario for no key update;

    -- Cobrar una venta que estaba Pendiente o Fallido: otorga sus puntos (una sola vez).
    -- Una venta que alguna vez estuvo cancelada nunca gana (la cancelación es definitiva).
    if p_estado in ('Pagado', 'En proceso', 'En entrega', 'Enviado', 'Entregado', 'Completado')
       and v_venta.estado in ('Pendiente', 'Fallido')
       and not v_venta.cancelada_alguna_vez
       and not exists (
         select 1 from public.super_points sp
         where sp.id_venta = p_id_venta and sp.tipo in ('ganado', 'revertido')
       ) then
      v_puntos := floor(v_venta.total / (v_reglas ->> 'pesos_por_punto')::integer)::integer;
      if v_puntos > 0 then
        insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados)
        values (v_venta.id_usuario, p_id_venta, 'ganado', v_puntos);
      end if;
    end if;

    -- Cancelar: devolver lo canjeado y quitar lo ganado (una sola vez).
    if p_estado = 'Cancelado' then
      select -sp.puntos_generados into v_canjeado
      from public.super_points sp
      where sp.id_venta = p_id_venta and sp.tipo = 'canjeado';
      if v_canjeado is not null and not exists (
           select 1 from public.super_points sp where sp.id_venta = p_id_venta and sp.tipo = 'devuelto'
         ) then
        insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados)
        values (v_venta.id_usuario, p_id_venta, 'devuelto', v_canjeado);
      end if;

      select sp.puntos_generados into v_ganado
      from public.super_points sp
      where sp.id_venta = p_id_venta and sp.tipo = 'ganado';
      if v_ganado is not null and not exists (
           select 1 from public.super_points sp where sp.id_venta = p_id_venta and sp.tipo = 'revertido'
         ) then
        select coalesce(sum(sp.puntos_generados), 0)::integer into v_saldo
        from public.super_points sp
        where sp.id_usuario = v_venta.id_usuario;
        insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados)
        values (v_venta.id_usuario, p_id_venta, 'revertido', -least(v_ganado, greatest(v_saldo, 0)));
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'id_venta', v_venta.id_venta,
    'id_usuario', v_venta.id_usuario,
    'total', v_venta.total,
    'estado', p_estado,
    'estado_anterior', v_venta.estado,
    'puntos_usados', v_venta.puntos_usados,
    'descuento_puntos', v_venta.descuento_puntos
  );
end;
$$;

-- -------------------------------------------------------------------------------------
-- 7. Privilegios mínimos: solo el backend (service_role). Postgres/Supabase dan EXECUTE por
-- defecto a PUBLIC/anon/authenticated, por eso se revoca explícitamente en cada ejecución.
-- -------------------------------------------------------------------------------------
revoke execute on function public.super_points_reglas() from public, anon, authenticated;
revoke execute on function public.super_points_resumen(bigint) from public, anon, authenticated;
revoke execute on function public.registrar_venta(bigint, jsonb, text, integer) from public, anon, authenticated;
revoke execute on function public.cambiar_estado_venta(bigint, text) from public, anon, authenticated;
grant execute on function public.super_points_reglas() to service_role;
grant execute on function public.super_points_resumen(bigint) to service_role;
grant execute on function public.registrar_venta(bigint, jsonb, text, integer) to service_role;
grant execute on function public.cambiar_estado_venta(bigint, text) to service_role;

-- Avisar a la API REST de Supabase (PostgREST) que recargue el esquema (se envía al COMMIT).
notify pgrst, 'reload schema';

commit;
