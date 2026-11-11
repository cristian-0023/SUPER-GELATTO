// Pruebas de la migración 20261111120000_super_points: libreta de Super Points, canje dentro de
// registrar_venta y movimientos de puntos al cambiar el estado de una venta (cambiar_estado_venta).
// Reglas (diseño 2026-11-04): $100 pagados = 1 punto (piso), 1 punto = $5, niveles por puntos ganados
// Lover 0-100 (5 %), Fan 101-500 (10 %), Pro 501-1000 (15 %), Master 1001+ (20 %).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearBase, registrarVenta, valor, contar, leer, RUTA_MIGRACION_RLS } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_PUNTOS = resolve(raizSupabase, 'migrations/20261111120000_super_points.sql');
const RUTA_ROLLBACK_PUNTOS = resolve(raizSupabase, 'rollbacks/20261111120000_super_points.rollback.sql');

// Igual que la base real: migraciones en orden (ventas -> candados RLS -> Super Points).
async function base() {
  const db = await crearBase();
  await db.exec(leer(RUTA_MIGRACION_RLS));
  await db.exec(leer(RUTA_PUNTOS));
  // Producto barato (para totales < $100) y un segundo cliente.
  await db.exec(`
    insert into public.producto (id_producto, nombre, precio, estado, stock) values (20, 'Mini cono', 99.99, true, 50);
    insert into public.usuario (id_usuario, nombre, apellido, email, password_hash, rol)
    values (2, 'Beto', 'Prueba', 'beto@test.local', 'x', 'cliente');
  `);
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

async function vender(db, idUsuario, items, estado, puntos) {
  const r = await db.query('select public.registrar_venta($1, $2::jsonb, $3, $4) as r',
    [idUsuario, JSON.stringify(items), estado, puntos]);
  return r.rows[0].r;
}

const cambiar = async (db, idVenta, estado) =>
  (await db.query('select public.cambiar_estado_venta($1, $2) as r', [idVenta, estado])).rows[0].r;

const resumen = async (db, idUsuario) =>
  (await db.query('select public.super_points_resumen($1) as r', [idUsuario])).rows[0].r;

// Simula puntos ganados en una compra anterior (una venta propia con su fila 'ganado').
async function darPuntos(db, idUsuario, puntos) {
  const idVenta = await valor(db,
    "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', $1, 'Pagado') returning id_venta",
    [idUsuario]);
  await db.query(
    "insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values ($1, $2, 'ganado', $3)",
    [idUsuario, idVenta, puntos]);
  return idVenta;
}

// Movimientos de una venta: { ganado: 180, canjeado: -400, ... }
async function movimientos(db, idVenta) {
  const r = await db.query('select tipo, puntos_generados from public.super_points where id_venta = $1', [idVenta]);
  return Object.fromEntries(r.rows.map((f) => [f.tipo, f.puntos_generados]));
}

const stockDe = async (db, id) =>
  Number(await valor(db, 'select stock from public.producto where id_producto = $1', [id]));

const VEINTE_MIL = [{ id_producto: 5, cantidad: 8 }]; // 8 x $2.500 = $20.000

describe('reglas y resumen', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('super_points_reglas devuelve los valores del programa (único lugar donde viven)', async () => {
    const r = (await db.query('select public.super_points_reglas() as r')).rows[0].r;
    expect(r).toEqual({
      pesos_por_punto: 100,
      valor_punto: 5,
      niveles: [
        { nombre: 'Lover', min: 0, max: 100, pct: 5 },
        { nombre: 'Fan', min: 101, max: 500, pct: 10 },
        { nombre: 'Pro', min: 501, max: 1000, pct: 15 },
        { nombre: 'Master', min: 1001, max: null, pct: 20 },
      ],
    });
  });

  it('cliente sin movimientos: saldo 0, Lover, le faltan 101 para Fan', async () => {
    expect(await resumen(db, 1)).toEqual({
      saldo: 0, ganados: 0, nivel: 'Lover', pct_max: 5, valor_saldo: 0,
      puntos_para_siguiente: 101, siguiente_nivel: 'Fan',
    });
  });

  it.each([
    [100, 'Lover', 5, 1, 'Fan'],
    [101, 'Fan', 10, 400, 'Pro'],
    [500, 'Fan', 10, 1, 'Pro'],
    [501, 'Pro', 15, 500, 'Master'],
    [1000, 'Pro', 15, 1, 'Master'],
    [1001, 'Master', 20, 0, null],
  ])('nivel en la frontera: %i puntos ganados -> %s', async (puntos, nivel, pct, faltan, siguiente) => {
    await darPuntos(db, 1, puntos);
    const r = await resumen(db, 1);
    expect(r).toMatchObject({ saldo: puntos, ganados: puntos, nivel, pct_max: pct, valor_saldo: puntos * 5 });
    expect(r.puntos_para_siguiente).toBe(faltan);
    expect(r.siguiente_nivel).toBe(siguiente);
  });

  it('gastar puntos no baja el nivel (cuenta lo ganado, no el saldo)', async () => {
    await darPuntos(db, 1, 600);
    const idVenta = await valor(db,
      "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    await db.query(
      "insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'canjeado', -550)", [idVenta]);
    expect(await resumen(db, 1)).toMatchObject({ saldo: 50, ganados: 600, nivel: 'Pro' });
  });
});

