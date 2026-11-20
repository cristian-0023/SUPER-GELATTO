-- =====================================================================================
-- Migración 20261120130000_helado_personalizado
-- Objetivo: que el helado armado en 3D se pueda pagar de verdad, con precios de la base.
--   * public.componente_personalizado: envases, sabores y toppings del armador con su precio.
--     Es la ÚNICA fuente de precios del personalizado. Ids = los que usa el frontend.
--     Modelo ADITIVO: precio = envase + suma de sabores + suma de toppings.
--       envase $8.000 + sabor $2.000 c/u + topping $1.000 c/u
--     => 1 bola sin toppings = $10.000; cada bola extra +$2.000; cada topping +$1.000
--     (los mismos totales que mostraba el armador).
--   * public.helado_personalizado_reglas(): máximo de sabores (3) y de toppings (3).
--   * Un producto real "Helado personalizado 3D" (producto.tipo = 'personalizado', único).
--     estado = false: el catálogo (/api/products) y el chatbot solo leen estado = true, así
--     no aparece en la tienda. No se compra como producto normal: solo armado.
--     stock = 0 y NO se descuenta: un personalizado no se agota (no es un producto envasado).
--   * public.detalle_venta.personalizacion (jsonb, opcional): la composición vendida con
--     nombres y precios del momento (así un cambio de precio no reescribe la historia).
--   * public.registrar_venta: MISMA firma. Acepta además líneas
--       {"tipo":"personalizado","envase":"cone","sabores":["vanilla"],"toppings":[],"cantidad":1}
--     Lo demás (productos normales, puntos, bloqueos, errores) queda igual, más una defensa:
--     si el nivel no trae pct_max, el tope de canje es 0.
--     Errores nuevos (P0001): PERSONALIZADO_INVALIDO, PERSONALIZADO_NO_DISPONIBLE.
-- Es ADITIVA (no borra ni cambia columnas existentes) e IDEMPOTENTE (se puede ejecutar 2 veces;
-- no pisa precios ya cambiados en la tabla).
-- Orden de publicación: PRIMERO esta migración, DESPUÉS el código del servidor y la página.
-- Deshacer en emergencia: supabase/rollbacks/20261120130000_helado_personalizado.rollback.sql
-- =====================================================================================

begin;

-- Si la app tiene bloqueada alguna tabla, fallar rápido en vez de dejar la web colgada esperando.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- -------------------------------------------------------------------------------------
-- 1. Componentes del armador y sus precios
-- -------------------------------------------------------------------------------------
create table if not exists public.componente_personalizado (
  id text primary key,
  tipo text not null,
  nombre text not null,
  precio numeric(10,2) not null,
  activo boolean not null default true
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'componente_personalizado_tipo_check'
      and conrelid = 'public.componente_personalizado'::regclass
  ) then
    alter table public.componente_personalizado
      add constraint componente_personalizado_tipo_check
      check (tipo = any (array['envase', 'sabor', 'topping']::text[]));
  end if;

  -- Ningún componente es gratis (precio > 0). Si el check existe con otra definición (por ejemplo
  -- una versión anterior con precio >= 0), se reemplaza; si ya es el correcto, no se toca.
  if exists (
    select 1 from pg_constraint
    where conname = 'componente_personalizado_precio_check'
      and conrelid = 'public.componente_personalizado'::regclass
      and pg_get_constraintdef(oid) not like '%precio > (0)%'
  ) then
    alter table public.componente_personalizado drop constraint componente_personalizado_precio_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'componente_personalizado_precio_check'
      and conrelid = 'public.componente_personalizado'::regclass
  ) then
    alter table public.componente_personalizado
      add constraint componente_personalizado_precio_check check (precio > 0);
  end if;
end $$;

-- Igual que el resto de tablas: RLS activo, sin políticas y sin privilegios para la página.
-- Solo el servidor (service_role) la lee; registrar_venta es security invoker y la lee con él.
alter table public.componente_personalizado enable row level security;
revoke all on public.componente_personalizado from public, anon, authenticated;
grant select on public.componente_personalizado to service_role;

