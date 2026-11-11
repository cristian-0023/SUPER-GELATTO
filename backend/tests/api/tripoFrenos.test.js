// Frenos y validaciones de las rutas que usan Tripo (cada tarea cuesta dinero). Contrato:
//  1. El prompt al crear producto se valida ANTES de insertar (texto, sin espacios sobrantes, ≤ 1000).
//  2. Una generación por producto a la vez: se "reserva" con un update condicional atómico (dos clics a la
//     vez -> solo uno llama a Tripo; el otro recibe 409). Además, límite por admin (≈5 por hora).
//  3. Los updates de "listo" y "error" solo tocan la fila si sigue siendo la misma tarea (carrera con regenerar).
//  4. Estados terminales de Tripo distintos de success -> 'error'; success sin URL -> 'error'.
//  5. Solo se guardan URLs https de largo razonable e ids de tarea con formato seguro.
//  6. Los errores de Tripo no se muestran al cliente (texto fijo en español; el detalle va al log).
// Tripo siempre es falso aquí: nunca se llama al real.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, authAdmin, JWT_SECRET_PRUEBA } from '../helpers/cargarServidor.js';

const MODELO = 'https://cdn.tripo.test/modelo.glb';
const ERROR_BASE = { data: null, error: { code: '42501', message: 'permission denied for table producto' } };

const fake = crearFakeSupabase();
let app;
let fetchFalso;

// Respuestas falsas de Tripo: crear tarea y consultar tarea.
let respuestaCrear;
let respuestaTarea;

beforeAll(() => {
  ({ app } = cargarServidor(fake));
});

beforeEach(() => {
  fake.reiniciar();
  respuestaCrear = { ok: true, body: { code: 0, data: { task_id: 'T-NUEVA' } } };
  respuestaTarea = { ok: true, body: { code: 0, data: { status: 'success', progress: 100, output: { model: MODELO } } } };
  fetchFalso = vi.fn(async (url) => {
    const r = String(url).endsWith('/task') ? respuestaCrear : respuestaTarea;
    return { ok: r.ok, status: r.ok ? 200 : 500, json: async () => r.body };
  });
  vi.stubGlobal('fetch', fetchFalso);
});
afterEach(() => vi.unstubAllGlobals());

const admin = (metodo, url) => request(app)[metodo](url).set(authAdmin());
const llamadasATripo = () => fetchFalso.mock.calls.filter(([url]) => String(url).includes('tripo3d'));
const crearTareaEnTripo = () => llamadasATripo().filter(([url]) => String(url).endsWith('/task'));
const updates = () => fake.consultas('producto', 'update');
const esReserva = (llamada) => llamada.payload?.model_3d_estado === 'generando' && 'model_3d_actualizado' in llamada.payload;

// La reserva (update condicional) devuelve la fila si ganó; null si el producto ya estaba generando.
function baseConReserva({ gana = true, guardar = { data: null, error: null } } = {}) {
  fake.responder('producto', 'update', (llamada) => {
    if (esReserva(llamada)) return { data: gana ? { id_producto: Number(llamada.filtros.find((f) => f[1] === 'id_producto')?.[2]) } : null, error: null };
    return guardar;
  });
}
const filaTarea = (extra = {}) => ({ id_producto: 5, model_3d_task_id: 'T-1', model_3d_estado: 'generando', model_3d_url: null, model_3d_prompt: 'copa', ...extra });

describe('1. prompt 3D al crear producto', () => {
  it.each([
    ['no es texto', 123],
    ['es demasiado largo', 'a'.repeat(1001)],
  ])('si el prompt %s -> 400 y no se crea el producto ni se llama a Tripo', async (_, prompt3d) => {
    const res = await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d });

    expect(res.status).toBe(400);
    expect(fake.consultas('producto', 'insert')).toHaveLength(0);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('a Tripo y a la base va el prompt sin espacios sobrantes', async () => {
    baseConReserva();

    const res = await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d: '   cono de helado   ' });

    expect(res.status).toBe(201);
    expect(JSON.parse(crearTareaEnTripo()[0][1].body).prompt).toBe('cono de helado');
    expect(updates().find(esReserva).payload.model_3d_prompt).toBe('cono de helado');
    expect(res.body.model).toEqual({ taskId: 'T-NUEVA', estado: 'generando' });
  });
});