describe('libreta: restricciones', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('rechaza tipos inventados, signos al revés y un mismo tipo repetido en la misma venta', async () => {
    const idVenta = await darPuntos(db, 1, 10);
    const ins = (tipo, puntos) => db.query(
      'insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, $2, $3)',
      [idVenta, tipo, puntos]);
    expect((await errorDe(() => ins('regalo', 5))).code).toBe('23514');
    expect((await errorDe(() => ins('canjeado', 5))).code).toBe('23514');
    expect((await errorDe(() => ins('devuelto', -5))).code).toBe('23514');
    expect((await errorDe(() => ins('ganado', 3))).code).toBe('23505');
  });

  it('venta.puntos_usados y venta.descuento_puntos existen con 0 por defecto', async () => {
    const r = await db.query(
      "insert into public.venta (total, tipo_venta) values (1, 'Online') returning puntos_usados, descuento_puntos");
    expect(r.rows[0].puntos_usados).toBe(0);
    expect(Number(r.rows[0].descuento_puntos)).toBe(0);
  });

  it('crea el índice por usuario y fecha para el historial', async () => {
    const r = await db.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'super_points'");
    expect(r.rows.map((x) => x.indexname)).toContain('super_points_id_usuario_fecha_idx');
  });
});

describe('registrar_venta con puntos', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('gana piso(total/100) puntos y los anota en la libreta', async () => {
    const r = await vender(db, 1, [{ id_producto: 13, cantidad: 2 }, { id_producto: 5, cantidad: 1 }], 'Pagado', 0);
    // 2 x 1200.50 + 2500 = 4901 -> 49 puntos
    expect(r).toMatchObject({ estado: 'Pagado', puntos_usados: 0, descuento: 0, puntos_ganados: 49, saldo: 49 });
    expect(Number(r.total)).toBeCloseTo(4901, 2);
    expect(await movimientos(db, r.id_venta)).toEqual({ ganado: 49 });
  });

  it('canje descuenta y gana sobre lo pagado (Fan, $20.000, 400 puntos -> total 18000, gana 180)', async () => {
    await darPuntos(db, 1, 500); // Fan
    const r = await vender(db, 1, VEINTE_MIL, 'Pagado', 400);

    expect(Number(r.total)).toBe(18000);
    expect(Number(r.subtotal)).toBe(20000);
    expect(r).toMatchObject({ puntos_usados: 400, descuento: 2000, puntos_ganados: 180, saldo: 280 });
    expect(await movimientos(db, r.id_venta)).toEqual({ canjeado: -400, ganado: 180 });
    const v = (await db.query('select total, puntos_usados, descuento_puntos from public.venta where id_venta = $1', [r.id_venta])).rows[0];
    expect(Number(v.total)).toBe(18000);
    expect(v.puntos_usados).toBe(400);
    expect(Number(v.descuento_puntos)).toBe(2000);
  });

  it('excede el tope del nivel -> PUNTOS_EXCEDEN_TOPE y no queda venta ni cambio de stock', async () => {
    await darPuntos(db, 1, 500); // Fan: tope de $20.000 = 400 puntos
    const ventas = await contar(db, 'venta');
    const e = await errorDe(() => vender(db, 1, VEINTE_MIL, 'Pagado', 401));
    expect(e.code).toBe('P0001');
    expect(e.message).toBe('PUNTOS_EXCEDEN_TOPE');
    expect(await contar(db, 'venta')).toBe(ventas);
    expect(await stockDe(db, 5)).toBe(10);
    expect((await resumen(db, 1)).saldo).toBe(500);
  });

  it('excede el saldo -> PUNTOS_INSUFICIENTES y no queda venta', async () => {
    await darPuntos(db, 1, 50); // Lover: tope 200, pero solo tiene 50
    const ventas = await contar(db, 'venta');
    const e = await errorDe(() => vender(db, 1, VEINTE_MIL, 'Pagado', 60));
    expect(e.message).toBe('PUNTOS_INSUFICIENTES');
    expect(await contar(db, 'venta')).toBe(ventas);
    expect(await stockDe(db, 5)).toBe(10);
  });

  it('valor negativo -> PUNTOS_INVALIDOS', async () => {
    const e = await errorDe(() => vender(db, 1, VEINTE_MIL, 'Pagado', -1));
    expect(e.message).toBe('PUNTOS_INVALIDOS');
  });

  it('compra anónima no puede canjear', async () => {
    const e = await errorDe(() => vender(db, null, VEINTE_MIL, 'Pagado', 1));
    expect(e.message).toBe('PUNTOS_INSUFICIENTES');
  });

  it('Fallido no mueve puntos aunque pida canjear', async () => {
    await darPuntos(db, 1, 500);
    const r = await vender(db, 1, VEINTE_MIL, 'Fallido', 400);
    expect(Number(r.total)).toBe(20000);
    expect(r).toMatchObject({ puntos_usados: 0, descuento: 0, puntos_ganados: 0, saldo: 500 });
    expect(await movimientos(db, r.id_venta)).toEqual({});
  });

  it('total menor a $100 -> 0 puntos, sin fila ganado y sin error', async () => {
    const r = await vender(db, 1, [{ id_producto: 20, cantidad: 1 }], 'Pagado', 0);
    expect(r.puntos_ganados).toBe(0);
    expect(await movimientos(db, r.id_venta)).toEqual({});
  });

  it('dos canjes seguidos no pasan del saldo', async () => {
    await darPuntos(db, 1, 300); // Fan
    const r1 = await vender(db, 1, VEINTE_MIL, 'Pagado', 300); // descuento $1.500: paga 18500, gana 185
    expect(r1.saldo).toBe(185);
    const e = await errorDe(() => vender(db, 1, [{ id_producto: 13, cantidad: 2 }], 'Pagado', 200));
    expect(e.message).toBe('PUNTOS_INSUFICIENTES');
    expect((await resumen(db, 1)).saldo).toBe(185);
  });

  it('bloquea la fila del cliente antes de leer el saldo (pagos simultáneos se hacen en fila)', async () => {
    const src = await valor(db, "select prosrc from pg_proc where proname = 'registrar_venta'");
    expect(src).toMatch(/from public\.usuario[\s\S]*for (no key )?update/i);
  });

  it('la llamada de 3 argumentos sigue funcionando (código viejo durante la publicación)', async () => {
    const r = await registrarVenta(db, 1, [{ id_producto: 5, cantidad: 1 }], 'Pagado');
    expect(Number(r.total)).toBe(2500);
    expect(r.puntos_ganados).toBe(25);
  });

  it('queda una sola versión de registrar_venta (sin ambigüedad para la API)', async () => {
    expect(Number(await valor(db, "select count(*) from pg_proc where proname = 'registrar_venta'"))).toBe(1);
  });
});