-- Semilla con los ids EXACTOS del armador. "on conflict do nothing": no pisa precios ya cambiados.
insert into public.componente_personalizado (id, tipo, nombre, precio) values
  ('cone',      'envase',  'Cono',      8000),
  ('cup',       'envase',  'Copa',      8000),
  ('glass',     'envase',  'Vaso',      8000),
  ('vanilla',   'sabor',   'Vainilla',  2000),
  ('chocolate', 'sabor',   'Chocolate', 2000),
  ('fresa',     'sabor',   'Fresa',     2000),
  ('mango',     'sabor',   'Mango',     2000),
  ('menta',     'sabor',   'Menta',     2000),
  ('mora',      'sabor',   'Mora',      2000),
  ('cherry',    'topping', 'Cereza',    1000),
  ('chips',     'topping', 'Chips',     1000),
  ('coco',      'topping', 'Coco',      1000),
  ('cream',     'topping', 'Crema',     1000),
  ('gummies',   'topping', 'Gomitas',   1000),
  ('nuts',      'topping', 'Nueces',    1000),
  ('sprinkles', 'topping', 'Sprinkles', 1000),
  ('syrup',     'topping', 'Jarabe',    1000)
on conflict (id) do nothing;

-- -------------------------------------------------------------------------------------
-- 2. Reglas del armador (ÚNICO lugar con los límites; el servidor y la página las leen)
-- -------------------------------------------------------------------------------------
create or replace function public.helado_personalizado_reglas()
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('max_sabores', 3, 'max_toppings', 3);
$$;

-- -------------------------------------------------------------------------------------
-- 3. Producto "Helado personalizado 3D" (uno solo, marcado con tipo = 'personalizado')
-- -------------------------------------------------------------------------------------
create unique index if not exists producto_tipo_personalizado_key
  on public.producto (tipo) where tipo = 'personalizado';

insert into public.producto (nombre, descripcion, tipo, precio, estado, stock, categoria)
select 'Helado personalizado 3D',
       'Helado armado por el cliente en el creador 3D. El precio sale de public.componente_personalizado.',
       'personalizado', 10000, false, 0, 'Personalizado'
where not exists (select 1 from public.producto where tipo = 'personalizado');

