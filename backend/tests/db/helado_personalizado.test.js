// Pruebas de la migración 20261120130000_helado_personalizado: el helado armado en 3D se paga de verdad.
//  * public.componente_personalizado: envases, sabores y toppings con su precio (la única fuente).
//  * Un producto real "Helado personalizado 3D" (tipo = 'personalizado', estado = false: fuera del catálogo).
//  * registrar_venta acepta líneas {tipo:'personalizado', envase, sabores, toppings, cantidad}: valida
//    en la base, calcula el precio con la tabla, guarda la composición y NO descuenta stock.
// Modelo de precios (aditivo): envase $8.000 + $2.000 por sabor + $1.000 por topping. Da lo mismo que
// la fórmula que mostraba el armador: $10.000 + $2.000 por bola extra + $1.000 por topping.
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearBase, valor, contar, leer, RUTA_MIGRACION_RLS } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_PUNTOS = resolve(raizSupabase, 'migrations/20261111120000_super_points.sql');
const RUTA_NIVEL_SALDO = resolve(raizSupabase, 'migrations/20261120120000_nivel_por_saldo.sql');
const RUTA_PERSONALIZADO = resolve(raizSupabase, 'migrations/20261120130000_helado_personalizado.sql');
const RUTA_ROLLBACK_PERSONALIZADO = resolve(raizSupabase, 'rollbacks/20261120130000_helado_personalizado.rollback.sql');

// Igual que la base real: migraciones en orden
// (ventas -> candados RLS -> Super Points -> nivel por saldo -> personalizado).
async function base() {
  const db = await crearBase();
  await db.exec(leer(RUTA_MIGRACION_RLS));
  await db.exec(leer(RUTA_PUNTOS));
  await db.exec(leer(RUTA_NIVEL_SALDO));
  await db.exec(leer(RUTA_PERSONALIZADO));
  return db;
}

async function errorDe(fn) {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error('Se esperaba un error y no hubo ninguno');
}

async function vender(db, idUsuario, items, estado = 'Pagado', puntos = 0) {
  const r = await db.query('select public.registrar_venta($1, $2::jsonb, $3, $4) as r',
    [idUsuario, JSON.stringify(items), estado, puntos]);
  return r.rows[0].r;
}

const helado = (extra = {}) => ({
  tipo: 'personalizado', envase: 'cone', sabores: ['vanilla'], toppings: [], cantidad: 1, ...extra,
});

const idPersonalizado = (db) => valor(db, "select id_producto from public.producto where tipo = 'personalizado'");
const stockDe = async (db, id) =>
  Number(await valor(db, 'select stock from public.producto where id_producto = $1', [id]));

const SABORES = ['vanilla', 'chocolate', 'fresa', 'mango', 'menta', 'mora'];
const TOPPINGS = ['cherry', 'chips', 'coco', 'cream', 'gummies', 'nuts', 'sprinkles', 'syrup'];