describe('cambiar_estado_venta', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('Fallido -> Pagado otorga los puntos una sola vez', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0); // $5.000
    const r = await cambiar(db, v.id_venta, 'Pagado');
    expect(r).toMatchObject({ id_venta: v.id_venta, estado: 'Pagado', estado_anterior: 'Fallido', id_usuario: 1 });
    expect(await movimientos(db, v.id_venta)).toEqual({ ganado: 50 });
    await cambiar(db, v.id_venta, 'Enviado');
    await cambiar(db, v.id_venta, 'Completado');
    expect(await movimientos(db, v.id_venta)).toEqual({ ganado: 50 });
    expect((await resumen(db, 1)).saldo).toBe(50);
  });

  it('Pendiente -> En proceso otorga los puntos', async () => {
    const idVenta = await valor(db,
      "insert into public.venta (total, tipo_venta, id_usuario, estado) values (1234, 'Online', 1, 'Pendiente') returning id_venta");
    await cambiar(db, idVenta, 'En proceso');
    expect(await movimientos(db, idVenta)).toEqual({ ganado: 12 });
  });

  it('venta Pagado anterior al cambio (sin movimientos) -> Enviado no regala puntos', async () => {
    await cambiar(db, '1786407836737', 'Enviado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
  });

  it('salir de Cancelado no mueve nada (Cancelado -> Pagado)', async () => {
    await db.query("update public.venta set estado = 'Cancelado' where id_venta = 1786407836737");
    await cambiar(db, '1786407836737', 'Pagado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
  });

  it('venta sin usuario no mueve nada', async () => {
    const v = await vender(db, null, [{ id_producto: 5, cantidad: 1 }], 'Fallido', 0);
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await movimientos(db, v.id_venta)).toEqual({});
  });

  it('Pagado -> Cancelado devuelve lo canjeado y quita lo ganado', async () => {
    await darPuntos(db, 1, 500);
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 400); // saldo 280
    const r = await cambiar(db, v.id_venta, 'Cancelado');
    expect(r).toMatchObject({ estado: 'Cancelado', descuento_puntos: 2000, puntos_usados: 400 });
    expect(Number(r.total)).toBe(18000);
    expect(await movimientos(db, v.id_venta)).toEqual({ canjeado: -400, ganado: 180, devuelto: 400, revertido: -180 });
    expect(await resumen(db, 1)).toMatchObject({ saldo: 500, ganados: 500, nivel: 'Fan' });
  });

  it('puntos ya gastados: el saldo queda en 0 y el nivel baja', async () => {
    await darPuntos(db, 1, 50);
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 0); // gana 200 -> ganados 250 (Fan)
    expect((await resumen(db, 1)).nivel).toBe('Fan');
    // Gastó 240 en otra compra
    const otra = await valor(db,
      "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', 1, 'Pagado') returning id_venta");
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'canjeado', -240)", [otra]);

    await cambiar(db, v.id_venta, 'Cancelado');

    expect(await movimientos(db, v.id_venta)).toEqual({ ganado: 200, revertido: -10 });
    expect(await resumen(db, 1)).toMatchObject({ saldo: 0, ganados: 50, nivel: 'Lover' });
  });

  it('ida y vuelta de estados (Pagado -> Cancelado -> Pagado -> Cancelado) mueve una sola vez', async () => {
    await darPuntos(db, 1, 500);
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 400);
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Pagado');
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Fallido');
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await movimientos(db, v.id_venta)).toEqual({ canjeado: -400, ganado: 180, devuelto: 400, revertido: -180 });
    expect((await resumen(db, 1)).saldo).toBe(500);
  });

  it('cancelar una venta con canje pero sin puntos ganados devuelve el canje una sola vez', async () => {
    await darPuntos(db, 1, 500);
    const idVenta = await valor(db,
      "insert into public.venta (total, tipo_venta, id_usuario, estado) values (50, 'Online', 1, 'Pagado') returning id_venta");
    await db.query("insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values (1, $1, 'canjeado', -10)", [idVenta]);
    await cambiar(db, idVenta, 'Cancelado');
    await cambiar(db, idVenta, 'Cancelado');
    expect(await movimientos(db, idVenta)).toEqual({ canjeado: -10, devuelto: 10 });
    expect((await resumen(db, 1)).saldo).toBe(500);
  });

  it('venta sin movimientos no mueve nada al cancelarse', async () => {
    await cambiar(db, '1786407836737', 'Cancelado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
    expect(await valor(db, 'select estado from public.venta where id_venta = 1786407836737')).toBe('Cancelado');
  });

  it('Fallido -> Cancelado -> Fallido -> Pagado no gana (la cancelación es definitiva para los puntos)', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0); // $5.000
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Fallido');
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await movimientos(db, v.id_venta)).toEqual({});
    expect((await resumen(db, 1)).saldo).toBe(0);
  });

  it('Fallido -> Cancelado -> Pendiente -> En proceso no gana', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0);
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Pendiente');
    await cambiar(db, v.id_venta, 'En proceso');
    expect(await movimientos(db, v.id_venta)).toEqual({});
  });

  it('Fallido -> Cancelado -> Pagado no gana', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0);
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await movimientos(db, v.id_venta)).toEqual({});
  });

  it('venta nueva Pagado -> Cancelado -> Pendiente -> Pagado no vuelve a ganar', async () => {
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 0); // gana 200
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Pendiente');
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await movimientos(db, v.id_venta)).toEqual({ ganado: 200, revertido: -200 });
    expect(await resumen(db, 1)).toMatchObject({ saldo: 0, ganados: 0 });
  });

  it('cancelar marca la venta (cancelada_alguna_vez) y salir de Cancelado no la desmarca', async () => {
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0);
    const marca = () => valor(db, 'select cancelada_alguna_vez from public.venta where id_venta = $1', [v.id_venta]);
    expect(await marca()).toBe(false);
    await cambiar(db, v.id_venta, 'Cancelado');
    expect(await marca()).toBe(true);
    await cambiar(db, v.id_venta, 'Pendiente');
    expect(await marca()).toBe(true);
  });

  it('una venta cancelada por fuera de la función también queda marcada al salir de Cancelado', async () => {
    await db.query("update public.venta set estado = 'Cancelado' where id_venta = 1786407836737");
    await cambiar(db, '1786407836737', 'Pendiente');
    await cambiar(db, '1786407836737', 'Pagado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
  });

  it('la marca no cambia el saldo ni el nivel de otras compras', async () => {
    await darPuntos(db, 1, 150); // Fan
    const v = await vender(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Fallido', 0);
    const antes = await resumen(db, 1);
    await cambiar(db, v.id_venta, 'Cancelado');
    await cambiar(db, v.id_venta, 'Pagado');
    expect(await resumen(db, 1)).toEqual(antes);
    expect(antes).toMatchObject({ saldo: 150, ganados: 150, nivel: 'Fan' });
  });

  it('venta que no existe -> VENTA_NO_EXISTE', async () => {
    const e = await errorDe(() => cambiar(db, 999999, 'Pagado'));
    expect(e.message).toBe('VENTA_NO_EXISTE');
  });

  it('estado inventado -> ESTADO_INVALIDO sin cambiar nada', async () => {
    const e = await errorDe(() => cambiar(db, 15, 'Reembolsado'));
    expect(e.message).toBe('ESTADO_INVALIDO');
    expect(await valor(db, 'select estado from public.venta where id_venta = 15')).toBe('Pagado');
  });
});