describe('2. una generación por producto a la vez', () => {
  beforeEach(() => fake.responder('producto', 'select', { data: { id_producto: 5 }, error: null }));

  it('regenerar reserva con un update condicional sobre el estado', async () => {
    baseConReserva();

    await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    const reserva = updates().find(esReserva);
    expect(reserva).toBeTruthy();
    expect(reserva.filtros).toContainEqual(['eq', 'id_producto', 5]);
    const condicion = reserva.filtros.find(([op]) => op === 'or')?.[1] || '';
    expect(condicion).toContain('model_3d_estado.is.null');
    expect(condicion).toContain('model_3d_estado.neq.generando');
    expect(condicion).toMatch(/model_3d_actualizado\.lt\./);
  });

  it('si ya está generando (la reserva no devuelve fila) -> 409 sin llamar a Tripo', async () => {
    baseConReserva({ gana: false });

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(409);
    expect(res.body.ok).toBe(false);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('con la reserva ganada: llama a Tripo una vez y guarda el id de tarea solo si la reserva sigue vigente', async () => {
    baseConReserva();

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, taskId: 'T-NUEVA', productId: 5 });
    expect(crearTareaEnTripo()).toHaveLength(1);
    const guardar = updates().find((u) => u.payload.model_3d_task_id === 'T-NUEVA');
    expect(guardar.filtros).toContainEqual(['eq', 'id_producto', 5]);
    expect(guardar.filtros).toContainEqual(['eq', 'model_3d_estado', 'generando']);
    expect(guardar.filtros).toContainEqual(['is', 'model_3d_task_id', null]);
  });

  it('si la reserva falla en la base -> 500 sin llamar a Tripo', async () => {
    fake.responder('producto', 'update', ERROR_BASE);

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(500);
    expect(llamadasATripo()).toHaveLength(0);
  });

  it('si no se puede guardar el id de tarea -> 500', async () => {
    baseConReserva({ guardar: ERROR_BASE });

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('crear producto con prompt también reserva antes de llamar a Tripo', async () => {
    baseConReserva({ gana: false });

    const res = await admin('post', '/api/admin/products').send({ name: 'Con 3D', price: 4000, prompt3d: 'cono' });

    expect(res.status).toBe(201);
    expect(res.body.model).toBeNull();
    expect(llamadasATripo()).toHaveLength(0);
  });
});

describe('6. errores de Tripo: texto fijo para el cliente', () => {
  it('si Tripo rechaza la tarea -> 500 en español sin el detalle, y el producto queda en "error" (no bloqueado)', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5 }, error: null });
    baseConReserva();
    respuestaCrear = { ok: false, body: { code: 2010, message: 'detalle interno de la cuenta: saldo 0' } };

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/modelo 3D/i);
    expect(JSON.stringify(res.body)).not.toContain('saldo');
    const liberar = updates().find((u) => u.payload.model_3d_estado === 'error');
    expect(liberar).toBeTruthy();
    expect(liberar.filtros).toContainEqual(['is', 'model_3d_task_id', null]);
  });
});

describe('5. id de tarea con formato seguro', () => {
  it('si Tripo devuelve un id raro, no se guarda: el producto queda en "error" y responde 500', async () => {
    fake.responder('producto', 'select', { data: { id_producto: 5 }, error: null });
    baseConReserva();
    respuestaCrear = { ok: true, body: { code: 0, data: { task_id: '../../otra-ruta?x=1' } } };

    const res = await admin('post', '/api/admin/products/5/regenerate-3d').send({ prompt: 'copa' });

    expect(res.status).toBe(500);
    expect(updates().some((u) => u.payload.model_3d_task_id === '../../otra-ruta?x=1')).toBe(false);
    expect(updates().some((u) => u.payload.model_3d_estado === 'error')).toBe(true);
  });

  it('al consultar, el id de tarea va codificado en la URL de Tripo', async () => {
    fake.responder('producto', 'select', { data: filaTarea({ model_3d_task_id: 'T 1/x' }), error: null });

    await admin('get', '/api/admin/products/5/model-3d');

    expect(llamadasATripo()[0][0]).toContain('/task/T%201%2Fx');
  });
});