describe('tabla de componentes y producto personalizado', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('siembra los ids EXACTOS del armador 3D con su tipo y precio', async () => {
    const r = await db.query('select id, tipo, precio, activo from public.componente_personalizado order by tipo, id');
    const por = (tipo) => r.rows.filter((f) => f.tipo === tipo);
    expect(por('envase').map((f) => f.id).sort()).toEqual(['cone', 'cup', 'glass']);
    expect(por('sabor').map((f) => f.id).sort()).toEqual([...SABORES].sort());
    expect(por('topping').map((f) => f.id).sort()).toEqual([...TOPPINGS].sort());
    expect(por('envase').every((f) => Number(f.precio) === 8000)).toBe(true);
    expect(por('sabor').every((f) => Number(f.precio) === 2000)).toBe(true);
    expect(por('topping').every((f) => Number(f.precio) === 1000)).toBe(true);
    expect(r.rows.every((f) => f.activo === true)).toBe(true);
  });

  it('el tipo solo puede ser envase, sabor o topping y el precio no puede ser negativo', async () => {
    const e1 = await errorDe(() => db.exec("insert into public.componente_personalizado (id, tipo, nombre, precio) values ('x', 'otro', 'X', 1)"));
    expect(e1.code).toBe('23514');
    const e2 = await errorDe(() => db.exec("insert into public.componente_personalizado (id, tipo, nombre, precio) values ('y', 'sabor', 'Y', -1)"));
    expect(e2.code).toBe('23514');
  });

  it('un componente no puede costar $0 (precio > 0)', async () => {
    const e = await errorDe(() => db.exec("insert into public.componente_personalizado (id, tipo, nombre, precio) values ('gratis', 'topping', 'Gratis', 0)"));
    expect(e.code).toBe('23514');
  });

  it('si el check de precio quedó con otra definición (precio >= 0), volver a correr la migración lo corrige', async () => {
    await db.exec(`
      alter table public.componente_personalizado drop constraint componente_personalizado_precio_check;
      alter table public.componente_personalizado add constraint componente_personalizado_precio_check check (precio >= 0);`);
    await db.exec(leer(RUTA_PERSONALIZADO));
    const e = await errorDe(() => db.exec("insert into public.componente_personalizado (id, tipo, nombre, precio) values ('gratis', 'topping', 'Gratis', 0)"));
    expect(e.code).toBe('23514');
  });

  it('las reglas (máximo de sabores y toppings) viven en la base', async () => {
    const r = (await db.query('select public.helado_personalizado_reglas() as r')).rows[0].r;
    expect(r).toEqual({ max_sabores: 3, max_toppings: 3 });
  });

  it('hay exactamente un producto personalizado y está fuera del catálogo (estado = false)', async () => {
    const r = await db.query("select nombre, estado from public.producto where tipo = 'personalizado'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toEqual({ nombre: 'Helado personalizado 3D', estado: false });
    const e = await errorDe(() => db.exec(
      "insert into public.producto (nombre, precio, tipo, estado) values ('Otro', 1, 'personalizado', false)"));
    expect(e.code).toBe('23505');
  });

  it('detalle_venta.personalizacion existe, es opcional y solo acepta un objeto', async () => {
    const r = await db.query(`select is_nullable, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'detalle_venta' and column_name = 'personalizacion'`);
    expect(r.rows[0]).toEqual({ is_nullable: 'YES', data_type: 'jsonb' });
    const e = await errorDe(() => db.exec(
      "insert into public.detalle_venta (id_venta, id_producto, cantidad, precio_unitario, personalizacion) values (15, 5, 1, 1, '[1]')"));
    expect(e.code).toBe('23514');
  });
});

