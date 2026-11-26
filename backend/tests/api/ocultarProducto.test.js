// Ocultar / Mostrar un producto en la tienda desde el panel (2026-11-26).
// Un producto con ventas no se puede borrar (409, la base lo protege); en su lugar el admin lo oculta con
// producto.estado = false. La tienda (/api/products) y Gelbot solo muestran estado = true, y el panel lista
// todos (también los ocultos) con GET /api/admin/products.
// Supabase y Groq son FALSOS. La tabla producto se simula EN MEMORIA (los filtros eq y el "sin personalizado"
// se aplican de verdad), así "ocultar -> la tienda no lo trae" prueba el recorrido completo y no un dato fijo.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin, tokenPrueba } from '../helpers/cargarServidor.js';
import { CATALOGO_REAL } from '../helpers/catalogoReal.js';

const PERSONALIZADO = {
  id_producto: 14, nombre: 'Helado personalizado 3D', precio: 10000, categoria: 'Clásico', tags: null,
  imagen: '/images/14.png', descripcion: 'Arma tu helado', estado: true, stock: 0, tipo: 'personalizado',
};
const PISTACHO = 13;
const bearer = (rol) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 7, email: 'x@example.com', rol })}` });
const texto = (content) => ({ choices: [{ message: { role: 'assistant', content } }] });
const pideHerramienta = (name, args = {}) => ({
  choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }],
});

const fake = crearFakeSupabase();
let tabla;

// ¿La fila cumple los filtros de la consulta? (eq de columnas y el .or() que excluye el personalizado)
function cumple(fila, filtros) {
  return filtros.every(([op, col, valor]) => {
    if (op === 'eq') return fila[col] === valor;
    if (op === 'or') return fila.tipo !== 'personalizado';
    return true;
  });
}
const proyectar = (fila, columnas) => (columnas
  ? Object.fromEntries(columnas.split(',').map((c) => c.trim()).map((c) => [c, fila[c]]))
  : { ...fila });
const segunModo = (filas, modo) => (modo === 'varias' ? filas : filas[0] ?? null);

beforeEach(() => {
  fake.reiniciar();
  tabla = [...CATALOGO_REAL, PERSONALIZADO].map((p) => ({ tipo: null, destacado: false, ...p }));
  fake.responder('usuario', 'select', { data: { id_usuario: 7, nombre: 'Carlos', email: 'x@example.com', rol: 'cliente' }, error: null });
  fake.responder('producto', 'select', (l) => {
    const filas = tabla.filter((f) => cumple(f, l.filtros)).map((f) => proyectar(f, l.columnas));
    return { data: segunModo(filas, l.modo), error: null };
  });
  fake.responder('producto', 'update', (l) => {
    const filas = tabla.filter((f) => cumple(f, l.filtros));
    for (const f of filas) Object.assign(f, l.payload);
    return { data: segunModo(filas.map((f) => proyectar(f, l.columnasRetorno)), l.modo), error: null };
  });
});

const nuevaApp = (opciones) => cargarServidor(fake, opciones).app;
const visible = (app, id, cuerpo, cabeceras = authAdmin()) =>
  request(app).put(`/api/admin/products/${id}/visible`).set(cabeceras).send(cuerpo);
const idsTienda = async (app) => (await request(app).get('/api/products')).body.map((p) => p.id);

describe('PUT /api/admin/products/:id/visible: permisos y validación', () => {
  let app;
  beforeEach(() => { app = nuevaApp(); });

  it('sin token -> 401 y no toca la base', async () => {
    const res = await request(app).put(`/api/admin/products/${PISTACHO}/visible`).send({ estado: false });
    expect(res.status).toBe(401);
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });

  it('un cliente -> 403 y no toca la base', async () => {
    const res = await visible(app, PISTACHO, { estado: false }, bearer('cliente'));
    expect(res.status).toBe(403);
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });

  it.each(['abc', '0', '-3', '1.5', '99999999999'])('id "%s" -> 400', async (id) => {
    const res = await visible(app, id, { estado: false });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, message: 'Identificador de producto no válido.' });
    expect(fake.consultas('producto', 'update')).toHaveLength(0);
  });

  it.each([['texto "false"', 'false'], ['texto "true"', 'true'], ['número 0', 0], ['número 1', 1], ['null', null], ['sin valor', undefined], ['arreglo', [false]]])(
    'estado %s -> 400 (solo true o false de verdad)', async (_n, valor) => {
      const res = await visible(app, PISTACHO, { estado: valor });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, message: 'El estado debe ser verdadero o falso.' });
      expect(fake.consultas('producto', 'update')).toHaveLength(0);
    });

  it('producto que no existe -> 404', async () => {
    const res = await visible(app, 999, { estado: false });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, message: 'El producto no existe.' });
  });

  it('el helado personalizado -> 409 y sigue visible', async () => {
    const res = await visible(app, PERSONALIZADO.id_producto, { estado: false });
    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(tabla.find((f) => f.id_producto === 14).estado).toBe(true);
  });

  it('ocultar guarda SOLO estado=false en la base y responde ok', async () => {
    const res = await visible(app, PISTACHO, { estado: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, id: PISTACHO, estado: false });
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ estado: false });
    expect(tabla.find((f) => f.id_producto === PISTACHO).estado).toBe(false);
  });

  it('si la base falla -> 500 con mensaje en español (nunca un éxito falso)', async () => {
    fake.reiniciar();
    fake.responder('producto', 'update', { data: null, error: { code: '57014', message: 'timeout interno' } });
    const res = await visible(app, PISTACHO, { estado: false });
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).not.toMatch(/timeout interno/);
  });
});

describe('la tienda nunca muestra un producto oculto', () => {
  it('ocultar -> /api/products no lo trae; mostrar -> vuelve', async () => {
    const app = nuevaApp();
    expect(await idsTienda(app)).toContain(PISTACHO);

    expect((await visible(app, PISTACHO, { estado: false })).status).toBe(200);
    expect(await idsTienda(app)).not.toContain(PISTACHO);

    expect((await visible(app, PISTACHO, { estado: true })).status).toBe(200);
    expect(await idsTienda(app)).toContain(PISTACHO);
  });

  it('si la base falla y se usa el catálogo de emergencia, lo ocultado tampoco aparece', async () => {
    const app = nuevaApp();
    expect((await visible(app, 5, { estado: false })).status).toBe(200);

    fake.reiniciar();
    fake.responder('producto', 'select', { data: null, error: { code: '57014', message: 'timeout' } });
    const ids = await idsTienda(app);
    expect(ids.length).toBeGreaterThan(0); // sí es el catálogo de emergencia
    expect(ids).not.toContain(5);
  });
});

describe('GET /api/admin/products: el panel ve todos, también los ocultos', () => {
  it('sin token -> 401; cliente -> 403', async () => {
    const app = nuevaApp();
    expect((await request(app).get('/api/admin/products')).status).toBe(401);
    expect((await request(app).get('/api/admin/products').set(bearer('cliente'))).status).toBe(403);
  });

  it('incluye los ocultos con su estado y nunca el personalizado', async () => {
    const app = nuevaApp();
    await visible(app, PISTACHO, { estado: false });

    const res = await request(app).get('/api/admin/products').set(authAdmin());

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const ids = res.body.products.map((p) => p.id);
    expect(ids).toEqual(CATALOGO_REAL.map((p) => p.id_producto));
    expect(ids).not.toContain(PERSONALIZADO.id_producto);
    expect(res.body.products.find((p) => p.id === PISTACHO)).toMatchObject({
      id: PISTACHO, name: 'Helado de Pistacho Italiano', precio: 14500, categoria: 'Clásico', estado: false,
    });
    expect(res.body.products.find((p) => p.id === 1).estado).toBe(true);
  });

  it('el personalizado se excluye también aunque la base lo devuelva', async () => {
    const app = nuevaApp();
    fake.reiniciar();
    fake.responder('producto', 'select', { data: [{ ...CATALOGO_REAL[0], tipo: null }, PERSONALIZADO], error: null });
    const res = await request(app).get('/api/admin/products').set(authAdmin());
    expect(res.body.products.map((p) => p.id)).toEqual([1]);
  });

  it('estado nulo cuenta como oculto (la tienda tampoco lo muestra)', async () => {
    const app = nuevaApp();
    fake.reiniciar();
    fake.responder('producto', 'select', { data: [{ ...CATALOGO_REAL[0], tipo: null, estado: null }], error: null });
    const res = await request(app).get('/api/admin/products').set(authAdmin());
    expect(res.body.products[0].estado).toBe(false);
  });

  it('pide columnas concretas que existen, sin "*", y excluye el personalizado en la consulta', async () => {
    const app = nuevaApp();
    await request(app).get('/api/admin/products').set(authAdmin());
    const consulta = fake.consultas('producto', 'select')[0];
    expect(consulta.columnas).not.toContain('*');
    const pedidas = consulta.columnas.split(',').map((c) => c.trim());
    for (const c of pedidas) expect(fake.columnas.producto.has(c)).toBe(true);
    expect(pedidas).toContain('estado');
    expect(consulta.filtros).toContainEqual(['or', 'tipo.is.null,tipo.neq.personalizado']);
  });

  it('si la base falla -> 500 (nunca una lista vacía que parece real)', async () => {
    const app = nuevaApp();
    fake.reiniciar();
    fake.responder('producto', 'select', { data: null, error: { code: '57014', message: 'timeout' } });
    const res = await request(app).get('/api/admin/products').set(authAdmin());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, message: 'Error al obtener los productos del panel.' });
  });
});

describe('Gelbot deja de ofrecer un producto apenas se oculta (la caché se invalida)', () => {
  // Un modelo tramposo que intenta agregar el Pistacho igual.
  const groq = async () => pideHerramienta('addToCart', { productName: 'Helado de Pistacho Italiano' });
  const chat = (app, message) => request(app).post('/api/chatbot').set(bearer('cliente')).send({ message, history: [] });
  const nombra = (body) => JSON.stringify(body).includes('Pistacho Italiano');

  it('menú, precio y pedido: antes de ocultar sí aparece; después, nada; al mostrar, vuelve', async () => {
    const app = nuevaApp({ groq });

    // 1. Con el producto visible: el menú lo trae (y así queda en la caché de 1 minuto).
    const antes = (await chat(app, 'quiero un helado')).body;
    expect(antes.productos.map((p) => p.id)).toContain(PISTACHO);

    // 2. El admin lo oculta.
    expect((await visible(app, PISTACHO, { estado: false })).status).toBe(200);

    // 3. Gelbot ya no lo nombra, no da su precio, ni su ficha, ni lo agrega al carrito.
    for (const frase of ['quiero un helado', '¿cuánto cuesta el helado de pistacho italiano?', 'dame un helado de pistacho italiano',
      '¿qué lleva el helado de pistacho italiano?', 'helado de pistacho italiano']) {
      const body = (await chat(app, frase)).body;
      expect(nombra(body), frase).toBe(false);
      expect(body.response, frase).not.toContain('14.500');
      expect((body.productos || []).map((p) => p.id), frase).not.toContain(PISTACHO);
      expect(body.product?.id ?? null, frase).not.toBe(PISTACHO);
    }

    // 4. Al mostrarlo de nuevo vuelve al menú.
    expect((await visible(app, PISTACHO, { estado: true })).status).toBe(200);
    expect((await chat(app, 'quiero un helado')).body.productos.map((p) => p.id)).toContain(PISTACHO);
  });

  it('una respuesta fallida (404) no invalida la caché', async () => {
    const app = nuevaApp({ groq });
    await chat(app, 'quiero un helado');
    const lecturasAntes = fake.consultas('producto', 'select').length;
    expect((await visible(app, 999, { estado: false })).status).toBe(404);
    const lecturasTras404 = fake.consultas('producto', 'select').length; // responderSinFila mira la base
    await chat(app, 'quiero un helado');
    expect(lecturasTras404).toBeGreaterThan(lecturasAntes);
    expect(fake.consultas('producto', 'select').length).toBe(lecturasTras404);
  });
});
