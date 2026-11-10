// Pruebas de la migración 20261110130000_reset_tokens_indices y de las consultas que hace el servidor
// en "Olvidé mi contraseña" sobre public.reset_tokens (tabla real, que no está en schema_base).
import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { leer } from './helpers.js';

const raizSupabase = resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase');
const RUTA_MIGRACION = resolve(raizSupabase, 'migrations/20261110130000_reset_tokens_indices.sql');
const RUTA_ROLLBACK = resolve(raizSupabase, 'rollbacks/20261110130000_reset_tokens_indices.rollback.sql');

// Igual que en la base real (columnas, tipos y valores por defecto).
const TABLA_REAL = `
  create table public.reset_tokens (
    id serial primary key,
    token character varying not null,
    email character varying not null,
    expires_at bigint not null,
    used boolean default false
  );
  alter table public.reset_tokens enable row level security;
`;

const indices = async (db) =>
  (await db.query(`select indexname from pg_indexes where schemaname = 'public' and tablename = 'reset_tokens' order by 1`))
    .rows.map((r) => r.indexname);

describe('migración reset_tokens_indices', () => {
  let db;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(TABLA_REAL);
  });

  it('crea el índice único por token y el índice por email, y se puede aplicar dos veces', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_MIGRACION));
    expect(await indices(db)).toEqual(['reset_tokens_email_idx', 'reset_tokens_pkey', 'reset_tokens_token_key']);
  });

  it('no deja guardar dos veces el mismo token', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(`insert into public.reset_tokens (token, email, expires_at) values ('h1', 'a@b.com', 1)`);
    await expect(db.exec(`insert into public.reset_tokens (token, email, expires_at) values ('h1', 'c@d.com', 1)`))
      .rejects.toThrow(/duplicate key/i);
  });

  it('las consultas del servidor funcionan: gastar el token solo una vez y solo si está vigente', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    const ahora = Date.now();
    await db.query(`insert into public.reset_tokens (token, email, expires_at, used) values ($1, $2, $3, false), ($4, $2, $5, false)`,
      ['vigente', 'a@b.com', ahora + 60000, 'vencido', ahora - 1]);
    const gastar = (token) => db.query(
      `update public.reset_tokens set used = true where token = $1 and used = false and expires_at > $2 returning email`,
      [token, ahora]);
    expect((await gastar('vigente')).rows).toEqual([{ email: 'a@b.com' }]);
    expect((await gastar('vigente')).rows).toEqual([]);
    expect((await gastar('vencido')).rows).toEqual([]);
  });

  it('el rollback quita los índices y se puede aplicar dos veces', async () => {
    await db.exec(leer(RUTA_MIGRACION));
    await db.exec(leer(RUTA_ROLLBACK));
    await db.exec(leer(RUTA_ROLLBACK));
    expect(await indices(db)).toEqual(['reset_tokens_pkey']);
  });
});