describe('registrar_venta con helado personalizado', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('reproduce los mismos totales que mostraba el armador (1-3 sabores, 0-3 toppings)', async () => {
    for (let n = 1; n <= 3; n += 1) {
      for (let t = 0; t <= 3; t += 1) {
        const esperado = 10000 + Math.max(0, n - 1) * 2000 + t * 1000;
        const v = await vender(db, null, [helado({ sabores: SABORES.slice(0, n), toppings: TOPPINGS.slice(0, t) })]);
        expect(Number(v.total)).toBe(esperado);
      }
    }
  });

  it('un personalizado válido crea la venta con el precio de la base y guarda la composición', async () => {
    const v = await vender(db, 1, [helado({ envase: 'cup', sabores: ['chocolate', 'fresa'], toppings: ['cherry'], cantidad: 2 })]);
    expect(Number(v.total)).toBe(26000); // (8000 + 2*2000 + 1000) x 2
    const idPers = await idPersonalizado(db);
    const d = await db.query('select id_producto, cantidad, precio_unitario, personalizacion from public.detalle_venta where id_venta = $1', [v.id_venta]);
    expect(d.rows).toHaveLength(1);
    expect(Number(d.rows[0].id_producto)).toBe(Number(idPers));
    expect(d.rows[0].cantidad).toBe(2);
    expect(Number(d.rows[0].precio_unitario)).toBe(13000);
    expect(d.rows[0].personalizacion).toEqual({
      envase: { id: 'cup', nombre: 'Copa', precio: 8000 },
      sabores: [{ id: 'chocolate', nombre: 'Chocolate', precio: 2000 }, { id: 'fresa', nombre: 'Fresa', precio: 2000 }],
      toppings: [{ id: 'cherry', nombre: 'Cereza', precio: 1000 }],
    });
    expect(v.items).toEqual([expect.objectContaining({
      nombre: 'Helado personalizado 3D', cantidad: 2, personalizacion: d.rows[0].personalizacion,
    })]);
    expect(Number(v.items[0].precio_unitario)).toBe(13000);
    expect(Number(v.items[0].subtotal)).toBe(26000);
  });

  it('acepta toppings ausentes como lista vacía', async () => {
    const it = helado();
    delete it.toppings;
    const v = await vender(db, null, [it]);
    expect(Number(v.total)).toBe(10000);
  });

  it('no descuenta stock del producto personalizado (nunca se agota)', async () => {
    const idPers = await idPersonalizado(db);
    const antes = await stockDe(db, idPers);
    await vender(db, 1, [helado({ cantidad: 99 })]);
    expect(await stockDe(db, idPers)).toBe(antes);
  });

  it('se mezcla con productos normales: suma ambos y descuenta solo el stock normal', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }, helado({ toppings: ['nuts'] })]);
    expect(Number(v.total)).toBe(2 * 2500 + 11000);
    expect(await stockDe(db, 5)).toBe(8);
    expect(await contar(db, 'detalle_venta')).toBe(2);
    expect(v.items.map((i) => i.nombre)).toEqual(['Helado de fresa', 'Helado personalizado 3D']);
  });

  it('dos helados distintos en el mismo carrito son dos líneas del detalle', async () => {
    const v = await vender(db, 1, [helado(), helado({ sabores: ['mora'], toppings: ['coco'] })]);
    expect(Number(v.total)).toBe(10000 + 11000);
    const r = await db.query('select personalizacion from public.detalle_venta where id_venta = $1 order by id_detalle_venta', [v.id_venta]);
    expect(r.rows.map((f) => f.personalizacion.sabores[0].id)).toEqual(['vanilla', 'mora']);
  });

  it('gana Super Points como cualquier compra', async () => {
    const v = await vender(db, 1, [helado({ sabores: ['vanilla', 'mango'] })]); // $12.000
    expect(v.puntos_ganados).toBe(120);
    expect(Number(await valor(db, "select puntos_generados from public.super_points where id_venta = $1 and tipo = 'ganado'", [v.id_venta]))).toBe(120);
  });

  it('el canje usa el subtotal del personalizado para el tope', async () => {
    const vieja = await valor(db, "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'ganado', 100)", [vieja]);
    // Lover: 5 % de $10.000 = $500 = 100 puntos.
    const v = await vender(db, 1, [helado()], 'Pagado', 100);
    expect(Number(v.total)).toBe(9500);
    const e = await errorDe(() => vender(db, 1, [helado()], 'Pagado', 101));
    expect(e.message).toBe('PUNTOS_INSUFICIENTES');
  });

  it('el tope del canje con personalizado usa el nivel del SALDO antes de la compra (no lo ganado en la historia)', async () => {
    // Ganó 1200 (sería Master, 20 %) pero gastó 800: saldo 400 = Fan (10 %).
    const ventaA = await valor(db, "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    const ventaB = await valor(db, "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'ganado', 1200)", [ventaA]);
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'canjeado', -800)", [ventaB]);
    // Personalizado de $10.000: Fan -> tope 10 % = $1.000 = 200 puntos (con Master serían 400).
    const e = await errorDe(() => vender(db, 1, [helado()], 'Pagado', 201));
    expect(e.message).toBe('PUNTOS_EXCEDEN_TOPE');
    const v = await vender(db, 1, [helado()], 'Pagado', 200);
    expect(Number(v.total)).toBe(9000);
    expect(v.puntos_usados).toBe(200);
    expect(v.puntos_ganados).toBe(90);
    expect(v.saldo).toBe(400 - 200 + 90);
  });

  it('un pago fallido registra el personalizado sin puntos', async () => {
    const v = await vender(db, 1, [helado()], 'Fallido');
    expect(v.estado).toBe('Fallido');
    expect(v.puntos_ganados).toBe(0);
    expect(await contar(db, 'detalle_venta')).toBe(1);
  });

  const invalidos = [
    ['envase inexistente', { envase: 'balde' }],
    ['sabor inexistente', { sabores: ['pistacho'] }],
    ['topping inexistente', { toppings: ['oro'] }],
    ['un topping usado como sabor', { sabores: ['cherry'] }],
    ['un sabor usado como envase', { envase: 'vanilla' }],
    ['un envase usado como topping', { toppings: ['cup'] }],
    ['sin envase', { envase: undefined }],
    ['dos envases', { envase: ['cone', 'cup'] }],
    ['sin sabores', { sabores: [] }],
    ['sabores ausentes', { sabores: undefined }],
    ['demasiados sabores', { sabores: ['vanilla', 'chocolate', 'fresa', 'mango'] }],
    ['demasiados toppings', { toppings: ['cherry', 'chips', 'coco', 'cream'] }],
    ['sabor repetido', { sabores: ['vanilla', 'vanilla'] }],
    ['topping repetido', { toppings: ['coco', 'coco'] }],
    ['sabor que no es texto', { sabores: [7] }],
    ['toppings que no son lista', { toppings: 'cherry' }],
  ];
  for (const [caso, extra] of invalidos) {
    it(`${caso} -> PERSONALIZADO_INVALIDO sin crear venta`, async () => {
      const ventas = await contar(db, 'venta');
      const e = await errorDe(() => vender(db, 1, [{ id_producto: 5, cantidad: 1 }, helado(extra)]));
      expect(e.code).toBe('P0001');
      expect(e.message).toBe('PERSONALIZADO_INVALIDO');
      expect(await contar(db, 'venta')).toBe(ventas);
      expect(await stockDe(db, 5)).toBe(10);
    });
  }

  it('un componente inactivo -> PERSONALIZADO_INVALIDO', async () => {
    await db.exec("update public.componente_personalizado set activo = false where id = 'menta'");
    const e = await errorDe(() => vender(db, 1, [helado({ sabores: ['menta'] })]));
    expect(e.message).toBe('PERSONALIZADO_INVALIDO');
  });

  it('cantidad inválida en un personalizado -> CANTIDAD_INVALIDA', async () => {
    const e = await errorDe(() => vender(db, 1, [helado({ cantidad: 0 })]));
    expect(e.message).toBe('CANTIDAD_INVALIDA');
    const e2 = await errorDe(() => vender(db, 1, [helado({ cantidad: 100 })]));
    expect(e2.message).toBe('CANTIDAD_INVALIDA');
  });

  it('el producto personalizado no se puede comprar como producto normal, aunque lo activen', async () => {
    const idPers = Number(await idPersonalizado(db));
    await db.exec(`update public.producto set estado = true, stock = 50 where id_producto = ${idPers}`);
    const e = await errorDe(() => vender(db, 1, [{ id_producto: idPers, cantidad: 1 }]));
    expect(e.message).toBe('PERSONALIZADO_INVALIDO');
  });

  it('sin el producto personalizado en la base -> PERSONALIZADO_NO_DISPONIBLE', async () => {
    await db.exec("delete from public.producto where tipo = 'personalizado'");
    const e = await errorDe(() => vender(db, 1, [helado()]));
    expect(e.message).toBe('PERSONALIZADO_NO_DISPONIBLE');
  });

  it('los productos normales siguen igual (precio, stock, detalle sin composición)', async () => {
    const v = await vender(db, 1, [{ id_producto: 13, cantidad: 2 }, { id_producto: 5, cantidad: 1 }, { id_producto: 13, cantidad: 1 }]);
    expect(Number(v.total)).toBe(2500 + 3 * 1200.5);
    expect(await stockDe(db, 13)).toBe(0);
    const r = await db.query('select id_producto, cantidad, personalizacion from public.detalle_venta where id_venta = $1 order by id_producto', [v.id_venta]);
    expect(r.rows.map((f) => [Number(f.id_producto), f.cantidad, f.personalizacion])).toEqual([[5, 1, null], [13, 3, null]]);
    const e = await errorDe(() => vender(db, 1, [{ id_producto: 6, cantidad: 1 }]));
    expect(e.message).toBe('PRODUCTO_INACTIVO');
    const e2 = await errorDe(() => vender(db, 1, [{ id_producto: 5, cantidad: 11 }]));
    expect(e2.message).toBe('STOCK_INSUFICIENTE');
    const e3 = await errorDe(() => vender(db, 1, [{ cantidad: 1 }]));
    expect(e3.message).toBe('ITEM_INVALIDO');
  });

  it('si el nivel no trae pct_max, el tope de canje es 0 (nunca se salta el tope)', async () => {
    const vieja = await valor(db, "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'ganado', 100)", [vieja]);
    await db.exec(`
      create or replace function public.super_points_resumen(p_id_usuario bigint)
      returns jsonb language sql stable set search_path = '' as $$
        select jsonb_build_object('saldo', 100, 'ganados', 100, 'nivel', null, 'pct_max', null);
      $$;`);
    const e = await errorDe(() => vender(db, 1, [{ id_producto: 5, cantidad: 4 }], 'Pagado', 1));
    expect(e.message).toBe('PUNTOS_EXCEDEN_TOPE');
  });
});

