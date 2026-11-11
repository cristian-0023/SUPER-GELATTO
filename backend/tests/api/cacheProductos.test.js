// GET /api/products es lo más pedido de la tienda: el CDN de Vercel lo guarda 30 s (y puede servir la copia
// anterior hasta 30 s más mientras la renueva). Así los cambios del panel se ven en ~60 s como máximo.
// Solo se guarda en caché lo que vino de la base: el catálogo local de emergencia nunca se cachea.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
let app;

beforeAll(() => {
  ({ app } = cargarServidor(fake));
});
beforeEach(() => fake.reiniciar());

describe('GET /api/products: caché corta en el CDN', () => {
  it('con datos de la base -> Cache-Control public, s-maxage=30, stale-while-revalidate=30', async () => {
    fake.responder('producto', 'select', { data: [{ id_producto: 5, nombre: 'Fresa', precio: 2500, estado: true, stock: 3 }], error: null });

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=30, stale-while-revalidate=30');
  });

  it('la respuesta cacheada varía según el Origin (el CDN no mezcla la copia de un sitio con la de otro)', async () => {
    fake.responder('producto', 'select', { data: [{ id_producto: 5, nombre: 'Fresa', precio: 2500, estado: true, stock: 3 }], error: null });

    const res = await request(app).get('/api/products').set('Origin', 'https://tienda.vercel.app');

    expect(res.headers['access-control-allow-origin']).toBe('https://tienda.vercel.app');
    expect(res.headers.vary).toMatch(/origin/i);
  });

  it('si la base falla y se usa el catálogo local -> no-store (no se cachea el respaldo)', async () => {
    fake.responder('producto', 'select', { data: null, error: { code: '57014', message: 'timeout' } });

    const res = await request(app).get('/api/products');

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('pide columnas concretas (no *) y todas existen en la base', async () => {
    fake.responder('producto', 'select', { data: [{ id_producto: 5, nombre: 'Fresa', precio: 2500, estado: true, stock: 3 }], error: null });

    await request(app).get('/api/products');

    const columnas = fake.consultas('producto', 'select')[0].columnas;
    expect(columnas).toBeTruthy();
    expect(columnas).not.toContain('*');
    const pedidas = columnas.split(',').map((c) => c.trim());
    for (const c of pedidas) expect(fake.columnas.producto.has(c)).toBe(true);
    for (const c of ['id_producto', 'nombre', 'precio', 'stock', 'destacado', 'imagen', 'categoria']) expect(pedidas).toContain(c);
  });

  it('si la base no trae productos y se usa el catálogo local -> no-store', async () => {
    fake.responder('producto', 'select', { data: [], error: null });

    const res = await request(app).get('/api/products');

    expect(res.headers['cache-control']).toBe('no-store');
  });
});