// Ventas que ya estaban en 'Cancelado' ANTES de la migración (hoy, todas las de la base real):
// la migración las marca y nunca más ganan puntos aunque un admin las saque de 'Cancelado'.
describe('ventas canceladas antes de la migración', () => {
  async function baseConVentaVieja() {
    const db = await crearBase();
    await db.exec(leer(RUTA_MIGRACION_RLS));
    await db.exec("update public.venta set estado = 'Cancelado' where id_venta = 1786407836737"); // $2.500, cliente 1
    await db.exec(leer(RUTA_PUNTOS));
    return db;
  }

  it('la migración las marca como canceladas alguna vez (y a las demás no)', async () => {
    const db = await baseConVentaVieja();
    expect(await valor(db, 'select cancelada_alguna_vez from public.venta where id_venta = 1786407836737')).toBe(true);
    expect(await valor(db, 'select cancelada_alguna_vez from public.venta where id_venta = 15')).toBe(false);
  });

  it('Cancelado -> Pendiente -> Pagado no regala puntos', async () => {
    const db = await baseConVentaVieja();
    await cambiar(db, '1786407836737', 'Pendiente');
    await cambiar(db, '1786407836737', 'Pagado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
    expect((await resumen(db, 1)).saldo).toBe(0);
  });

  it('aplicar la migración dos veces no la desmarca', async () => {
    const db = await baseConVentaVieja();
    await cambiar(db, '1786407836737', 'Pendiente');
    await db.exec(leer(RUTA_PUNTOS));
    await cambiar(db, '1786407836737', 'Pagado');
    expect(await movimientos(db, '1786407836737')).toEqual({});
  });
});

describe('permisos', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  const FUNCIONES = [
    'public.super_points_reglas()',
    'public.super_points_resumen(bigint)',
    'public.registrar_venta(bigint, jsonb, text, integer)',
    'public.cambiar_estado_venta(bigint, text)',
  ];

  it('anon y authenticated no leen super_points ni ejecutan las funciones; service_role sí', async () => {
    for (const rol of ['anon', 'authenticated']) {
      expect(await valor(db, "select has_table_privilege($1, 'public.super_points', 'select')", [rol])).toBe(false);
      for (const f of FUNCIONES) {
        expect(await valor(db, "select has_function_privilege($1, $2, 'execute')", [rol, f])).toBe(false);
      }
      await db.exec(`set role ${rol}`);
      try {
        const e = await errorDe(() => db.query('select public.super_points_resumen(1)'));
        expect(e.code).toBe('42501');
      } finally {
        await db.exec('reset role');
      }
    }
    for (const f of FUNCIONES) {
      expect(await valor(db, "select has_function_privilege('service_role', $1, 'execute')", [f])).toBe(true);
    }
  });

  it('las funciones son security invoker y con search_path vacío', async () => {
    const r = await db.query(`
      select proname, prosecdef, proconfig from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in ('super_points_reglas', 'super_points_resumen', 'registrar_venta', 'cambiar_estado_venta')`);
    expect(r.rows).toHaveLength(4);
    for (const f of r.rows) {
      expect(f.prosecdef).toBe(false);
      expect(f.proconfig).toEqual(['search_path=""']);
    }
  });
});