describe('permisos', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('anon y authenticated no pueden leer la tabla de componentes', async () => {
    for (const rol of ['anon', 'authenticated']) {
      await db.exec(`set role ${rol}`);
      const e = await errorDe(() => db.query('select * from public.componente_personalizado'));
      await db.exec('reset role');
      expect(e.code).toBe('42501');
    }
    const rls = await valor(db, "select relrowsecurity from pg_class where oid = 'public.componente_personalizado'::regclass");
    expect(rls).toBe(true);
  });

  it('service_role vende un personalizado (tiene lectura de la tabla y ejecución de la función)', async () => {
    await db.exec('set role service_role');
    const v = await vender(db, 1, [helado({ toppings: ['syrup'] })]);
    const reglas = (await db.query('select public.helado_personalizado_reglas() as r')).rows[0].r;
    await db.exec('reset role');
    expect(Number(v.total)).toBe(11000);
    expect(reglas.max_sabores).toBe(3);
  });

  it('solo service_role ejecuta registrar_venta y las reglas del personalizado', async () => {
    for (const fn of ['public.registrar_venta(bigint, jsonb, text, integer)', 'public.helado_personalizado_reglas()']) {
      for (const rol of ['anon', 'authenticated']) {
        expect(await valor(db, `select has_function_privilege('${rol}', '${fn}', 'execute')`)).toBe(false);
      }
      expect(await valor(db, `select has_function_privilege('service_role', '${fn}', 'execute')`)).toBe(true);
    }
  });

  it('las funciones nuevas son security invoker con search_path vacío', async () => {
    const r = await db.query(`select proname, prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace and proname in ('registrar_venta', 'helado_personalizado_reglas')`);
    expect(r.rows).toHaveLength(2);
    for (const f of r.rows) {
      expect(f.prosecdef).toBe(false);
      expect(f.proconfig).toContain('search_path=""');
    }
  });
});

