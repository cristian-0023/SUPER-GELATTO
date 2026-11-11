// La base es la ÚNICA fuente de verdad cuando Supabase está configurado.
// En Vercel el disco es de solo lectura y cada instancia arranca desde el repositorio: lo que el servidor
// guardaba en archivos JSON (destacados, ventas "de respaldo", tareas 3D) se perdía, y lo commiteado en el
// repo "ganaba" sobre la base. Contrato:
//  - Destacados: solo producto.destacado (un featured_state.json viejo no cambia nada).
//  - Panel: ventas y productos solo de la base (ni fallback_sales.json ni el catálogo local).
//  - Modelos 3D: tarea, estado, prompt y URL en producto (model_3d_*). Tripo siempre es falso aquí.
//  - Con Supabase configurado, el servidor no escribe archivos.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin } from '../helpers/cargarServidor.js';

const ERROR_BASE = { data: null, error: { code: '42501', message: 'permission denied for table producto' } };
const MODELO = 'https://tripo.test/modelo.glb';

// Archivos viejos que quedaron commiteados: el servidor NO debe hacerles caso.
const ARCHIVOS_VIEJOS = {
  'featured_state.json': JSON.stringify({ 5: true, 7: true }),
  'fallback_sales.json': JSON.stringify([
    { id_venta: 1786290860730, id_usuario: 30, total: 42000, fecha: '2026-08-09T15:54:20.730Z', estado: 'En proceso', email: 'viejo@archivo.test' },
  ]),
  'tripo_models_state.json': JSON.stringify({ 5: { taskId: 'T-VIEJA', prompt: 'viejo', estado: 'listo', url: 'https://tripo.test/viejo.glb' } }),
};
const nombreViejo = (ruta) => Object.keys(ARCHIVOS_VIEJOS).find((n) => String(ruta).endsWith(n));

const fake = crearFakeSupabase();
const correos = [];
let app;
let escrituras;
let fetchFalso;

beforeAll(() => {
  const existe = fs.existsSync;
  const leer = fs.readFileSync;
  const espiaExiste = vi.spyOn(fs, 'existsSync').mockImplementation((r) => Boolean(nombreViejo(r)) || existe(r));
  const espiaLeer = vi.spyOn(fs, 'readFileSync').mockImplementation((r, ...a) => {
    const n = nombreViejo(r);
    return n ? ARCHIVOS_VIEJOS[n] : leer(r, ...a);
  });
  ({ app, escrituras } = cargarServidor(fake, { correo: (m) => correos.push(m) }));
  espiaExiste.mockRestore();
  espiaLeer.mockRestore();
});

beforeEach(() => {
  fake.reiniciar();
  escrituras.mockClear();
  correos.length = 0;
  fetchFalso = vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).endsWith('/task')
      ? { code: 0, data: { task_id: 'T-NUEVA' } }
      : { code: 0, data: { status: 'success', progress: 100, output: { model: MODELO } } }),
  }));
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => {
  vi.unstubAllGlobals();
  // Con Supabase configurado nunca se escribe un archivo (en Vercel no se puede).
  expect(escrituras).not.toHaveBeenCalled();
});

const llamadasATripo = () => fetchFalso.mock.calls.filter(([url]) => String(url).includes('tripo3d'));
const filaProducto = (extra = {}) => ({ id_producto: 5, nombre: 'Helado de fresa', precio: 2500, estado: true, stock: 10, destacado: false, ...extra });
const admin = (metodo, url) => request(app)[metodo](url).set(authAdmin());

describe('destacados: solo producto.destacado', () => {
  it('GET /api/products usa destacado de la base aunque el JSON viejo diga lo contrario', async () => {
    fake.responder('producto', 'select', { data: [filaProducto({ destacado: false })], error: null });

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.find((p) => p.id === 5).destacado).toBe(false);
  });

  it('destacar un producto se guarda en la base y se ve en GET /api/products (sin archivo)', async () => {
    const put = await admin('put', '/api/admin/products/5/featured').send({ destacado: true });
    expect(put.status).toBe(200);
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ destacado: true });

    fake.responder('producto', 'select', { data: [filaProducto({ destacado: true })], error: null });
    const res = await request(app).get('/api/products');
    expect(res.body.find((p) => p.id === 5).destacado).toBe(true);
  });
});

