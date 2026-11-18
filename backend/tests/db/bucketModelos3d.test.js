// Pruebas de la migración 20261118120000_bucket_modelos_3d.
// Crea el bucket "modelos-3d" donde el servidor guarda los GLB que genera Tripo (los enlaces de Tripo vencen).
// Contrato:
//  - Bucket público de lectura, 50 MB por archivo y solo model/gltf-binary.
//  - Una sola política sobre el bucket: lectura (SELECT). Nadie con la llave pública puede subir, cambiar ni
//    borrar; el servidor usa service_role, que salta RLS y no necesita política.
//  - Se puede aplicar dos veces; el rollback borra la política y el bucket SOLO si está vacío.
// PGlite no trae el esquema storage de Supabase: se crea lo mínimo, igual que en la base real
// (incluido el trigger que bloquea los DELETE directos salvo con storage.allow_delete_query).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { leer } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_MIGRACION = resolve(raizSupabase, 'migrations/20261118120000_bucket_modelos_3d.sql');
const RUTA_ROLLBACK = resolve(raizSupabase, 'rollbacks/20261118120000_bucket_modelos_3d.rollback.sql');

const STORAGE_REAL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, owner uuid,
    created_at timestamptz default now(), updated_at timestamptz default now(),
    public boolean default false, avif_autodetection boolean default false,
    file_size_limit bigint, allowed_mime_types text[], owner_id text
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
  alter table storage.objects enable row level security;
  create function storage.protect_delete() returns trigger language plpgsql as $$
  begin
    if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
      raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
        using errcode = '42501';
    end if;
    return null;
  end;
  $$;
  create trigger protect_buckets_delete before delete on storage.buckets
    for each statement execute function storage.protect_delete();
  create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();
  insert into storage.buckets (id, name, public) values ('helados', 'helados', true);
  create policy "Public Read Access on helados" on storage.objects for select to public
    using (bucket_id = 'helados'::text);
  grant usage on schema storage to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`;

const bucket = async (db) => (await db.query(`
  select id, name, public, file_size_limit::text as limite, allowed_mime_types
  from storage.buckets where id = 'modelos-3d'
`)).rows;

const politicasModelos = async (db) => (await db.query(`
  select policyname, cmd, roles::text as roles
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') like '%modelos-3d%' or coalesce(with_check, '') like '%modelos-3d%')
  order by policyname
`)).rows;

const comoRol = async (db, rol, fn) => {
  await db.exec(`set role ${rol}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

describe('migración bucket_modelos_3d', () => {
  let db;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(STORAGE_REAL);
  });

  it('crea el bucket público con límite 52428800 y mime model/gltf-binary', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    expect(await bucket(db)).toEqual([{
      id: 'modelos-3d', name: 'modelos-3d', public: true, limite: '52428800', allowed_mime_types: ['model/gltf-binary'],
    }]);
  });

  it('solo existe una política SELECT sobre modelos-3d', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    expect(await politicasModelos(db)).toEqual([{ policyname: 'modelos_3d_lectura_publica', cmd: 'SELECT', roles: '{public}' }]);
  });

  it('anon y authenticated pueden leer, pero no subir, cambiar ni borrar archivos del bucket', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(`insert into storage.objects (bucket_id, name) values ('modelos-3d', 'producto-5/T-1.glb')`);
    for (const rol of ['anon', 'authenticated']) {
      await comoRol(db, rol, async () => {
        const lectura = await db.query(`select name from storage.objects where bucket_id = 'modelos-3d'`);
        expect(lectura.rows).toEqual([{ name: 'producto-5/T-1.glb' }]);
        await expect(db.exec(`insert into storage.objects (bucket_id, name) values ('modelos-3d', 'malo.glb')`))
          .rejects.toThrow(/row-level security/i);
        const cambio = await db.query(`update storage.objects set name = 'malo.glb' where bucket_id = 'modelos-3d'`);
        expect(cambio.affectedRows ?? 0).toBe(0);
        await db.exec(`set storage.allow_delete_query = 'true'`);
        const borrado = await db.query(`delete from storage.objects where bucket_id = 'modelos-3d'`);
        await db.exec(`reset storage.allow_delete_query`);
        expect(borrado.affectedRows ?? 0).toBe(0);
      });
    }
  });

  it('aplicar dos veces no falla', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_MIGRACION));
    expect(await bucket(db)).toHaveLength(1);
    expect(await politicasModelos(db)).toHaveLength(1);
  });

  it('el rollback borra la política y el bucket (vacío), y se puede aplicar dos veces', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_ROLLBACK));
    await db.exec(leer(RUTA_ROLLBACK));
    expect(await bucket(db)).toEqual([]);
    expect(await politicasModelos(db)).toEqual([]);
    // No toca el bucket ni la política de "helados".
    const helados = await db.query(`select id from storage.buckets where id = 'helados'`);
    expect(helados.rows).toHaveLength(1);
    const pol = await db.query(`select policyname from pg_policies where schemaname = 'storage'`);
    expect(pol.rows).toEqual([{ policyname: 'Public Read Access on helados' }]);
  });

  it('el rollback no borra el bucket si todavía tiene archivos (solo quita la política)', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(`insert into storage.objects (bucket_id, name) values ('modelos-3d', 'producto-5/T-1.glb')`);
    await db.exec(leer(RUTA_ROLLBACK));
    expect(await bucket(db)).toHaveLength(1);
    expect(await politicasModelos(db)).toEqual([]);
    const archivos = await db.query(`select name from storage.objects`);
    expect(archivos.rows).toEqual([{ name: 'producto-5/T-1.glb' }]);
  });
});