describe('migración idempotente y rollback', () => {
  it('se puede aplicar dos veces sin duplicar nada', async () => {
    const db = await base();
    await db.exec(leer(RUTA_PERSONALIZADO));
    expect(await contar(db, 'componente_personalizado')).toBe(17);
    expect(Number(await valor(db, "select count(*) from public.producto where tipo = 'personalizado'"))).toBe(1);
    const v = await vender(db, 1, [helado()]);
    expect(Number(v.total)).toBe(10000);
  });

  it('no pisa los precios que alguien ya cambió en la tabla', async () => {
    const db = await base();
    await db.exec("update public.componente_personalizado set precio = 2500 where id = 'mora'");
    await db.exec(leer(RUTA_PERSONALIZADO));
    expect(Number(await valor(db, "select precio from public.componente_personalizado where id = 'mora'"))).toBe(2500);
  });

  it('el rollback deshace todo, deja las ventas normales funcionando y se puede repetir', async () => {
    const db = await base();
    await db.exec(leer(RUTA_ROLLBACK_PERSONALIZADO));
    await db.exec(leer(RUTA_ROLLBACK_PERSONALIZADO));
    expect(await valor(db, "select to_regclass('public.componente_personalizado')")).toBe(null);
    expect(await valor(db, "select count(*) from information_schema.columns where table_name = 'detalle_venta' and column_name = 'personalizacion'")).toBe(0);
    expect(Number(await valor(db, "select count(*) from public.producto where tipo = 'personalizado'"))).toBe(0);
    expect(await valor(db, "select to_regprocedure('public.helado_personalizado_reglas()')")).toBe(null);
    const e = await errorDe(() => vender(db, 1, [helado()]));
    expect(e.message).toBe('ITEM_INVALIDO');
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 1 }]);
    expect(Number(v.total)).toBe(2500);
    expect(await valor(db, "select has_function_privilege('anon', 'public.registrar_venta(bigint, jsonb, text, integer)', 'execute')")).toBe(false);
    // Y se puede volver a aplicar después del rollback.
    await db.exec(leer(RUTA_PERSONALIZADO));
    expect(Number((await vender(db, 1, [helado()])).total)).toBe(10000);
  });

  it('el rollback no falla si ya hubo ventas personalizadas (el producto queda, sin composición)', async () => {
    const db = await base();
    await vender(db, 1, [helado()]);
    await db.exec(leer(RUTA_ROLLBACK_PERSONALIZADO));
    expect(await contar(db, 'detalle_venta')).toBe(1);
    expect(await valor(db, "select to_regclass('public.componente_personalizado')")).toBe(null);
  });
});