describe('panel de admin: solo la base', () => {
  it('no muestra ventas que no están en la base (fallback_sales.json se ignora)', async () => {
    fake.responder('venta', 'select', { data: [], error: null });

    const res = await admin('get', '/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.sales).toEqual([]);
    expect(res.body.stats.totalSales).toBe(0);
    expect(res.body.stats.totalRevenue).toBe(0);
  });

  it('productos borrados de la base no reaparecen desde el catálogo local', async () => {
    fake.responder('producto', 'select', { data: [filaProducto()], error: null });

    const res = await admin('get', '/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.products.map((p) => p.id)).toEqual([5]);
  });

  it('si la base no devuelve las ventas -> 500 (no un panel vacío que parece real)', async () => {
    fake.responder('venta', 'select', ERROR_BASE);
    const res = await admin('get', '/api/admin/dashboard');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('si la base no devuelve los productos -> 500', async () => {
    fake.responder('producto', 'select', ERROR_BASE);
    const res = await admin('get', '/api/admin/dashboard');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('cambiar el estado de una venta avisa al cliente de la base, no al del archivo viejo', async () => {
    fake.responderRpc('cambiar_estado_venta', { data: { id_venta: 1786290860730, id_usuario: 3, total: 42000, estado: 'Enviado' }, error: null });
    fake.responder('usuario', 'select', { data: { email: 'cliente@base.test', nombre: 'Cliente', apellido: 'Base' }, error: null });

    const res = await admin('put', '/api/admin/sales/1786290860730/status').send({ estado: 'Enviado' });

    expect(res.status).toBe(200);
    expect(correos.map((c) => c.to).join(' ')).toContain('cliente@base.test');
    expect(correos.map((c) => c.to).join(' ')).not.toContain('viejo@archivo.test');
  });
});

describe('modelos 3D: tarea, estado y URL en la base', () => {
  // La tarea se guarda en dos pasos: primero se reserva el producto ("generando", con el prompt; ver
  // tripoFrenos.test.js) y, cuando Tripo devuelve el id, se guarda model_3d_task_id. La base simulada
  // responde a la reserva con la fila, como haría la real si el producto no estaba generando.
  const reservaGanada = (llamada) => ({
    data: llamada.payload?.model_3d_estado === 'generando' ? { id_producto: llamada.filtros.find((f) => f[1] === 'id_producto')[2] } : null,
    error: null,
  });

  it('crear un producto con prompt guarda la tarea "generando" en la fila del producto', async () => {
    fake.responder('producto', 'update', reservaGanada);

    const res = await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d: 'cono de helado' });

    expect(res.status).toBe(201);
    expect(res.body.model).toEqual({ taskId: 'T-NUEVA', estado: 'generando' });
    const ups = fake.consultas('producto', 'update');
    expect(ups).toHaveLength(2);
    expect(ups[0].payload).toMatchObject({ model_3d_task_id: null, model_3d_estado: 'generando', model_3d_prompt: 'cono de helado', model_3d_url: null });
    expect(ups[1].payload).toEqual({ model_3d_task_id: 'T-NUEVA' });
    for (const up of ups) expect(up.filtros).toContainEqual(['eq', 'id_producto', res.body.product.id]);
    expect(fake.errores).toEqual([]);
  });

  it('crear con prompt: si la base no guarda la tarea, el producto queda creado pero sin modelo', async () => {
    fake.responder('producto', 'update', ERROR_BASE);

    const res = await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d: 'cono' });

    expect(res.status).toBe(201);
    expect(res.body.model).toBeNull();
  });

  it('el insert del producto no usa las columnas nuevas (crear funciona aunque falte la migración)', async () => {
    await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d: 'cono' });
    const fila = [].concat(fake.consultas('producto', 'insert')[0].payload)[0];
    expect(Object.keys(fila).filter((k) => k.startsWith('model_3d'))).toEqual([]);
  });

  it('regenerar guarda la tarea nueva en la base', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5 }, error: null });
    fake.responder('producto', 'update', reservaGanada);

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa de chocolate' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, taskId: 'T-NUEVA', productId: 5 });
    const ups = fake.consultas('producto', 'update');
    expect(ups).toHaveLength(2);
    expect(ups[0].payload).toMatchObject({ model_3d_task_id: null, model_3d_estado: 'generando', model_3d_prompt: 'copa de chocolate', model_3d_url: null });
    expect(ups[1].payload).toEqual({ model_3d_task_id: 'T-NUEVA' });
    for (const up of ups) expect(up.filtros).toContainEqual(['eq', 'id_producto', 5]);
  });

  it('regenerar: si la base no guarda la tarea -> 500', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5 }, error: null });
    fake.responder('producto', 'update', ERROR_BASE);

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('regenerar un producto que no existe -> 404 sin llamar a Tripo', async () => {
    fake.responder('producto', 'select', { data: null, error: null });

    const res = await admin('post', '/api/admin/products/999/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(404);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it.each([
    ['id no numérico', 'abc', { prompt: 'copa' }],
    ['prompt que no es texto', '5', { prompt: 123 }],
    ['prompt demasiado largo', '5', { prompt: 'a'.repeat(1001) }],
  ])('regenerar con %s -> 400 sin llamar a Tripo', async (_, id, body) => {
    const res = await admin('post', `/api/admin/products/${id}/regenerate-3d`).send(body);
    expect(res.status).toBe(400);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('consultar: un producto sin tarea -> idle (lee la base, no el JSON viejo)', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5, model_3d_task_id: null, model_3d_estado: null, model_3d_url: null, model_3d_prompt: null }, error: null });

    const res = await admin('get', '/api/admin/products/5/model-3d');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'idle', url: null });
    expect(fake.consultas('producto', 'select')[0].filtros).toContainEqual(['eq', 'id_producto', 5]);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('consultar: un modelo listo en la base se devuelve sin llamar a Tripo', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5, model_3d_task_id: 'T-1', model_3d_estado: 'listo', model_3d_url: MODELO, model_3d_prompt: 'copa' }, error: null });

    const res = await admin('get', '/api/admin/products/5/model-3d');

    expect(res.body).toMatchObject({ estado: 'listo', url: MODELO, glb_url: MODELO, prompt: 'copa' });
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('consultar: tarea generando que Tripo terminó -> guarda URL y estado "listo" en la base', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5, model_3d_task_id: 'T-1', model_3d_estado: 'generando', model_3d_url: null, model_3d_prompt: 'copa' }, error: null });

    const res = await admin('get', '/api/admin/products/5/model-3d');

    expect(res.body).toMatchObject({ estado: 'listo', url: MODELO });
    expect(llamadasATripo()[0][0]).toContain('/task/T-1');
    const ups = fake.consultas('producto', 'update');
    expect(ups).toHaveLength(1);
    expect(ups[0].payload).toEqual({ model_3d_url: MODELO, model_3d_estado: 'listo' });
  });

  it('consultar: tarea que falló en Tripo -> guarda estado "error" en la base', async () => {
    fetchFalso.mockImplementation(async () => ({ ok: true, json: async () => ({ code: 0, data: { status: 'failed', progress: 0, output: {} } }) }));
    fake.responder('producto', 'select', { data: { id_producto: 5, model_3d_task_id: 'T-1', model_3d_estado: 'generando', model_3d_url: null, model_3d_prompt: 'copa' }, error: null });

    const res = await admin('get', '/api/admin/products/5/model-3d');

    expect(res.body.estado).toBe('error');
    expect(fake.consultas('producto', 'update')[0].payload).toEqual({ model_3d_estado: 'error' });
  });

  it('consultar: si la base no responde -> 500', async () => {
    fake.responder('producto', 'select', ERROR_BASE);
    const res = await admin('get', '/api/admin/products/5/model-3d');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('los archivos JSON de estado ya no existen', () => {
  const fuente = fs.readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
  const raiz = new URL('../../../', import.meta.url);

  it.each(Object.keys(ARCHIVOS_VIEJOS))('server.js no usa %s', (archivo) => {
    expect(fuente).not.toContain(archivo);
  });

  it.each([
    ['backend/nodemon.json'],
    ['docs/arquitectura/03-contenedores.md'],
  ])('%s ya no menciona los archivos JSON de estado', (ruta) => {
    const texto = fs.readFileSync(new URL(ruta, raiz), 'utf8');
    for (const archivo of Object.keys(ARCHIVOS_VIEJOS)) expect(texto).not.toContain(archivo);
    expect(texto).not.toMatch(/Archivos JSON locales/);
  });

  it.each(Object.keys(ARCHIVOS_VIEJOS))('%s no está en el repo y está en .gitignore', (archivo) => {
    expect(fs.existsSync(new URL(`backend/${archivo}`, raiz))).toBe(false);
    expect(fs.readFileSync(new URL('.gitignore', raiz), 'utf8')).toContain(`backend/${archivo}`);
  });
});
