// Seguridad de PUT /api/admin/users/:id/role (SEC-001). Contrato:
//  - Solo el super admin asciende cuentas a admin: un admin normal que pide rol 'admin' -> 403 y no actualiza.
//  - El :id de la URL debe ser un entero positivo -> si no, 400 sin consultar la base.
//  - Nadie toca el rol del super admin (por correo o por rol super_admin), ni él mismo -> 403 "cuenta principal".
//    Esa comprobación va antes que la de ascender, para que el mensaje sea el correcto.
//  - Un admin normal no puede bajar a otro admin a cliente -> 403. El super admin sí -> 200.
//  - La lectura del usuario pide columnas concretas (nunca '*', que incluye password_hash).
//  - Error de la base al leer -> 500 sin detalles internos y sin actualizar. Usuario inexistente -> 404.
//  - Todas las respuestas de error llevan ok:false.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

const SUPER = 'jefe@example.com';
const sesion = (u) => ({ Authorization: `Bearer ${tokenPrueba(u)}` });
const SUPER_SESION = sesion({ id_usuario: 1, email: SUPER, rol: 'admin' });
const ADMIN_SESION = sesion({ id_usuario: 2, email: 'admin2@example.com', rol: 'admin' });

const CLIENTE = { id_usuario: 50, email: 'cliente@example.com', rol: 'cliente' };
const OTRO_ADMIN = { id_usuario: 60, email: 'otro.admin@example.com', rol: 'admin' };
const CUENTA_SUPER = { id_usuario: 1, email: SUPER, rol: 'admin' };

const fake = crearFakeSupabase();
let app;
beforeAll(() => {
  ({ app } = cargarServidor(fake, { superAdmin: SUPER }));
});
beforeEach(() => {
  fake.reiniciar();
});

const objetivo = (fila) => fake.responder('usuario', 'select', { data: fila, error: null });
const cambiarRol = (id, rol, cab = SUPER_SESION) =>
  request(app).put(`/api/admin/users/${id}/role`).set(cab).send({ rol });
const lecturas = () => fake.consultas('usuario', 'select');
const updates = () => fake.consultas('usuario', 'update');

describe('PUT /api/admin/users/:id/role: ascender a admin', () => {
  it('admin normal asciende a un cliente -> 403 en español y no actualiza', async () => {
    objetivo(CLIENTE);
    const res = await cambiarRol(50, 'admin', ADMIN_SESION);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/super administrador puede ascender/i);
    expect(res.body.message).not.toMatch(/@/);
    expect(updates()).toHaveLength(0);
  });

  it('super admin asciende a un cliente -> 200 y actualiza ese id con rol admin', async () => {
    objetivo(CLIENTE);
    const res = await cambiarRol(50, 'admin');
    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ rol: 'admin' });
    expect(updates()[0].filtros).toContainEqual(['eq', 'id_usuario', 50]);
  });

  it('la lectura del usuario pide columnas concretas, no *', async () => {
    objetivo(CLIENTE);
    await cambiarRol(50, 'admin');
    expect(lecturas()).toHaveLength(1);
    expect(lecturas()[0].columnas).toBe('id_usuario, email, rol');
    expect(lecturas()[0].modo).toBe('maybeSingle');
    expect(lecturas()[0].filtros).toContainEqual(['eq', 'id_usuario', 50]);
  });
});

describe('PUT /api/admin/users/:id/role: id de la URL', () => {
  it.each(['abc', '0', '-1', '1.5', '2147483648', '1e3', '%20'])('id "%s" -> 400 sin consultar la base', async (id) => {
    const res = await cambiarRol(id, 'cliente');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(lecturas()).toHaveLength(0);
    expect(updates()).toHaveLength(0);
  });
});

describe('PUT /api/admin/users/:id/role: reglas que ya existían', () => {
  it('rol no válido -> 400', async () => {
    const res = await cambiarRol(50, 'super_admin');
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it('sin sesión -> 401', async () => {
    const res = await request(app).put('/api/admin/users/50/role').send({ rol: 'admin' });
    expect(res.status).toBe(401);
  });

  it('nadie toca el rol del super admin, ni él mismo -> 403 { ok:false }', async () => {
    objetivo(CUENTA_SUPER);
    const res = await cambiarRol(1, 'cliente');
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/cuenta principal/i);
    expect(updates()).toHaveLength(0);
  });

  it('una cuenta con rol super_admin también está protegida, aunque su correo no sea el configurado', async () => {
    objetivo({ id_usuario: 7, email: 'otra@example.com', rol: 'super_admin' });
    const res = await cambiarRol(7, 'admin');
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/cuenta principal/i);
    expect(updates()).toHaveLength(0);
  });

  it('admin normal que pide admin sobre la cuenta del super admin -> mensaje de cuenta protegida, no el de ascender', async () => {
    objetivo(CUENTA_SUPER);
    const res = await cambiarRol(1, 'admin', ADMIN_SESION);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cuenta principal/i);
    expect(updates()).toHaveLength(0);
  });

  it('admin normal no puede bajar a otro admin -> 403', async () => {
    objetivo(OTRO_ADMIN);
    const res = await cambiarRol(60, 'cliente', ADMIN_SESION);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it('super admin baja a un admin a cliente -> 200', async () => {
    objetivo(OTRO_ADMIN);
    const res = await cambiarRol(60, 'cliente');
    expect(res.status).toBe(200);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ rol: 'cliente' });
  });

  it('usuario inexistente -> 404', async () => {
    objetivo(null);
    const res = await cambiarRol(999, 'admin');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(updates()).toHaveLength(0);
  });

  it('error de la base al leer -> 500 sin detalles internos y sin actualizar', async () => {
    fake.responder('usuario', 'select', { data: null, error: { code: 'XX000', message: 'detalle-interno-secreto' } });
    const res = await cambiarRol(50, 'admin');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/detalle-interno-secreto/);
    expect(updates()).toHaveLength(0);
  });

  it('error de la base al actualizar -> 500 sin detalles internos', async () => {
    objetivo(CLIENTE);
    fake.responder('usuario', 'update', { data: null, error: { code: 'XX000', message: 'detalle-interno-secreto' } });
    const res = await cambiarRol(50, 'admin');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/detalle-interno-secreto/);
  });
});
