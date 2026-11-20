// Pruebas de la migración 20261120120000_nivel_por_saldo (regla aprobada el 2026-11-19):
// el nivel del cliente (Lover, Fan, Pro, Master) sale de su SALDO ACTUAL, no de los puntos ganados en
// toda su historia. Gastar puntos puede bajar el nivel, y eso cambia el tope del canje siguiente.
// Niveles: Lover 0-100 (5 %), Fan 101-500 (10 %), Pro 501-1000 (15 %), Master 1001+ (20 %).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearBase, valor, leer, RUTA_MIGRACION_RLS } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_PUNTOS = resolve(raizSupabase, 'migrations/20261111120000_super_points.sql');
const RUTA_NIVEL_SALDO = resolve(raizSupabase, 'migrations/20261120120000_nivel_por_saldo.sql');
const RUTA_ROLLBACK_NIVEL_SALDO = resolve(raizSupabase, 'rollbacks/20261120120000_nivel_por_saldo.rollback.sql');

// Igual que la base real: migraciones en orden (ventas -> candados RLS -> Super Points -> nivel por saldo).
async function base() {
  const db = await crearBase();
  await db.exec(leer(RUTA_MIGRACION_RLS));
  await db.exec(leer(RUTA_PUNTOS));
  await db.exec(leer(RUTA_NIVEL_SALDO));
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

// Un movimiento suelto en una venta propia (la libreta no repite tipo en la misma venta).
async function movimiento(db, idUsuario, tipo, puntos) {
  const idVenta = await valor(db,
    "insert into public.venta (total, tipo_venta, id_usuario, estado) values (0, 'Online', $1, 'Pagado') returning id_venta",
    [idUsuario]);
  await db.query(
    'insert into public.super_points (id_usuario, id_venta, tipo, puntos_generados) values ($1, $2, $3, $4)',
    [idUsuario, idVenta, tipo, puntos]);
  return idVenta;
}
const darPuntos = (db, idUsuario, puntos) => movimiento(db, idUsuario, 'ganado', puntos);
const gastarPuntos = (db, idUsuario, puntos) => movimiento(db, idUsuario, 'canjeado', -puntos);

const VEINTE_MIL = [{ id_producto: 5, cantidad: 8 }]; // 8 x $2.500 = $20.000
const CINCO_MIL = [{ id_producto: 5, cantidad: 2 }]; // 2 x $2.500 = $5.000

describe('super_points_resumen: el nivel sale del saldo', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it.each([
    [100, 'Lover', 5, 1, 'Fan'],
    [101, 'Fan', 10, 400, 'Pro'],
    [500, 'Fan', 10, 1, 'Pro'],
    [501, 'Pro', 15, 500, 'Master'],
    [1000, 'Pro', 15, 1, 'Master'],
    [1001, 'Master', 20, 0, null],
  ])('frontera: saldo %i (con 2000 ganados) -> %s', async (saldo, nivel, pct, faltan, siguiente) => {
    await darPuntos(db, 1, 2000);
    await gastarPuntos(db, 1, 2000 - saldo);
    const r = await resumen(db, 1);
    expect(r).toMatchObject({ saldo, ganados: 2000, nivel, pct_max: pct, valor_saldo: saldo * 5 });
    expect(r.puntos_para_siguiente).toBe(faltan);
    expect(r.siguiente_nivel).toBe(siguiente);
  });

  it('muchos puntos ganados pero poco saldo -> nivel bajo (ganados queda solo como dato)', async () => {
    await darPuntos(db, 1, 1200);
    await gastarPuntos(db, 1, 1150);
    expect(await resumen(db, 1)).toEqual({
      saldo: 50, ganados: 1200, nivel: 'Lover', pct_max: 5, valor_saldo: 250,
      puntos_para_siguiente: 51, siguiente_nivel: 'Fan',
    });
  });

  it('cliente sin movimientos sigue en Lover con 101 para Fan', async () => {
    expect(await resumen(db, 1)).toMatchObject({ saldo: 0, ganados: 0, nivel: 'Lover', pct_max: 5, puntos_para_siguiente: 101 });
  });
});

describe('registrar_venta: el tope del canje usa el nivel del saldo', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('canjear baja el nivel y el tope de la compra siguiente usa el nivel nuevo', async () => {
    await darPuntos(db, 1, 520); // Pro: tope de $20.000 = 600
    const r1 = await vender(db, 1, VEINTE_MIL, 'Pagado', 520); // paga 17.400, gana 174
    expect(r1).toMatchObject({ puntos_usados: 520, puntos_ganados: 174, saldo: 174 });
    expect(await resumen(db, 1)).toMatchObject({ saldo: 174, ganados: 694, nivel: 'Fan', pct_max: 10 });

    // Fan: tope de $5.000 = 100 (con Pro habría sido 150)
    const e = await errorDe(() => vender(db, 1, CINCO_MIL, 'Pagado', 101));
    expect(e.message).toBe('PUNTOS_EXCEDEN_TOPE');
    expect(e.detail).toBe('pedidos=101 tope=100');
    const r2 = await vender(db, 1, CINCO_MIL, 'Pagado', 100);
    expect(r2).toMatchObject({ puntos_usados: 100, descuento: 500 });
  });

  it('muchos ganados y poco saldo: el tope es el del nivel del saldo', async () => {
    await darPuntos(db, 1, 1200);
    await gastarPuntos(db, 1, 1050); // saldo 150 -> Fan (por ganados sería Master)
    const e = await errorDe(() => vender(db, 1, CINCO_MIL, 'Pagado', 150));
    expect(e.message).toBe('PUNTOS_EXCEDEN_TOPE');
    expect(e.detail).toBe('pedidos=150 tope=100');
  });

  it('el tope usa el saldo ANTES de la compra (canjear todo no baja el tope de esa misma compra)', async () => {
    await darPuntos(db, 1, 600); // Pro: tope de $20.000 = 600
    const r = await vender(db, 1, VEINTE_MIL, 'Pagado', 600); // paga 17.000, gana 170
    expect(r).toMatchObject({ puntos_usados: 600, descuento: 3000, puntos_ganados: 170, saldo: 170 });
    expect(Number(r.total)).toBe(17000);
  });
});

