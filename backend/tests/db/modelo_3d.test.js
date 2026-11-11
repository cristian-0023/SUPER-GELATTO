// Pruebas de la migración 20261112120000_modelo_3d_en_base: la tarea de Tripo (id, estado y prompt) se
// guarda en public.producto, junto a model_3d_url, en vez de un archivo JSON que en Vercel se pierde.
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearBase, leer, valor } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_MIGRACION = resolve(raizSupabase, 'migrations/20261112120000_modelo_3d_en_base.sql');
const RUTA_ROLLBACK = resolve(raizSupabase, 'rollbacks/20261112120000_modelo_3d_en_base.rollback.sql');

const columnas = async (db) =>
  (await db.query(`select column_name from information_schema.columns
                   where table_schema = 'public' and table_name = 'producto' and column_name like 'model_3d%'
                   order by 1`)).rows.map((r) => r.column_name);

describe('migración modelo_3d_en_base', () => {
  let db;
  beforeEach(async () => {
    db = await crearBase();
  });

  it('agrega model_3d_task_id, model_3d_estado, model_3d_prompt y model_3d_actualizado (y conserva model_3d_url)', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    expect(await columnas(db)).toEqual(['model_3d_actualizado', 'model_3d_estado', 'model_3d_prompt', 'model_3d_task_id', 'model_3d_url']);
  });

  it('se puede aplicar dos veces sin fallar', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_MIGRACION));
    expect(await columnas(db)).toHaveLength(5);
  });

  // Lo mismo que hace el servidor (PostgREST: .eq(id).or(estado.is.null, estado.neq.generando, actualizado.lt.<vence>)):
  // dos clics a la vez -> solo uno "reserva" la generación; una reserva vieja (más de 15 min) se puede retomar.
  const reservar = (db) => db.query(
    `update public.producto set model_3d_estado = 'generando', model_3d_task_id = null, model_3d_actualizado = now()
     where id_producto = 5
       and (model_3d_estado is null or model_3d_estado <> 'generando' or model_3d_actualizado < now() - interval '15 minutes')
     returning id_producto`);

  it('la reserva condicional deja pasar solo a uno y retoma una reserva vieja', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    expect((await reservar(db)).rows).toHaveLength(1);
    expect((await reservar(db)).rows).toHaveLength(0); // segundo clic: ya está generando
    await db.query(`update public.producto set model_3d_actualizado = now() - interval '16 minutes' where id_producto = 5`);
    expect((await reservar(db)).rows).toHaveLength(1);
    await db.query(`update public.producto set model_3d_estado = 'error' where id_producto = 5`);
    expect((await reservar(db)).rows).toHaveLength(1);
  });

  it('no cambia los productos que ya existen (las columnas nuevas quedan vacías)', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    expect(Number(await valor(db, `select count(*) from public.producto where model_3d_estado is not null or model_3d_task_id is not null`))).toBe(0);
    expect(Number(await valor(db, `select count(*) from public.producto`))).toBe(3);
  });

  it('guarda lo que escribe el servidor: tarea generando y luego listo con su URL', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.query(`update public.producto set model_3d_task_id = 'T-1', model_3d_estado = 'generando', model_3d_prompt = 'cono' where id_producto = 5`);
    await db.query(`update public.producto set model_3d_url = 'https://tripo.test/m.glb', model_3d_estado = 'listo' where id_producto = 5`);
    const fila = (await db.query(`select model_3d_task_id, model_3d_estado, model_3d_url from public.producto where id_producto = 5`)).rows[0];
    expect(fila).toEqual({ model_3d_task_id: 'T-1', model_3d_estado: 'listo', model_3d_url: 'https://tripo.test/m.glb' });
  });

  it('el estado solo acepta generando, listo o error', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    for (const estado of ['generando', 'listo', 'error']) {
      await db.query(`update public.producto set model_3d_estado = $1 where id_producto = 5`, [estado]);
    }
    await expect(db.query(`update public.producto set model_3d_estado = 'inventado' where id_producto = 5`)).rejects.toThrow(/check/i);
  });

  it('el id de tarea y el prompt tienen un largo máximo', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await expect(db.query(`update public.producto set model_3d_task_id = repeat('a', 201) where id_producto = 5`)).rejects.toThrow(/check/i);
    await expect(db.query(`update public.producto set model_3d_prompt = repeat('a', 1001) where id_producto = 5`)).rejects.toThrow(/check/i);
  });

  it('el rollback quita solo las columnas nuevas y se puede ejecutar dos veces', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.query(`update public.producto set model_3d_url = 'https://tripo.test/m.glb' where id_producto = 5`);
    await db.exec(leer(RUTA_ROLLBACK));
    await db.exec(leer(RUTA_ROLLBACK));
    expect(await columnas(db)).toEqual(['model_3d_url']); // también se va model_3d_actualizado
    expect(await valor(db, `select model_3d_url from public.producto where id_producto = 5`)).toBe('https://tripo.test/m.glb');
  });
});