describe('3, 4 y 5. consultar una tarea', () => {
  const consultar = async (fila = filaTarea()) => {
    fake.responder('producto', 'select', { data: fila, error: null });
    return admin('get', '/api/admin/products/5/model-3d');
  };

  it('3. "listo" solo se guarda si la fila sigue con la misma tarea', async () => {
    await consultar();
    const up = updates()[0];
    expect(up.payload).toEqual({ model_3d_url: MODELO, model_3d_estado: 'listo' });
    expect(up.filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
  });

  it('3. "error" solo se guarda si la fila sigue con la misma tarea', async () => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status: 'failed', progress: 0, output: {} } } };
    await consultar();
    const up = updates()[0];
    expect(up.payload).toEqual({ model_3d_estado: 'error' });
    expect(up.filtros).toContainEqual(['eq', 'model_3d_task_id', 'T-1']);
  });

  it.each(['cancelled', 'banned', 'expired', 'unknown'])('4. estado terminal "%s" -> error', async (status) => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status, progress: 0, output: {} } } };
    const res = await consultar();
    expect(res.body.estado).toBe('error');
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
  });

  it.each(['queued', 'running'])('4. "%s" sigue generando sin tocar la base', async (status) => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status, progress: 40, output: {} } } };
    const res = await consultar();
    expect(res.body.estado).toBe('generando');
    expect(updates()).toHaveLength(0);
  });

  it('4. si Tripo no responde (falla de red) sigue generando: no es un estado terminal', async () => {
    fetchFalso.mockImplementation(async () => { throw new Error('sin red'); });
    const res = await consultar();
    expect(res.body.estado).toBe('generando');
    expect(updates()).toHaveLength(0);
  });

  it('4. success sin URL reconocida -> error (no queda "generando" para siempre)', async () => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status: 'success', progress: 100, output: { otra_cosa: 'x' } } } };
    const res = await consultar();
    expect(res.body.estado).toBe('error');
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
  });

  it('4. reconoce output.model_url (nombre actual en la documentación de Tripo)', async () => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status: 'success', progress: 100, output: { model_url: MODELO } } } };
    const res = await consultar();
    expect(res.body).toMatchObject({ estado: 'listo', url: MODELO });
  });

  it.each([
    ['no es https', 'http://cdn.tripo.test/modelo.glb'],
    ['es javascript:', 'javascript:alert(1)'],
    ['es demasiado larga', `https://cdn.tripo.test/${'a'.repeat(2049)}`],
  ])('5. si la URL %s -> error y no se guarda', async (_, url) => {
    respuestaTarea = { ok: true, body: { code: 0, data: { status: 'success', progress: 100, output: { model: url } } } };
    const res = await consultar();
    expect(res.body.estado).toBe('error');
    expect(updates()).toHaveLength(1);
    expect(updates()[0].payload).toEqual({ model_3d_estado: 'error' });
  });
});

describe('2. límite de generaciones por admin', () => {
  const fakeLimite = crearFakeSupabase();
  let appLimite;
  const tokenDe = (id) => ({ Authorization: `Bearer ${jwt.sign({ id_usuario: id, rol: 'admin' }, JWT_SECRET_PRUEBA, { algorithm: 'HS256', expiresIn: '1h' })}` });

  beforeAll(() => {
    ({ app: appLimite } = cargarServidor(fakeLimite, { limiteTripo: 2 }));
  });
  beforeEach(() => {
    fakeLimite.reiniciar();
    fakeLimite.responder('producto', 'select', { data: { id_producto: 5 }, error: null });
    fakeLimite.responder('producto', 'update', (llamada) => ({ data: esReserva(llamada) ? { id_producto: 5 } : null, error: null }));
  });

  it('el mismo admin: a partir del tope -> 429; otro admin sigue pudiendo', async () => {
    const regenerar = (id) => request(appLimite).post('/api/admin/products/5/regenerate-3d').set(tokenDe(id)).send({ prompt: 'copa' });

    expect((await regenerar(71)).status).toBe(200);
    expect((await regenerar(71)).status).toBe(200);
    const tercera = await regenerar(71);
    expect(tercera.status).toBe(429);
    expect(tercera.body.ok).toBe(false);
    expect((await regenerar(72)).status).toBe(200);
  });

  it('crear productos sin prompt no gasta el límite de generaciones', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await request(appLimite).post('/api/admin/products').set(tokenDe(73)).send({ name: `Simple ${i}`, price: 3000 });
      expect(res.status).toBe(201);
    }
  });
});
