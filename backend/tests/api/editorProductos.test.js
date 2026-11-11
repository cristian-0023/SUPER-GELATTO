// Editor de productos del panel de admin: PUT/DELETE /api/admin/products/:id y PUT .../image.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin, tokenPrueba } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
let app;
beforeAll(() => {
  ({ app } = cargarServidor(fake));
});
beforeEach(() => fake.reiniciar());

const put = (url, body) => request(app).put(url).set(authAdmin()).send(body);
const del = (url) => request(app).delete(url).set(authAdmin());
const FILA = { id_producto: 7, nombre: 'Fresa', precio: 5000, stock: 3, descripcion: 'x', imagen: '/a.png', categoria: 'Clásico', estado: true, destacado: false };
const productoExiste = () => fake.responder('producto', 'update', { data: FILA, error: null });
const ERROR_BASE = { data: null, error: { code: '42501', message: 'permission denied' } };

describe('acceso', () => {
  it.each([
    ['put', '/api/admin/products/7'],
    ['put', '/api/admin/products/7/image'],
    ['delete', '/api/admin/products/7'],
  ])('%s %s sin token -> 401', async (m, url) => {
    const res = await request(app)[m](url).set('x-user-role', 'admin').send({ image: '/a.png', name: 'x' });
    expect(res.status).toBe(401);
  });

  it('usuario que no es admin -> 403', async () => {
    const token = tokenPrueba({ id_usuario: 5, correo: 'cliente@example.com', rol: 'cliente' });
    const res = await request(app).put('/api/admin/products/7').set('Authorization', `Bearer ${token}`).send({ name: 'x' });
    expect(res.status).toBe(403);
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });
});

describe('PUT /api/admin/products/:id', () => {
  it.each(['abc', '0', '-1', '1.5', '9999999999999999999'])('id %s -> 400 sin tocar la base', async (id) => {
    const res = await put(`/api/admin/products/${id}`, { name: 'x' });
    expect(res.status).toBe(400);
    expect(fake.consultas('producto')).toHaveLength(0);
  });

  it.each([
    [{ name: '' }], [{ name: '   ' }], [{ name: 'a'.repeat(121) }], [{ name: 5 }],
    [{ precio: 'abc' }], [{ precio: -1 }], [{ precio: 1e999 }], [{ precio: null }], [{ precio: '' }],
    [{ stock: 'hola' }], [{ stock: -1 }], [{ stock: 1.5 }], [{ stock: '' }],
    [{ descripcion: 'a'.repeat(2001) }], [{ descripcion: 5 }],
    [{ categoria: 'a'.repeat(61) }], [{ categoria: 5 }],
    [{ estado: 'si' }],
    [{}], [{ otraCosa: 1 }],
  ])('cuerpo inválido %j -> 400', async (cuerpo) => {
    const res = await put('/api/admin/products/7', cuerpo);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/\S/);
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });

  it('guarda con los nombres de columna correctos (descripcion) y responde solo campos públicos', async () => {
    productoExiste(); // el falso no filtra columnas: lo privado se comprueba en el test del select
    const res = await put('/api/admin/products/7', { name: ' Fresa ', precio: '5000', stock: 3, descripcion: 'Rica', categoria: 'Clásico', estado: true });
    expect(res.status).toBe(200);
    const [llamada] = fake.consultas('producto', 'update');
    expect(llamada.payload).toEqual({ nombre: 'Fresa', precio: 5000, stock: 3, descripcion: 'Rica', categoria: 'Clásico', estado: true });
    expect(fake.errores).toEqual([]);
    expect(res.body.product).toMatchObject({ id_producto: 7, nombre: 'Fresa' });
    expect(JSON.stringify(res.body)).not.toMatch(/model_3d|task_id/);
  });

  it('el select pide columnas concretas, sin * ni model_3d_*', async () => {
    productoExiste();
    await put('/api/admin/products/7', { stock: 3 });
    const [llamada] = fake.consultas('producto', 'update');
    expect(llamada.columnasRetorno).toBeDefined();
    expect(llamada.columnasRetorno).not.toMatch(/\*|model_3d/);
  });

  it('producto inexistente -> 404', async () => {
    fake.responder('producto', 'update', { data: null, error: null });
    const res = await put('/api/admin/products/999', { stock: 3 });
    expect(res.status).toBe(404);
  });

  it('falla la base -> 500 genérico', async () => {
    fake.responder('producto', 'update', ERROR_BASE);
    const res = await put('/api/admin/products/7', { stock: 3 });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/permission/);
  });

  it('con stock sincroniza inventario; si inventario falla, el producto igual se guardó (200)', async () => {
    productoExiste();
    fake.responder('inventario', 'update', ERROR_BASE);
    const res = await put('/api/admin/products/7', { stock: 3 });
    expect(res.status).toBe(200);
    expect(fake.consultas('inventario', 'update')).toHaveLength(1);
  });
});

describe('PUT /api/admin/products/:id/image', () => {
  const ok = (image) => put('/api/admin/products/7/image', { image });

  it.each([
    'javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://sitio.com/a.png', 'ftp://x/a.png',
    '', '   ', '/../secreto.png', '/a/../b.png', 'relativa.png', '//otro.com/a.png', 'https://x.com/' + 'a'.repeat(2050),
    5, null,
  ])('imagen inválida %j -> 400', async (img) => {
    const res = await ok(img);
    expect(res.status).toBe(400);
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });

  it('sin campo image -> 400', async () => {
    expect((await put('/api/admin/products/7/image', {})).status).toBe(400);
  });

  it.each(['https://cdn.example.com/a.png', '/images/helado.png'])('acepta %s y guarda en imagen', async (img) => {
    fake.responder('producto', 'update', { data: { id_producto: 7 }, error: null });
    const res = await ok(` ${img} `);
    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ imagen: img });
    expect(fake.errores).toEqual([]);
  });

  it('id inválido -> 400', async () => {
    expect((await put('/api/admin/products/abc/image', { image: '/a.png' })).status).toBe(400);
  });

  it('producto inexistente -> 404', async () => {
    fake.responder('producto', 'update', { data: null, error: null });
    expect((await ok('/a.png')).status).toBe(404);
  });

  it('falla la base -> 500 genérico', async () => {
    fake.responder('producto', 'update', ERROR_BASE);
    const res = await ok('/a.png');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/permission/);
  });
});

describe('DELETE /api/admin/products/:id', () => {
  it('id inválido -> 400', async () => {
    expect((await del('/api/admin/products/abc')).status).toBe(400);
    expect(fake.consultas('producto')).toHaveLength(0);
  });

  it('borra y responde 200', async () => {
    fake.responder('producto', 'delete', { data: [{ id_producto: 7 }], error: null });
    const res = await del('/api/admin/products/7');
    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'delete')[0].filtros).toContainEqual(['eq', 'id_producto', 7]);
  });

  it('no borró nada -> 404', async () => {
    fake.responder('producto', 'delete', { data: [], error: null });
    expect((await del('/api/admin/products/7')).status).toBe(404);
  });

  it('clave foránea (23503) -> 409 con mensaje claro y sin detalles internos', async () => {
    fake.responder('producto', 'delete', { data: null, error: { code: '23503', message: 'violates foreign key constraint detalle_venta_id_producto_fkey' } });
    const res = await del('/api/admin/products/7');
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/ventas/i);
    expect(JSON.stringify(res.body)).not.toMatch(/fkey|constraint/);
  });

  it('otro fallo de base -> 500 genérico', async () => {
    fake.responder('producto', 'delete', ERROR_BASE);
    const res = await del('/api/admin/products/7');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/permission/);
  });
});
