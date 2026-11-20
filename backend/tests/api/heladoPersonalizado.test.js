// Helado personalizado 3D en el servidor:
//  - POST /api/payments/process acepta líneas {tipo:'personalizado', envase, sabores, toppings, quantity},
//    valida forma, tipos y largos, y pasa a registrar_venta SOLO {tipo, envase, sabores, toppings, cantidad}
//    (el precio, la foto y el id del navegador se ignoran: el precio lo pone la base).
//  - PERSONALIZADO_INVALIDO / PERSONALIZADO_NO_DISPONIBLE -> 400 con mensaje en español.
//  - El recibo por correo muestra la composición (escapada).
//  - GET /api/personalizado/precios: precios y límites desde la base, cacheable.
//  - GET /api/admin/sales/:id/items: detalle de una venta con su composición (solo admin).
//  - El panel no lista el producto personalizado entre los productos editables.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba, authAdmin } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
const correos = [];
let app;
let esperas;

const COMPOSICION = {
  envase: { id: 'cone', nombre: 'Cono', precio: 8000 },
  sabores: [{ id: 'vanilla', nombre: 'Vainilla', precio: 2000 }, { id: 'mora', nombre: 'Mora', precio: 2000 }],
  toppings: [{ id: 'cherry', nombre: 'Cereza', precio: 1000 }],
};
const VENTA_PERSONALIZADA = {
  id_venta: 90,
  total: 13000,
  subtotal: 13000,
  estado: 'Pagado',
  items: [{ id_producto: 14, nombre: 'Helado personalizado 3D', cantidad: 1, precio_unitario: 13000, subtotal: 13000, personalizacion: COMPOSICION }],
  puntos_usados: 0,
  descuento: 0,
  puntos_ganados: 130,
  saldo: 130,
};

// Igual que lo que manda la página: precio, foto y nombre que el servidor debe ignorar.
const lineaPersonalizada = (extra = {}) => ({
  tipo: 'personalizado',
  id: 'pers:cone|vanilla,mora|cherry',
  name: 'Helado personalizado 3D',
  price: 1,
  image: 'data:image/png;base64,AAAA',
  envase: 'cone',
  sabores: ['vanilla', 'mora'],
  toppings: ['cherry'],
  quantity: 1,
  ...extra,
});