describe('cambiar_estado_venta: cancelar recalcula el nivel con el saldo', () => {
  let db;
  beforeEach(async () => { db = await base(); });

  it('cancelar devuelve lo canjeado, revierte lo ganado y el nivel vuelve a salir del saldo', async () => {
    await darPuntos(db, 1, 520);
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 520); // saldo 174 -> Fan
    expect((await resumen(db, 1)).nivel).toBe('Fan');

    await cambiar(db, v.id_venta, 'Cancelado'); // +520 devuelto, -174 revertido
    expect(await resumen(db, 1)).toMatchObject({ saldo: 520, ganados: 520, nivel: 'Pro', pct_max: 15 });
  });

  it('cancelar una compra que dio puntos baja el saldo y con él el nivel', async () => {
    await darPuntos(db, 1, 50);
    const v = await vender(db, 1, VEINTE_MIL, 'Pagado', 0); // gana 200 -> saldo 250 (Fan)
    expect((await resumen(db, 1)).nivel).toBe('Fan');
    await cambiar(db, v.id_venta, 'Cancelado');
    expect(await resumen(db, 1)).toMatchObject({ saldo: 50, nivel: 'Lover', pct_max: 5 });
  });
});

describe('migración 20261120120000: permisos, idempotencia y rollback', () => {
  const FUNCIONES = [
    'public.super_points_reglas()',
    'public.super_points_resumen(bigint)',
    'public.registrar_venta(bigint, jsonb, text, integer)',
    'public.cambiar_estado_venta(bigint, text)',
  ];

  const sinPermisoParaClientes = async (db) => {
    for (const rol of ['anon', 'authenticated']) {
      for (const f of FUNCIONES) {
        expect(await valor(db, "select has_function_privilege($1, $2, 'execute')", [rol, f])).toBe(false);
      }
    }
    for (const f of FUNCIONES) {
      expect(await valor(db, "select has_function_privilege('service_role', $1, 'execute')", [f])).toBe(true);
    }
  };

  it('anon y authenticated siguen sin poder ejecutar las funciones; service_role sí', async () => {
    const db = await base();
    await sinPermisoParaClientes(db);
    await db.exec('set role anon');
    try {
      expect((await errorDe(() => db.query('select public.super_points_resumen(1)'))).code).toBe('42501');
    } finally {
      await db.exec('reset role');
    }
  });

  it('la migración quita un EXECUTE que se haya colado para anon/authenticated', async () => {
    const db = await base();
    await db.exec('grant execute on function public.super_points_resumen(bigint) to public, anon, authenticated');
    await db.exec(leer(RUTA_NIVEL_SALDO));
    await sinPermisoParaClientes(db);
  });

  it('super_points_resumen sigue siendo stable, security invoker y con search_path vacío, misma firma', async () => {
    const db = await base();
    const r = await db.query(`
      select prosecdef, proconfig, provolatile, pg_get_function_identity_arguments(oid) as args,
             pg_get_function_result(oid) as res
      from pg_proc where pronamespace = 'public'::regnamespace and proname = 'super_points_resumen'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      prosecdef: false, proconfig: ['search_path=""'], provolatile: 's', args: 'p_id_usuario bigint', res: 'jsonb',
    });
  });

  it('se puede aplicar dos veces sin fallar', async () => {
    const db = await base();
    await db.exec(leer(RUTA_NIVEL_SALDO));
    await darPuntos(db, 1, 1200);
    await gastarPuntos(db, 1, 1150);
    expect((await resumen(db, 1)).nivel).toBe('Lover');
    await sinPermisoParaClientes(db);
  });

  it('el rollback vuelve al nivel por puntos ganados, se puede correr dos veces y reaplicar', async () => {
    const db = await base();
    await darPuntos(db, 1, 1200);
    await gastarPuntos(db, 1, 1150); // saldo 50, ganados 1200

    await db.exec(leer(RUTA_ROLLBACK_NIVEL_SALDO));
    expect(await resumen(db, 1)).toEqual({
      saldo: 50, ganados: 1200, nivel: 'Master', pct_max: 20, valor_saldo: 250,
      puntos_para_siguiente: 0, siguiente_nivel: null,
    });
    await sinPermisoParaClientes(db);
    await db.exec(leer(RUTA_ROLLBACK_NIVEL_SALDO));
    expect((await resumen(db, 1)).nivel).toBe('Master');

    await db.exec(leer(RUTA_NIVEL_SALDO));
    expect((await resumen(db, 1)).nivel).toBe('Lover');
    await sinPermisoParaClientes(db);
  });
});