describe('idempotencia y rollback', () => {
  it('la migración se puede aplicar dos veces sin fallar', async () => {
    const db = await base();
    await db.exec(leer(RUTA_PUNTOS));
    const r = await vender(db, 1, VEINTE_MIL, 'Pagado', 0);
    expect(r.puntos_ganados).toBe(200);
  });

  it('el rollback la deshace, la de 3 argumentos vuelve, y se puede reaplicar y deshacer otra vez', async () => {
    const db = await base();
    await vender(db, 1, VEINTE_MIL, 'Pagado', 0);
    await db.exec(leer(RUTA_ROLLBACK_PUNTOS));

    const columnas = async (tabla) => (await db.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = $1", [tabla]))
      .rows.map((c) => c.column_name);
    expect(await columnas('super_points')).not.toContain('tipo');
    expect(await columnas('super_points')).not.toContain('id_usuario');
    expect(await columnas('venta')).not.toContain('puntos_usados');
    expect(await columnas('venta')).not.toContain('descuento_puntos');
    expect(await columnas('venta')).not.toContain('cancelada_alguna_vez');
    for (const f of ['super_points_reglas', 'super_points_resumen', 'cambiar_estado_venta']) {
      expect(Number(await valor(db, 'select count(*) from pg_proc where proname = $1', [f]))).toBe(0);
    }
    expect(await valor(db, "select to_regprocedure('public.registrar_venta(bigint, jsonb, text, integer)')")).toBeNull();
    const r = await registrarVenta(db, 1, [{ id_producto: 5, cantidad: 1 }], 'Pagado');
    expect(Number(r.total)).toBe(2500);
    expect(r.puntos_ganados).toBeUndefined();
    expect(await valor(db, "select has_function_privilege('anon', 'public.registrar_venta(bigint, jsonb, text)', 'execute')")).toBe(false);
    expect(await valor(db, "select has_function_privilege('service_role', 'public.registrar_venta(bigint, jsonb, text)', 'execute')")).toBe(true);

    await db.exec(leer(RUTA_PUNTOS));
    // 2 x $99,99 = $199,98 -> 1 punto (el stock del helado de fresa ya se usó arriba)
    expect((await vender(db, 1, [{ id_producto: 20, cantidad: 2 }], 'Pagado', 0)).puntos_ganados).toBe(1);
    await db.exec(leer(RUTA_ROLLBACK_PUNTOS));
    await db.exec(leer(RUTA_ROLLBACK_PUNTOS));
    expect(Number(await valor(db, "select count(*) from pg_proc where proname = 'registrar_venta'"))).toBe(1);
  });
});