const sesion = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 3, email: 'u3@example.com', rol: 'cliente' })}` });
const pagar = (items) => request(app).post('/api/payments/process').set(sesion())
  .send({ method: 'NEQUI', bank: 'Nequi', items, amount: 1 });
const rpcVenta = () => fake.rpcs('registrar_venta');

beforeAll(() => {
  ({ app } = cargarServidor(fake, { correo: (m) => correos.push(m) }));
});

beforeEach(() => {
  fake.reiniciar();
  correos.length = 0;
  fake.responderRpc('registrar_venta', { data: VENTA_PERSONALIZADA, error: null });
  vi.spyOn(Math, 'random').mockReturnValue(0.1); // siempre aprobado
  const original = globalThis.setTimeout;
  esperas = vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) =>
    original(fn, ms >= 1000 ? 0 : ms, ...args),
  );
});

afterEach(() => {
  vi.mocked(Math.random).mockRestore();
  esperas.mockRestore();
});

describe('POST /api/payments/process con helado personalizado', () => {
  it('pasa a la base solo la composición y la cantidad; el precio del navegador se ignora', async () => {
    const res = await pagar([lineaPersonalizada({ quantity: 2 })]);

    expect(rpcVenta()).toHaveLength(1);
    expect(rpcVenta()[0].args.p_items).toEqual([
      { tipo: 'personalizado', envase: 'cone', sabores: ['vanilla', 'mora'], toppings: ['cherry'], cantidad: 2 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(13000);
    expect(res.body.transaction.amount).toBe(13000);
  });

  it('mezcla productos normales y personalizados en el orden del carrito', async () => {
    await pagar([{ id: 5, id_producto: 5, quantity: 1, price: 1 }, lineaPersonalizada()]);

    expect(rpcVenta()[0].args.p_items).toEqual([
      { id_producto: 5, cantidad: 1 },
      { tipo: 'personalizado', envase: 'cone', sabores: ['vanilla', 'mora'], toppings: ['cherry'], cantidad: 1 },
    ]);
  });

  it('sin toppings manda una lista vacía', async () => {
    const linea = lineaPersonalizada();
    delete linea.toppings;
    await pagar([linea]);

    expect(rpcVenta()[0].args.p_items[0].toppings).toEqual([]);
  });

  it('devuelve la composición en las líneas de la transacción', async () => {
    const res = await pagar([lineaPersonalizada()]);

    expect(res.body.transaction.items[0]).toMatchObject({ name: 'Helado personalizado 3D', personalizacion: COMPOSICION });
  });

  it.each([
    ['sin envase', { envase: undefined }],
    ['envase numérico', { envase: 3 }],
    ['dos envases', { envase: ['cone', 'cup'] }],
    ['envase con caracteres raros', { envase: '<script>' }],
    ['envase demasiado largo', { envase: 'a'.repeat(41) }],
    ['sabores que no son lista', { sabores: 'vanilla' }],
    ['sin sabores', { sabores: [] }],
    ['demasiados sabores', { sabores: Array.from({ length: 11 }, (_, i) => `s${i}`) }],
    ['sabor que no es texto', { sabores: [{ id: 'vanilla' }] }],
    ['sabor vacío', { sabores: [''] }],
    ['toppings que no son lista', { toppings: 'cherry' }],
    ['demasiados toppings', { toppings: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['cantidad 0', { quantity: 0 }],
    ['cantidad decimal', { quantity: 1.5 }],
    ['cantidad 100', { quantity: 100 }],
  ])('%s -> 400 sin llamar a la base', async (_caso, extra) => {
    const res = await pagar([lineaPersonalizada(extra)]);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(rpcVenta()).toHaveLength(0);
  });

  it('PERSONALIZADO_INVALIDO de la base -> 400 con mensaje en español', async () => {
    fake.responderRpc('registrar_venta', { data: null, error: { code: 'P0001', message: 'PERSONALIZADO_INVALIDO' } });
    const res = await pagar([lineaPersonalizada()]);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/helado personalizado/i);
    expect(res.body.message).not.toMatch(/PERSONALIZADO_INVALIDO/);
  });

  it('PERSONALIZADO_NO_DISPONIBLE de la base -> 400 con mensaje en español', async () => {
    fake.responderRpc('registrar_venta', { data: null, error: { code: 'P0001', message: 'PERSONALIZADO_NO_DISPONIBLE' } });
    const res = await pagar([lineaPersonalizada()]);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no está disponible/i);
  });

  it('el recibo por correo muestra la composición, escapada', async () => {
    fake.responder('usuario', 'select', { data: { nombre: 'Ana', email: 'ana@example.com' }, error: null });
    const conHtml = {
      ...VENTA_PERSONALIZADA,
      items: [{ ...VENTA_PERSONALIZADA.items[0], personalizacion: { ...COMPOSICION, toppings: [{ id: 'x', nombre: '<b>Oro</b>', precio: 1000 }] } }],
    };
    fake.responderRpc('registrar_venta', { data: conHtml, error: null });

    await pagar([lineaPersonalizada()]);

    expect(correos).toHaveLength(1);
    const html = correos[0].html;
    expect(html).toContain('Cono');
    expect(html).toContain('Vainilla, Mora');
    expect(html).toContain('&lt;b&gt;Oro&lt;/b&gt;');
    expect(html).not.toContain('<b>Oro</b>');
  });
});

describe('GET /api/personalizado/precios', () => {
  const COMPONENTES = [
    { id: 'cone', tipo: 'envase', nombre: 'Cono', precio: 8000 },
    { id: 'vanilla', tipo: 'sabor', nombre: 'Vainilla', precio: 2000 },
    { id: 'cherry', tipo: 'topping', nombre: 'Cereza', precio: 1000 },
  ];

  it('devuelve los componentes activos y los límites de la base, con caché pública', async () => {
    fake.responder('componente_personalizado', 'select', { data: COMPONENTES, error: null });
    fake.responderRpc('helado_personalizado_reglas', { data: { max_sabores: 3, max_toppings: 3 }, error: null });

    const res = await request(app).get('/api/personalizado/precios');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, maxSabores: 3, maxToppings: 3, componentes: COMPONENTES });
    expect(res.headers['cache-control']).toMatch(/public/);
    const consulta = fake.consultas('componente_personalizado', 'select')[0];
    expect(consulta.columnas).toBe('id, tipo, nombre, precio');
    expect(consulta.filtros).toContainEqual(['eq', 'activo', true]);
  });

  it('si la base falla -> 500 ok:false (nunca precios inventados)', async () => {
    fake.responder('componente_personalizado', 'select', { data: null, error: { message: 'permission denied' } });
    fake.responderRpc('helado_personalizado_reglas', { data: { max_sabores: 3, max_toppings: 3 }, error: null });

    const res = await request(app).get('/api/personalizado/precios');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('si las reglas fallan -> 500 ok:false', async () => {
    fake.responder('componente_personalizado', 'select', { data: COMPONENTES, error: null });
    fake.responderRpc('helado_personalizado_reglas', { data: null, error: { message: 'x' } });

    const res = await request(app).get('/api/personalizado/precios');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/admin/sales/:id/items', () => {
  const FILAS = [
    { id_detalle_venta: 1, cantidad: 2, precio_unitario: 2500, personalizacion: null, producto: { nombre: 'Helado de fresa' } },
    { id_detalle_venta: 2, cantidad: 1, precio_unitario: 13000, personalizacion: COMPOSICION, producto: { nombre: 'Helado personalizado 3D' } },
  ];

  it('el admin ve las líneas de la venta con su composición', async () => {
    fake.responder('detalle_venta', 'select', { data: FILAS, error: null });

    const res = await request(app).get('/api/admin/sales/90/items').set(authAdmin());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      items: [
        { nombre: 'Helado de fresa', cantidad: 2, precio_unitario: 2500, personalizacion: null },
        { nombre: 'Helado personalizado 3D', cantidad: 1, precio_unitario: 13000, personalizacion: COMPOSICION },
      ],
    });
    const consulta = fake.consultas('detalle_venta', 'select')[0];
    expect(consulta.filtros).toContainEqual(['eq', 'id_venta', 90]);
    expect(consulta.columnas).not.toMatch(/\*/);
  });

  it('un cliente no puede verlo', async () => {
    const res = await request(app).get('/api/admin/sales/90/items').set(sesion());
    expect(res.status).toBe(403);
    expect(fake.consultas('detalle_venta')).toHaveLength(0);
  });

  it('id inválido -> 400 sin consultar', async () => {
    const res = await request(app).get('/api/admin/sales/abc/items').set(authAdmin());
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(fake.consultas('detalle_venta')).toHaveLength(0);
  });

  it('si la base falla -> 500 ok:false', async () => {
    fake.responder('detalle_venta', 'select', { data: null, error: { message: 'x' } });
    const res = await request(app).get('/api/admin/sales/90/items').set(authAdmin());
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('panel: el producto personalizado no se edita ni se borra', () => {
  const PERSONALIZADO = { data: { id_producto: 14, tipo: 'personalizado' }, error: null };
  const rutas = [
    ['put', '/api/admin/products/14', { name: 'Otro', precio: 1, stock: 5 }],
    ['delete', '/api/admin/products/14', undefined],
    ['put', '/api/admin/products/14/price', { precio: 1 }],
    ['put', '/api/admin/products/14/stock', { stock: 5 }],
    ['put', '/api/admin/products/14/category', { categoria: 'Vegano' }],
    ['put', '/api/admin/products/14/featured', { destacado: true }],
    ['put', '/api/admin/products/14/image', { image: '/images/gelato_fresa.png' }],
  ];

  // La base no toca el personalizado porque cada escritura lleva el filtro (tipo null o distinto de
  // 'personalizado'): la escritura no devuelve fila y el servidor responde 409 (no 404).
  const FILTRO = ['or', 'tipo.is.null,tipo.neq.personalizado'];
  const escrituras = () => [...fake.consultas('producto', 'update'), ...fake.consultas('producto', 'delete')];

  it.each(rutas)('%s %s -> 409 con mensaje claro; la escritura lleva el filtro que protege al personalizado', async (metodo, url, cuerpo) => {
    fake.responder('producto', 'select', PERSONALIZADO);
    const peticion = request(app)[metodo](url).set(authAdmin());
    const res = await (cuerpo ? peticion.send(cuerpo) : peticion);

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/helado personalizado/i);
    expect(escrituras()).toHaveLength(1);
    expect(escrituras()[0].filtros).toContainEqual(FILTRO);
  });

  it('un producto normal se sigue editando (sin lecturas de más)', async () => {
    fake.responder('producto', 'update', { data: { id_producto: 5 }, error: null });

    const res = await request(app).put('/api/admin/products/5/price').set(authAdmin()).send({ precio: 3000 });

    expect(res.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].filtros).toContainEqual(FILTRO);
    expect(fake.consultas('producto', 'select')).toHaveLength(0);
  });

  it('un producto que no existe sigue dando 404', async () => {
    fake.responder('producto', 'select', { data: null, error: null });

    const res = await request(app).put('/api/admin/products/999/price').set(authAdmin()).send({ precio: 3000 });

    expect(res.status).toBe(404);
  });

  it('si la base no responde al revisar por qué no hubo fila -> 500', async () => {
    fake.responder('producto', 'select', { data: null, error: { message: 'x' } });

    const res = await request(app).put('/api/admin/products/5/price').set(authAdmin()).send({ precio: 3000 });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('panel: el producto personalizado no aparece entre los productos', () => {
  it('se oculta de la lista de productos del panel', async () => {
    fake.responder('venta', 'select', { data: [], error: null });
    fake.responder('producto', 'select', {
      data: [
        { id_producto: 5, nombre: 'Helado de fresa', precio: 2500, stock: 10, tipo: null },
        { id_producto: 14, nombre: 'Helado personalizado 3D', precio: 10000, stock: 0, tipo: 'personalizado' },
      ],
      error: null,
    });

    const res = await request(app).get('/api/admin/dashboard').set(authAdmin());

    expect(res.status).toBe(200);
    expect(res.body.products.map((p) => p.id)).toEqual([5]);
  });
});
