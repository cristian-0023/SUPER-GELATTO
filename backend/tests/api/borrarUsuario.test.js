// Seguridad de DELETE /api/admin/users/:id. Contrato (mismo patrón que PUT /role):
//  - El :id de la URL debe ser un entero positivo -> si no, 400 sin consultar ni borrar.
//  - La lectura del usuario pide columnas concretas (nunca '*', que incluye password_hash) y usa el id numérico.
//  - Usuario inexistente -> 404. Error de la base -> 500 { ok:false } sin detalles internos.
//  - La cuenta del super admin (por correo o por rol super_admin) nunca se borra -> 403.
//  - A un admin solo lo borra el super admin -> 403 para un admin normal. Un cliente lo borra cualquier admin.
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

const fake = crearFakeSupabase();
let app;
beforeAll(() => {
  ({ app } = cargarServidor(fake, { superAdmin: SUPER }));
});
beforeEach(() => {
  fake.reiniciar();
});

const objetivo = (fila) => fake.responder('usuario', 'select', { data: fila, error: null });
const borrar = (id, cab = SUPER_SESION) => request(app).delete(`/api/admin/users/${id}`).set(cab);
const lecturas = () => fake.consultas('usuario', 'select');
const borrados = () => fake.consultas('usuario', 'delete');

describe('DELETE /api/admin/users/:id: id de la URL', () => {
  it.each(['abc', '0', '-1', '1.5', '2147483648', '1e3', '%20'])('id "%s" -> 400 sin consultar ni borrar', async (id) => {
    const res = await borrar(id);
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(lecturas()).toHaveLength(0);
    expect(borrados()).toHaveLength(0);
  });
});

describe('DELETE /api/admin/users/:id: lectura y errores', () => {
  it('lee con columnas concretas y el id numérico, y borra ese id', async () => {
    objetivo(CLIENTE);
    const res = await borrar(50);
    expect(res.status).toBe(200);
    expect(lecturas()).toHaveLength(1);
    expect(lecturas()[0].columnas).toBe('id_usuario, email, rol');
    expect(lecturas()[0].modo).toBe('maybeSingle');
    expect(lecturas()[0].filtros).toContainEqual(['eq', 'id_usuario', 50]);
    expect(borrados()).toHaveLength(1);
    expect(borrados()[0].filtros).toContainEqual(['eq', 'id_usuario', 50]);
  });

  it('usuario inexistente -> 404 { ok:false } y no borra', async () => {
    objetivo(null);
    const res = await borrar(999);
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(borrados()).toHaveLength(0);
  });

  it('error de la base al leer -> 500 sin detalles internos y no borra', async () => {
    fake.responder('usuario', 'select', { data: null, error: { code: 'XX000', message: 'detalle-interno-secreto' } });
    const res = await borrar(50);
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/detalle-interno-secreto/);
    expect(borrados()).toHaveLength(0);
  });

  it('error de la base al borrar -> 500 sin detalles internos', async () => {
    objetivo(CLIENTE);
    fake.responder('usuario', 'delete', { data: null, error: { code: '23503', message: 'detalle-interno-secreto' } });
    const res = await borrar(50);
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/detalle-interno-secreto/);
  });
});

describe('DELETE /api/admin/users/:id: reglas que ya existían', () => {
  it('sin sesión -> 401', async () => {
    const res = await request(app).delete('/api/admin/users/50');
    expect(res.status).toBe(401);
  });

  it.each([
    ['por correo', { id_usuario: 1, email: SUPER, rol: 'admin' }],
    ['por rol super_admin', { id_usuario: 7, email: 'otra@example.com', rol: 'super_admin' }],
  ])('la cuenta del super admin (%s) nunca se borra -> 403 { ok:false }', async (_c, fila) => {
    objetivo(fila);
    const res = await borrar(fila.id_usuario);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(borrados()).toHaveLength(0);
  });

  it('admin normal no puede borrar a otro admin -> 403 { ok:false }', async () => {
    objetivo(OTRO_ADMIN);
    const res = await borrar(60, ADMIN_SESION);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(borrados()).toHaveLength(0);
  });

  it('admin normal sí borra a un cliente -> 200', async () => {
    objetivo(CLIENTE);
    const res = await borrar(50, ADMIN_SESION);
    expect(res.status).toBe(200);
    expect(borrados()).toHaveLength(1);
  });

  it('el super admin borra a un admin -> 200', async () => {
    objetivo(OTRO_ADMIN);
    const res = await borrar(60);
    expect(res.status).toBe(200);
    expect(borrados()).toHaveLength(1);
  });
});
