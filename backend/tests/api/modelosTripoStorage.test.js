// Modelos de Tripo guardados en el bucket propio "modelos-3d" (enlace permanente). Contrato:
//  1. Cuando Tripo termina, el servidor copia el GLB al bucket y SOLO entonces marca "listo", guardando la
//     URL del bucket (nunca la de Tripo, que vence) y solo si la fila sigue con la misma tarea.
//  2. Si la copia falla por algo pasajero (red, Tripo entregó HTML, Storage caído), sigue "generando" y se
//     reintenta en la próxima consulta.
//  3. Si el enlace de Tripo ya venció (403/404/410), el modelo pesa demasiado, el enlace apunta a un host no
//     permitido (SSRF) o lleva más de 10 minutos sin poder guardarse -> "error" con un mensaje claro.
//  4. Regenerar NO borra el modelo bueno: la URL vieja queda mientras se genera (y se informa como urlAnterior).
//     Recién cuando el nuevo queda guardado como "listo" se borra del bucket el archivo anterior.
// Tripo y Storage son falsos: nunca se sale a la red.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin } from '../helpers/cargarServidor.js';
import { GLB_PRUEBA as GLB, respuestaGlb } from '../helpers/modeloGlb.js';

const MODELO_TRIPO = 'https://cdn.tripo.test/modelo.glb?firma=abc';
const BUCKET = 'http://supabase.fake.local/storage/v1/object/public/modelos-3d/';

const fake = crearFakeSupabase();
let app;
let fetchFalso;
let respuestaModelo; // () => Response que entrega la "CDN" de Tripo al descargar el GLB

beforeAll(() => {
  ({ app } = cargarServidor(fake));
});

beforeEach(() => {
  fake.reiniciar();
  respuestaModelo = respuestaGlb;
  fetchFalso = vi.fn(async (url) => {
    const u = String(url);
    if (u === MODELO_TRIPO) return respuestaModelo();
    const body = u.endsWith('/task')
      ? { code: 0, data: { task_id: 'T-NUEVA' } }
      : { code: 0, data: { status: 'success', progress: 100, output: { model_url: MODELO_TRIPO } } };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => vi.unstubAllGlobals());

const admin = (metodo, url) => request(app)[metodo](url).set(authAdmin());
const updates = () => fake.consultas('producto', 'update');
const filaTarea = (extra = {}) => ({ id_producto: 5, model_3d_task_id: 'T-1', model_3d_estado: 'generando', model_3d_url: null, model_3d_prompt: 'copa', ...extra });
const consultar = async (fila = filaTarea()) => {
  fake.responder('producto', 'select', { data: fila, error: null });
  return admin('get', '/api/admin/products/5/model-3d');
};

describe('1. Tripo terminó y la copia sale bien', () => {
  it('success + copia ok -> update {model_3d_url: url del bucket, model_3d_estado:"listo"} con .eq("model_3d_task_id", tarea) y nunca guarda la URL de Tripo', async () => {
    const res = await consultar();

    expect(res.status).toBe(200);
    const subidas = fake.storage('upload');
    expect(subidas).toHaveLength(1);
    expect(subidas[0]).toMatchObject({ bucket: 'modelos-3d', ruta: 'producto-5/T-1.glb' });
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ model_3d_url: `${BUCKET}producto-5/T-1.glb`, model_3d_estado: 'listo' });
    expect(updates()[0].filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
    expect(updates()[0].filtros).toContainEqual(['eq', 'id_producto', 5]);
    expect(res.body).toMatchObject({ estado: 'listo', url: `${BUCKET}producto-5/T-1.glb`, glb_url: `${BUCKET}producto-5/T-1.glb` });
    expect(JSON.stringify(fake.llamadas.filter((l) => l.tipo === 'query'))).not.toContain('cdn.tripo.test');
    expect(JSON.stringify(res.body)).not.toContain('cdn.tripo.test');
  });

  it('si la base no guarda la URL -> 500 y no "listo" (se reintenta)', async () => {
    fake.responder('producto', 'update', { data: null, error: { code: '42501', message: 'permission denied' } });
    const res = await consultar();
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.estado).not.toBe('listo');
  });
});

describe('2. copia pasajera fallida -> sigue generando', () => {
  it.each([
    ['Tripo entrega HTML', () => new Response('<html>no</html>', { status: 200 })],
    ['Tripo responde 500', () => new Response('x', { status: 500 })],
    ['falla de red', () => { throw new TypeError('fetch failed'); }],
  ])('copia reintentar (%s) -> sigue "generando", 200 con mensaje "Guardando el modelo…"', async (_, r) => {
    respuestaModelo = r;
    const res = await consultar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'generando', message: 'Guardando el modelo…' });
    expect(updates()).toHaveLength(0);
    expect(fake.storage('upload')).toHaveLength(0);
  });

  it('Storage no acepta la subida -> sigue "generando" sin detalles internos', async () => {
    fake.responderStorage('upload', { data: null, error: { message: 'Bucket not found' } });
    const res = await consultar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'generando', message: 'Guardando el modelo…' });
    expect(JSON.stringify(res.body)).not.toMatch(/Bucket not found/);
    expect(updates()).toHaveLength(0);
  });
});

