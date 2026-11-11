// GET /api/products es lo más pedido de la tienda: el CDN de Vercel lo guarda 30 s (y puede servir la copia
// anterior hasta 60 s más mientras la renueva). Así los cambios del panel se ven en menos de un minuto.
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
  it('con datos de la base -> Cache-Control public, s-maxage=30, stale-while-revalidate=60', async () => {
    fake.responder('producto', 'select', { data: [{ id_producto: 5, nombre: 'Fresa', precio: 2500, estado: true, stock: 3 }], error: null });

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=30, stale-while-revalidate=60');
  });

  it('si la base falla y se usa el catálogo local -> no-store (no se cachea el respaldo)', async () => {
    fake.responder('producto', 'select', { data: null, error: { code: '57014', message: 'timeout' } });

    const res = await request(app).get('/api/products');

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('si la base no trae productos y se usa el catálogo local -> no-store', async () => {
    fake.responder('producto', 'select', { data: [], error: null });

    const res = await request(app).get('/api/products');

    expect(res.headers['cache-control']).toBe('no-store');
  });
});