-- -------------------------------------------------------------------------------------
-- 4. Composición vendida en el detalle
-- -------------------------------------------------------------------------------------
alter table public.detalle_venta add column if not exists personalizacion jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'detalle_venta_personalizacion_objeto'
      and conrelid = 'public.detalle_venta'::regclass
  ) then
    alter table public.detalle_venta
      add constraint detalle_venta_personalizacion_objeto
      check (personalizacion is null or jsonb_typeof(personalizacion) = 'object');
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- 5. public.registrar_venta con helado personalizado (MISMA firma que 20261111120000)
--   Líneas normales : {"id_producto": <int>, "cantidad": <int>}  (igual que antes)
--   Personalizadas  : {"tipo":"personalizado","envase":<id>,"sabores":[<id>...],
--                      "toppings":[<id>...] (opcional),"cantidad":<int>}
--   Una línea personalizada:
--     * exactamente 1 envase; 1..max_sabores sabores y 0..max_toppings toppings, sin repetir
--       (el armador no permite repetir); cada id existe, está activo y es del tipo correcto;
--     * precio = envase + sabores + toppings (tabla componente_personalizado);
--     * va en su propia fila de detalle_venta (no se suma con otras) con su composición;
--     * NO bloquea ni descuenta stock.
--   El producto personalizado no se puede pedir como línea normal (aunque alguien lo active).
-- Errores nuevos (P0001): PERSONALIZADO_INVALIDO, PERSONALIZADO_NO_DISPONIBLE.
-- Devuelve lo mismo que antes; las líneas personalizadas traen además "personalizacion".
-- -------------------------------------------------------------------------------------
create or replace function public.registrar_venta(p_id_usuario bigint, p_items jsonb, p_estado text, p_puntos_usar integer default 0)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reglas      jsonb := public.super_points_reglas();
  v_reglas_pers jsonb := public.helado_personalizado_reglas();
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
  -- Helado personalizado
  v_id_pers     bigint;
  v_nombre_pers text;
  v_sabores     text[];
  v_toppings    text[];
  v_componentes jsonb;
  v_precio_pers numeric(10,2);
  v_pers        jsonb := '[]'::jsonb;
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
    if jsonb_typeof(v_item) = 'object' and v_item ->> 'tipo' = 'personalizado' then
      -- Forma del personalizado: envase texto; sabores lista de textos; toppings lista de textos o ausente.
      v_ok := coalesce(jsonb_typeof(v_item -> 'envase'), '') = 'string'
          and coalesce(jsonb_typeof(v_item -> 'sabores'), '') = 'array'
          and coalesce(jsonb_typeof(v_item -> 'toppings'), 'array') = 'array'
          and not exists (
            select 1
            from jsonb_array_elements(coalesce(v_item -> 'sabores', '[]'::jsonb) || coalesce(v_item -> 'toppings', '[]'::jsonb)) as e
            where jsonb_typeof(e) <> 'string'
          );
      if not v_ok then
        raise exception using errcode = 'P0001', message = 'PERSONALIZADO_INVALIDO',
          detail = format('linea=%s (forma)', v_pos);
      end if;
    else
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

  -- Sumar productos normales repetidos (ordenados por id para bloquear siempre en el mismo orden).
  -- Las líneas personalizadas no entran aquí: cada una es su propia fila.
  select array_agg(l.id_producto order by l.id_producto),
         array_agg(l.cantidad order by l.id_producto)
    into v_ids, v_cantidades
  from (
    select (e ->> 'id_producto')::numeric::bigint as id_producto,
           sum((e ->> 'cantidad')::numeric::integer)::integer as cantidad
    from jsonb_array_elements(p_items) as e
    where e ->> 'tipo' is distinct from 'personalizado'
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
    select l.id_producto, l.cantidad, p.id_producto as encontrado, p.estado, p.stock, p.tipo
    from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
    left join public.producto p on p.id_producto = l.id_producto
    order by l.id_producto
  loop
    if v_fila.encontrado is null then
      raise exception using errcode = 'P0001', message = 'PRODUCTO_NO_EXISTE',
        detail = format('id_producto=%s', v_fila.id_producto);
    elsif v_fila.tipo = 'personalizado' then
      -- El personalizado solo se vende armado (con composición y precio de la tabla).
      raise exception using errcode = 'P0001', message = 'PERSONALIZADO_INVALIDO',
        detail = format('id_producto=%s (se vende solo armado)', v_fila.id_producto);
    elsif v_fila.estado is distinct from true then
      raise exception using errcode = 'P0001', message = 'PRODUCTO_INACTIVO',
        detail = format('id_producto=%s', v_fila.id_producto);
    elsif p_estado = 'Pagado' and v_fila.stock < v_fila.cantidad then
      raise exception using errcode = 'P0001', message = 'STOCK_INSUFICIENTE',
        detail = format('id_producto=%s solicitado=%s disponible=%s',
                        v_fila.id_producto, v_fila.cantidad, v_fila.stock);
    end if;
  end loop;

  -- Subtotal de los productos normales con los precios reales
  select coalesce(sum(p.precio * l.cantidad), 0)
    into v_subtotal
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto;

  -- Helados personalizados: validar contra la tabla y calcular su precio (sin stock)
  v_pos := 0;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_pos := v_pos + 1;
    continue when v_item ->> 'tipo' is distinct from 'personalizado';

    if v_id_pers is null then
      select p.id_producto, p.nombre into v_id_pers, v_nombre_pers
      from public.producto p
      where p.tipo = 'personalizado';
      if v_id_pers is null then
        raise exception using errcode = 'P0001', message = 'PERSONALIZADO_NO_DISPONIBLE';
      end if;
    end if;

    select coalesce(array_agg(e.valor order by e.n), '{}') into v_sabores
    from jsonb_array_elements_text(v_item -> 'sabores') with ordinality as e(valor, n);
    select coalesce(array_agg(e.valor order by e.n), '{}') into v_toppings
    from jsonb_array_elements_text(coalesce(v_item -> 'toppings', '[]'::jsonb)) with ordinality as e(valor, n);

    if cardinality(v_sabores) not between 1 and (v_reglas_pers ->> 'max_sabores')::integer
       or cardinality(v_toppings) > (v_reglas_pers ->> 'max_toppings')::integer
       or cardinality(v_sabores) <> (select count(distinct s) from unnest(v_sabores) as s)
       or cardinality(v_toppings) <> (select count(distinct t) from unnest(v_toppings) as t) then
      raise exception using errcode = 'P0001', message = 'PERSONALIZADO_INVALIDO',
        detail = format('linea=%s sabores=%s toppings=%s', v_pos, cardinality(v_sabores), cardinality(v_toppings));
    end if;

    -- Cada id elegido, con su tipo, en el orden del cliente (el envase va primero).
    select jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'precio', c.precio, 'tipo', c.tipo)
                     order by el.orden)
      into v_componentes
    from (
      select v_item ->> 'envase' as id, 'envase' as tipo, 0 as orden
      union all
      select s.id, 'sabor', s.n from unnest(v_sabores) with ordinality as s(id, n)
      union all
      select t.id, 'topping', 100 + t.n from unnest(v_toppings) with ordinality as t(id, n)
    ) as el
    join public.componente_personalizado c on c.id = el.id and c.tipo = el.tipo and c.activo;

    if coalesce(jsonb_array_length(v_componentes), 0) <> 1 + cardinality(v_sabores) + cardinality(v_toppings) then
      raise exception using errcode = 'P0001', message = 'PERSONALIZADO_INVALIDO',
        detail = format('linea=%s (componente inexistente, inactivo o de otro tipo)', v_pos);
    end if;

    select sum((c ->> 'precio')::numeric) into v_precio_pers from jsonb_array_elements(v_componentes) as c;

    v_pers := v_pers || jsonb_build_array(jsonb_build_object(
      'cantidad', (v_item ->> 'cantidad')::numeric::integer,
      'precio_unitario', v_precio_pers,
      'personalizacion', jsonb_build_object(
        'envase', (select c - 'tipo' from jsonb_array_elements(v_componentes) as c where c ->> 'tipo' = 'envase'),
        'sabores', coalesce((select jsonb_agg(c - 'tipo' order by n) from jsonb_array_elements(v_componentes) with ordinality as x(c, n) where c ->> 'tipo' = 'sabor'), '[]'::jsonb),
        'toppings', coalesce((select jsonb_agg(c - 'tipo' order by n) from jsonb_array_elements(v_componentes) with ordinality as x(c, n) where c ->> 'tipo' = 'topping'), '[]'::jsonb)
      )
    ));
    v_subtotal := v_subtotal + v_precio_pers * (v_item ->> 'cantidad')::numeric::integer;
  end loop;

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
    -- Sin pct_max (nivel desconocido) el tope es 0: nunca se salta el tope.
    v_tope := coalesce(floor(v_subtotal * coalesce((v_resumen ->> 'pct_max')::integer, 0) / 100
                             / (v_reglas ->> 'valor_punto')::integer)::integer, 0);
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

  -- Personalizados: una fila por línea, en el orden del carrito, con su composición.
  insert into public.detalle_venta (id_venta, id_producto, cantidad, precio_unitario, personalizacion)
  select v_id_venta, v_id_pers, (x.l ->> 'cantidad')::integer, (x.l ->> 'precio_unitario')::numeric, x.l -> 'personalizacion'
  from jsonb_array_elements(v_pers) with ordinality as x(l, n)
  order by x.n;

  -- Descontar stock solo si se pagó (con guarda "stock >= cantidad" por seguridad).
  -- Los personalizados no descuentan stock.
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

  select coalesce(jsonb_agg(jsonb_build_object(
           'id_producto', l.id_producto,
           'nombre', p.nombre,
           'cantidad', l.cantidad,
           'precio_unitario', p.precio,
           'subtotal', p.precio * l.cantidad
         ) order by l.id_producto), '[]'::jsonb)
    into v_items_out
  from unnest(v_ids, v_cantidades) as l(id_producto, cantidad)
  join public.producto p on p.id_producto = l.id_producto;

  select v_items_out || coalesce(jsonb_agg(jsonb_build_object(
           'id_producto', v_id_pers,
           'nombre', v_nombre_pers,
           'cantidad', (x.l ->> 'cantidad')::integer,
           'precio_unitario', (x.l ->> 'precio_unitario')::numeric,
           'subtotal', (x.l ->> 'precio_unitario')::numeric * (x.l ->> 'cantidad')::integer,
           'personalizacion', x.l -> 'personalizacion'
         ) order by x.n), '[]'::jsonb)
    into v_items_out
  from jsonb_array_elements(v_pers) with ordinality as x(l, n);

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
  'Checkout transaccional (todo o nada) con canje de Super Points y helado personalizado. Precios desde producto.precio y componente_personalizado.precio. Solo service_role. Errores P0001 con message = código estable.';

-- -------------------------------------------------------------------------------------
-- 6. Privilegios mínimos: solo el backend (service_role). Postgres/Supabase dan EXECUTE por
-- defecto a PUBLIC/anon/authenticated, por eso se revoca explícitamente en cada ejecución.
-- -------------------------------------------------------------------------------------
revoke execute on function public.helado_personalizado_reglas() from public, anon, authenticated;
revoke execute on function public.registrar_venta(bigint, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.helado_personalizado_reglas() to service_role;
grant execute on function public.registrar_venta(bigint, jsonb, text, integer) to service_role;

-- Avisar a la API REST de Supabase (PostgREST) que recargue el esquema (se envía al COMMIT).
notify pgrst, 'reload schema';

commit;