describe('3. copia imposible -> error claro', () => {
  it.each([403, 404, 410])('copia vencido (Tripo %i) -> "error" y mensaje "El modelo ya no está disponible en Tripo; regenerá el modelo."', async (status) => {
    respuestaModelo = () => new Response('<Error/>', { status });
    const res = await consultar();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'error', message: 'El modelo ya no está disponible en Tripo; regenerá el modelo.' });
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
    expect(updates()[0].filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
  });

  it('copia muy_grande -> "error" y mensaje "El modelo es demasiado grande para guardarlo."', async () => {
    respuestaModelo = () => new Response(GLB, { status: 200, headers: { 'content-length': String(60 * 1024 * 1024) } });
    const res = await consultar();
    expect(res.body).toEqual({ estado: 'error', message: 'El modelo es demasiado grande para guardarlo.' });
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
    expect(fake.storage('upload')).toHaveLength(0);
  });
});

describe('3b. enlace no permitido y tope de reintentos', () => {
  it('Tripo entrega un enlace a la red interna -> "error" sin descargarlo (url_invalida)', async () => {
    const interno = 'https://169.254.169.254/latest/meta-data';
    fetchFalso.mockImplementation(async (url) => {
      if (String(url) === interno) throw new Error('no debería pedirse');
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { status: 'success', progress: 100, output: { model_url: interno } } }) };
    });

    const res = await consultar();

    expect(res.body).toEqual({ estado: 'error', message: 'El enlace del modelo de Tripo no es válido; regenerá el modelo.' });
    expect(fetchFalso.mock.calls.some(([u]) => String(u) === interno)).toBe(false);
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
    expect(updates()[0].filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
  });

  it('la consulta lee model_3d_actualizado (para el tope de reintentos)', async () => {
    await consultar();
    expect(fake.consultas('producto', 'select')[0].columnas).toContain('model_3d_actualizado');
  });

  it('más de 10 minutos sin poder guardar -> "error" con "No se pudo guardar el modelo; regenerá el modelo."', async () => {
    respuestaModelo = () => new Response('<html>no</html>', { status: 200 });
    const hace11 = new Date(Date.now() - 11 * 60 * 1000).toISOString();

    const res = await consultar(filaTarea({ model_3d_actualizado: hace11 }));

    expect(res.body).toEqual({ estado: 'error', message: 'No se pudo guardar el modelo; regenerá el modelo.' });
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
    expect(updates()[0].filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
  });

  it('menos de 10 minutos sin poder guardar -> sigue "generando"', async () => {
    respuestaModelo = () => new Response('<html>no</html>', { status: 200 });
    const hace5 = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const res = await consultar(filaTarea({ model_3d_actualizado: hace5 }));

    expect(res.body).toMatchObject({ estado: 'generando', message: 'Guardando el modelo…' });
    expect(updates()).toHaveLength(0);
  });
});

