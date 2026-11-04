// Pruebas de la migración 20261104120000_rls_tablas_publicas: candados en las tablas públicas.
// Solo service_role (el servidor) entra; la llave pública de la base no sirve para leer ni escribir.
import { describe, it, expect, beforeEach } from 'vitest';
import { crearBase, registrarVenta, valor, leer, RUTA_MIGRACION_RLS, RUTA_ROLLBACK_RLS } from './helpers.js';

const RLS_NUEVO = ['pedido', 'producto', 'proveedor', 'reset_tokens', 'sucursal', 'super_points', 'users', 'usuario', 'venta'];
const RLS_PREVIO = ['admin_face_rekognition', 'detalle_venta', 'empleado', 'inventario', 'rostros_admin', 'rostros_admin_muestras'];
const ROLES_SIN_ACCESO = ['anon', 'authenticated'];

// Tablas que existen en la base real pero no en schema_base (mismos permisos y RLS que allá).
const TABLAS_SOLO_REALES = `
  create table public.pedido (id_pedido bigint generated always as identity primary key);
  create table public.proveedor (id_proveedor bigint generated always as identity primary key);
  create table public.reset_tokens (id bigint generated always as identity primary key, token text);
  create table public.users (id bigint generated always as identity primary key);
  create table public.admin_face_rekognition (id uuid primary key default gen_random_uuid());
  create table public.rostros_admin (id bigint primary key);
  create table public.rostros_admin_muestras (id bigint generated always as identity primary key);
  alter table public.admin_face_rekognition enable row level security;
  alter table public.rostros_admin enable row level security;
  alter table public.rostros_admin_muestras enable row level security;
  alter table public.empleado enable row level security;
  create policy "Solo service_role accede a rostros_admin" on public.rostros_admin
    for all using (current_user = 'service_role');
`;

async function baseReal() {
  const db = await crearBase();
  await db.exec(TABLAS_SOLO_REALES);
  return db;
}

