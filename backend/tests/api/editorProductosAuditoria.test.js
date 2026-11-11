// Editor de productos: arreglos de la auditoría (imagen con espacios, categorías, topes, mensaje 409).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin } from '../helpers/cargarServidor.js';
import request from 'supertest';

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

const RUTAS_MODAL = [
  '/images/gelato_fresa.png', '/images/gelato_chocolate.png', '/images/gelato_mango.png', '/images/gelato_berries.png',
  '/images/gelato_pistacho.png', '/images/caramelo salado.png', '/images/vainilla de madagascar.png',
  '/images/limone di amalfi.png', '/images/Tiramisú Artigianale.png', '/images/Coco & Lima.png',
  '/images/Matcha Ceremonial.png', '/images/rosa y lichi.png',
];

describe('imagen: rutas locales con espacios, tildes y &', () => {
  it.each(RUTAS_MODAL)('acepta %s tal cual', async (ruta) => {
    fake.responder('producto', 'update', { data: { id_producto: 7 }, error: null });
    const res = await put('/api/admin/products/7/image', { image: ruta });
    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ imagen: ruta });
  });

  it.each(['/a\\b.png', '/a\u0000b.png', '/a\nb.png', '/a/../b.png', '//otro.com/a.png'])('rechaza %j', async (ruta) => {
    expect((await put('/api/admin/products/7/image', { image: ruta })).status).toBe(400);
  });

  it('acepta HTTPS en mayúsculas y guarda la URL normalizada', async () => {
    fake.responder('producto', 'update', { data: { id_producto: 7 }, error: null });
    const res = await put('/api/admin/products/7/image', { image: 'HTTPS://Cdn.Example.com/a b.png' });
    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ imagen: 'https://cdn.example.com/a%20b.png' });
  });
});

describe('categorías válidas', () => {
  it.each(['Clásico', 'Vegano', 'Temporada', 'Gourmet'])('editor acepta %s', async (c) => {
    productoExiste();
    expect((await put('/api/admin/products/7', { categoria: c })).status).toBe(200);
  });
  it.each(['', 'Otra', 'gourmet'])('editor rechaza %j', async (c) => {
    expect((await put('/api/admin/products/7', { categoria: c })).status).toBe(400);
  });
  it('/category acepta Gourmet y rechaza lo demás', async () => {
    expect((await put('/api/admin/products/7/category', { categoria: 'Otra' })).status).toBe(400);
    expect((await put('/api/admin/products/7/category', { categoria: 'Gourmet' })).status).toBe(200);
  });
});

describe('precio, stock e id: reglas y topes', () => {
  it.each([
    [{ precio: 0 }], [{ precio: 1.5 }], [{ precio: true }], [{ precio: [5] }], [{ precio: 100000000 }],
    [{ stock: true }], [{ stock: [5] }], [{ stock: 2147483648 }],
  ])('cuerpo inválido %j -> 400', async (cuerpo) => {
    expect((await put('/api/admin/products/7', cuerpo)).status).toBe(400);
  });

  it('acepta los topes: precio 99999999 y stock 2147483647', async () => {
    productoExiste();
    expect((await put('/api/admin/products/7', { precio: 99999999, stock: 2147483647 })).status).toBe(200);
  });

  it('id mayor que 2147483647 -> 400 sin tocar la base (PUT, imagen y DELETE)', async () => {
    expect((await put('/api/admin/products/2147483648', { stock: 1 })).status).toBe(400);
    expect((await put('/api/admin/products/2147483648/image', { image: '/a.png' })).status).toBe(400);
    expect((await del('/api/admin/products/2147483648')).status).toBe(400);
    expect(fake.consultas('producto')).toHaveLength(0);
  });
});

describe('mensaje 409', () => {
  it('dice que no se puede borrar, sin hablar de desactivar', async () => {
    fake.responder('producto', 'delete', { data: null, error: { code: '23503', message: 'x' } });
    const res = await del('/api/admin/products/7');
    expect(res.body.message).toBe('Este producto tiene ventas registradas y no se puede borrar.');
  });
});
