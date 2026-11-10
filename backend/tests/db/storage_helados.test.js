// Pruebas de la migración 20261110120000_storage_helados_solo_lectura.
// El bucket "helados" tenía políticas que dejaban a cualquiera (rol public) SUBIR y CAMBIAR imágenes.
// Tras la migración solo queda la de lectura; el rollback recrea las dos con la misma definición.
// PGlite no trae el esquema storage de Supabase: se crea lo mínimo, igual que en la base real.
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { leer } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_MIGRACION = resolve(raizSupabase, 'migrations/20261110120000_storage_helados_solo_lectura.sql');
const RUTA_ROLLBACK = resolve(raizSupabase, 'rollbacks/20261110120000_storage_helados_solo_lectura.rollback.sql');

const STORAGE_REAL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create policy "Public Insert Access on helados" on storage.objects for insert to public
    with check (bucket_id = 'helados'::text);
  create policy "Public Read Access on helados" on storage.objects for select to public
    using (bucket_id = 'helados'::text);
  create policy "Public Update Access on helados" on storage.objects for update to public
    using (bucket_id = 'helados'::text);
`;

const politicas = async (db) => (await db.query(`
  select policyname, cmd, roles::text as roles, permissive, qual, with_check
  from pg_policies where schemaname = 'storage' and tablename = 'objects'
  order by policyname
`)).rows;

describe('migración storage_helados_solo_lectura', () => {
  let db;
  let originales;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STORAGE_REAL);
    originales = await politicas(db);
  });

  it('deja solo la política de lectura del bucket helados', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    const quedan = await politicas(db);
    expect(quedan.map((p) => [p.policyname, p.cmd])).toEqual([['Public Read Access on helados', 'SELECT']]);
    expect(quedan[0]).toEqual(originales.find((p) => p.cmd === 'SELECT'));
  });

  it('se puede aplicar dos veces sin fallar', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_MIGRACION));
    expect((await politicas(db)).map((p) => p.cmd)).toEqual(['SELECT']);
  });

  it('el anónimo ya no puede subir ni cambiar archivos, pero sí leerlos', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('helados', 'fresa.png')`);
    await db.exec(`grant usage on schema storage to anon; grant select, insert, update on storage.objects to anon;`);
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec('set role anon');
    try {
      await expect(db.exec(`insert into storage.objects (bucket_id, name) values ('helados', 'malo.png')`))
        .rejects.toThrow(/row-level security/i);
      const cambio = await db.query(`update storage.objects set name = 'malo.png' where bucket_id = 'helados'`);
      expect(cambio.affectedRows ?? 0).toBe(0);
      const lectura = await db.query(`select name from storage.objects where bucket_id = 'helados'`);
      expect(lectura.rows).toEqual([{ name: 'fresa.png' }]);
    } finally {
      await db.exec('reset role');
    }
  });

  it('el rollback recrea las políticas con la misma definición, y se puede aplicar dos veces', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_ROLLBACK));
    await db.exec(leer(RUTA_ROLLBACK));
    expect(await politicas(db)).toEqual(originales);
  });
});