// Ejecuta fn como ese rol. PGlite es una sola sesión: siempre hay que volver al rol original.
async function comoRol(db, rol, fn) {
  await db.exec(`set role ${rol}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

async function codigoDeError(fn) {
  try {
    await fn();
  } catch (e) {
    return e.code;
  }
  return null;
}

const rlsActivo = (db, tabla) =>
  valor(db, 'select relrowsecurity from pg_class where oid = to_regclass($1)', [`public.${tabla}`]);

const privilegiosSobrantes = async (db) => (await db.query(`
  select r.rol, c.relname, c.relkind
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) as r(rol)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and (case when c.relkind = 'S'
           then has_sequence_privilege(r.rol, c.oid, 'select, update, usage')
           else has_table_privilege(r.rol, c.oid, 'select, insert, update, delete, truncate, references, trigger')
         end)
`)).rows;

describe('punto de partida: lo que la migración debe cerrar', () => {
  it('sin migración, anon lee los usuarios', async () => {
    const db = await baseReal();

    const correo = await comoRol(db, 'anon', () => valor(db, 'select email from public.usuario'));

    expect(correo).toBe('ana@test.local');
  });
});

describe('tras la migración', () => {
  let db;
  beforeEach(async () => {
    db = await baseReal();
    await db.exec(leer(RUTA_MIGRACION_RLS));
  });

  it('RLS queda activo en todas las tablas, las nuevas y las que ya lo tenían', async () => {
    for (const tabla of [...RLS_NUEVO, ...RLS_PREVIO]) {
      expect([tabla, await rlsActivo(db, tabla)]).toEqual([tabla, true]);
    }
  });

  it('anon y authenticated no conservan privilegios en ninguna tabla ni secuencia', async () => {
    expect(await privilegiosSobrantes(db)).toEqual([]);
  });

  describe.each(ROLES_SIN_ACCESO)('%s', (rol) => {
    it.each(['usuario', 'venta', 'producto', 'reset_tokens'])('no puede leer %s', async (tabla) => {
      const codigo = await comoRol(db, rol, () => codigoDeError(() => db.query(`select * from public.${tabla}`)));
      expect(codigo).toBe('42501');
    });

    it('no puede insertar, cambiar ni borrar', async () => {
      const intentos = [
        "insert into public.usuario (nombre, apellido, email, password_hash, rol) values ('X', 'Y', 'x@test.local', 'x', 'admin')",
        "update public.usuario set rol = 'admin'",
        'delete from public.venta',
        'update public.producto set precio = 1',
        "insert into public.venta (total, tipo_venta) values (1, 'Online')",
      ];
      for (const sql of intentos) {
        const codigo = await comoRol(db, rol, () => codigoDeError(() => db.query(sql)));
        expect([sql, codigo]).toEqual([sql, '42501']);
      }
    });

    it('no puede usar secuencias', async () => {
      const codigo = await comoRol(db, rol, () =>
        codigoDeError(() => db.query("select nextval(pg_get_serial_sequence('public.venta', 'id_venta'))")));
      expect(codigo).toBe('42501');
    });

    it('no puede ejecutar registrar_venta', async () => {
      const codigo = await comoRol(db, rol, () =>
        codigoDeError(() => registrarVenta(db, 1, [{ id_producto: 5, cantidad: 1 }], 'Pagado')));
      expect(codigo).toBe('42501');
    });
  });

  it('service_role sigue leyendo y escribiendo', async () => {
    await comoRol(db, 'service_role', async () => {
      expect(await valor(db, 'select email from public.usuario')).toBe('ana@test.local');
      await db.query('update public.producto set stock = 9 where id_producto = 5');
      const cambiado = await db.query("update public.usuario set nombre = 'Eva' where id_usuario = 1 returning id_usuario");
      expect(cambiado.rows).toHaveLength(1);
      const venta = await db.query("insert into public.venta (total, tipo_venta) values (1, 'Online') returning id_venta");
      expect(venta.rows).toHaveLength(1);
      await db.query('delete from public.venta where id_venta = $1', [venta.rows[0].id_venta]);
      const token = await db.query("insert into public.reset_tokens (token) values ('t') returning id");
      expect(token.rows).toHaveLength(1);
    });
  });

  it('registrar_venta funciona con service_role: venta, detalle y stock descontado', async () => {
    const venta = await comoRol(db, 'service_role', () =>
      registrarVenta(db, 1, [{ id_producto: 5, cantidad: 2 }], 'Pagado'));

    expect(Number(venta.total)).toBe(5000);
    expect(Number(await valor(db, 'select stock from public.producto where id_producto = 5'))).toBe(8);
    expect(Number(await valor(db, 'select count(*) from public.detalle_venta where id_venta = $1', [venta.id_venta]))).toBe(1);
    expect(Number(await valor(db, 'select id_usuario from public.venta where id_venta = $1', [venta.id_venta]))).toBe(1);
  });

  it('las tablas y secuencias FUTURAS nacen cerradas para anon y abiertas para service_role', async () => {
    await db.exec('create table public.tabla_futura (id bigint generated always as identity primary key, dato text);');

    expect(await comoRol(db, 'anon', () => codigoDeError(() => db.query('select * from public.tabla_futura')))).toBe('42501');
    expect(await comoRol(db, 'authenticated', () =>
      codigoDeError(() => db.query("insert into public.tabla_futura (dato) values ('x')")))).toBe('42501');
    await comoRol(db, 'service_role', () => db.query("insert into public.tabla_futura (dato) values ('x')"));
    expect(await privilegiosSobrantes(db)).toEqual([]);
  });

  it('no borra la política de rostros_admin ni ningún dato', async () => {
    expect(Number(await valor(db, "select count(*) from pg_policies where tablename = 'rostros_admin'"))).toBe(1);
    expect(Number(await valor(db, 'select count(*) from public.usuario'))).toBe(1);
    expect(Number(await valor(db, 'select count(*) from public.producto'))).toBe(3);
  });

  it('aplicarla dos veces no falla y deja lo mismo', async () => {
    await db.exec(leer(RUTA_MIGRACION_RLS));

    expect(await privilegiosSobrantes(db)).toEqual([]);
    expect(await rlsActivo(db, 'usuario')).toBe(true);
    expect(Number(await valor(db, 'select count(*) from public.venta'))).toBe(2);
  });
});

describe('tablas que solo existen en la base real', () => {
  it('sobre schema_base (sin esas tablas) la migración y el rollback no fallan', async () => {
    const db = await crearBase();

    await db.exec(leer(RUTA_MIGRACION_RLS));

    expect(await rlsActivo(db, 'usuario')).toBe(true);
    expect(await privilegiosSobrantes(db)).toEqual([]);

    await db.exec(leer(RUTA_ROLLBACK_RLS));

    expect(await rlsActivo(db, 'usuario')).toBe(false);
  });
});

describe('rollback', () => {
  let db;
  beforeEach(async () => {
    db = await baseReal();
    await db.exec(leer(RUTA_MIGRACION_RLS));
    await db.exec(leer(RUTA_ROLLBACK_RLS));
  });

  it('devuelve el acceso de anon y authenticated', async () => {
    for (const rol of ROLES_SIN_ACCESO) {
      expect(await comoRol(db, rol, () => valor(db, 'select email from public.usuario'))).toBe('ana@test.local');
      await comoRol(db, rol, () => db.query("select nextval(pg_get_serial_sequence('public.venta', 'id_venta'))"));
    }
  });

  it('apaga RLS solo en las tablas que la migración encendió', async () => {
    for (const tabla of RLS_NUEVO) expect([tabla, await rlsActivo(db, tabla)]).toEqual([tabla, false]);
    for (const tabla of RLS_PREVIO) expect([tabla, await rlsActivo(db, tabla)]).toEqual([tabla, true]);
  });

  it('las tablas futuras vuelven a nacer con los privilegios de siempre', async () => {
    await db.exec('create table public.tabla_futura (id bigint primary key);');

    expect(await comoRol(db, 'anon', () => codigoDeError(() => db.query('select * from public.tabla_futura')))).toBeNull();
  });

  it('se puede ejecutar dos veces y volver a migrar después', async () => {
    await db.exec(leer(RUTA_ROLLBACK_RLS));
    await db.exec(leer(RUTA_MIGRACION_RLS));

    expect(await privilegiosSobrantes(db)).toEqual([]);
    expect(await rlsActivo(db, 'venta')).toBe(true);
  });
});

describe('forma del archivo de migración', () => {
  const sql = leer(RUTA_MIGRACION_RLS);

  it('una transacción con lock_timeout corto y recarga del esquema al final', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/lock_timeout = '5s'/);
    expect(sql).toMatch(/notify pgrst, 'reload schema';\s*commit;\s*$/);
  });

  it('no borra nada ni toca roles que el SQL Editor no controla', () => {
    expect(sql).not.toMatch(/^\s*(drop|truncate)\b/im);
    expect(sql).not.toMatch(/^[^-\n]*supabase_admin/im);
  });
});