describe('4. regenerar no pierde el modelo bueno', () => {
  const VIEJA = `${BUCKET}producto-5/T-VIEJA.glb`;
  const esReserva = (llamada) => llamada.payload?.model_3d_estado === 'generando' && 'model_3d_actualizado' in llamada.payload;
  const regenerar = () => admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa nueva' });
  function baseRegenerar() {
    fake.responder('producto', 'select', { data: { id_producto: 5, model_3d_url: VIEJA }, error: null });
    fake.responder('producto', 'update', (llamada) => (esReserva(llamada)
      ? { data: { id_producto: 5 }, error: null }
      : { data: null, error: null }));
  }
  // El update de "listo" devuelve la fila si de verdad la cambió (sigue siendo la misma tarea).
  const guardarListo = (filas = [{ id_producto: 5 }]) => fake.responder('producto', 'update', { data: filas, error: null });

  it('la reserva ya no borra model_3d_url: el modelo viejo queda mientras se genera', async () => {
    baseRegenerar();
    const res = await regenerar();
    expect(res.status).toBe(200);
    const reserva = updates().find(esReserva);
    expect(reserva).toBeTruthy();
    expect('model_3d_url' in reserva.payload).toBe(false);
  });

  it('regenerar no borra nada del bucket (ni siquiera con un modelo del bucket)', async () => {
    baseRegenerar();
    await regenerar();
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('mientras Tripo genera, la consulta devuelve la URL anterior en urlAnterior (y no como url)', async () => {
    fetchFalso.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ code: 0, data: { status: 'running', progress: 40, output: {} } }) }));
    const res = await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(res.body).toMatchObject({ estado: 'generando', urlAnterior: VIEJA });
    expect(res.body.url).toBeUndefined();
  });

  it('mientras se guarda el modelo nuevo, también devuelve urlAnterior', async () => {
    respuestaModelo = () => new Response('<html>no</html>', { status: 200 });
    const res = await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(res.body).toMatchObject({ estado: 'generando', message: 'Guardando el modelo…', urlAnterior: VIEJA });
  });

  it('un producto en "error" que conserva su modelo anterior lo informa en urlAnterior', async () => {
    const res = await consultar(filaTarea({ model_3d_estado: 'error', model_3d_url: VIEJA }));
    expect(res.body).toMatchObject({ estado: 'error', urlAnterior: VIEJA });
  });

  it('al guardar el nuevo como "listo", reemplaza la URL y DESPUÉS borra el archivo anterior', async () => {
    guardarListo();

    const res = await consultar(filaTarea({ model_3d_url: VIEJA }));

    expect(res.body).toMatchObject({ estado: 'listo', url: `${BUCKET}producto-5/T-1.glb` });
    expect(updates()[0].payload).toEqual({ model_3d_url: `${BUCKET}producto-5/T-1.glb`, model_3d_estado: 'listo' });
    const borrados = fake.storage('remove');
    expect(borrados).toHaveLength(1);
    expect(borrados[0]).toMatchObject({ bucket: 'modelos-3d', rutas: ['producto-5/T-VIEJA.glb'] });
    expect(fake.llamadas.indexOf(borrados[0])).toBeGreaterThan(fake.llamadas.indexOf(updates()[0]));
  });

  it('si el update no cambió ninguna fila (otra tarea tomó el producto), no borra nada', async () => {
    guardarListo([]);
    await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('si guardar en la base falla, no borra el anterior', async () => {
    fake.responder('producto', 'update', { data: null, error: { code: '42501', message: 'permission denied' } });
    const res = await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(res.status).toBe(500);
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it.each([
    ['Tripo venció el enlace', () => new Response('<Error/>', { status: 404 })],
    ['falla pasajera', () => new Response('x', { status: 500 })],
  ])('si la copia falla (%s), el producto conserva su modelo anterior', async (_, r) => {
    respuestaModelo = r;
    await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(updates().some((u) => 'model_3d_url' in u.payload)).toBe(false);
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it.each([
    ['es una URL de Tripo', MODELO_TRIPO],
    ['es de otro producto', `${BUCKET}producto-7/T-VIEJA.glb`],
    ['no había modelo', null],
  ])('no borra nada si el modelo anterior %s', async (_, urlVieja) => {
    guardarListo();
    await consultar(filaTarea({ model_3d_url: urlVieja }));
    expect(fake.storage('remove')).toHaveLength(0);
  });

  it('si borrar el anterior falla, igual responde "listo"', async () => {
    guardarListo();
    fake.responderStorage('remove', { data: null, error: { message: 'Storage caído' } });
    const res = await consultar(filaTarea({ model_3d_url: VIEJA }));
    expect(res.body.estado).toBe('listo');
  });
});
