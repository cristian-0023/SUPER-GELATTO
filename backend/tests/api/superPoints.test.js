// Super Points en el servidor (diseño 2026-11-04):
//  - POST /api/payments/process acepta puntosUsar (entero 0..1000000; ausente = 0; null = inválido) y
//    lo pasa a registrar_venta junto al usuario del TOKEN. Responde puntos:{usados,descuento,ganados,saldo}.
//  - GET /api/me/points (con sesión): saldo, nivel e historial paginado (tope 50) del usuario del token.
//  - GET /api/points/rules (público, caché 1 h): reglas desde la base (super_points_reglas).
//  - PUT /api/admin/sales/:id/status usa cambiar_estado_venta (estado + puntos en una transacción).
//  - Recibo, correo de estado y panel muestran el descuento.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba, authAdmin } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
const correos = [];
let app;
let esperas;

const VENTA_CON_PUNTOS = {
  id_venta: 88,
  total: 18000,
  subtotal: 20000,
  estado: 'Pagado',
  items: [{ id_producto: 5, nombre: 'Helado de fresa', cantidad: 8, precio_unitario: 2500, subtotal: 20000 }],
  puntos_usados: 400,
  descuento: 2000,
  puntos_ganados: 180,
  saldo: 280,
};

const RESUMEN = {
  saldo: 280, ganados: 680, nivel: 'Pro', pct_max: 15, valor_saldo: 1400,
  puntos_para_siguiente: 321, siguiente_nivel: 'Master',
};

const REGLAS = {
  pesos_por_punto: 100,
  valor_punto: 5,
  niveles: [
    { nombre: 'Lover', min: 0, max: 100, pct: 5 },
    { nombre: 'Fan', min: 101, max: 500, pct: 10 },
    { nombre: 'Pro', min: 501, max: 1000, pct: 15 },
    { nombre: 'Master', min: 1001, max: null, pct: 20 },
  ],
};

const sesion = (id = 3) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: id, email: `u${id}@example.com`, rol: 'cliente' })}` });
const cuerpo = (extra = {}) => ({
  method: 'NEQUI',
  bank: 'Nequi',
  items: [{ id: 5, id_producto: 5, name: 'Helado de fresa', quantity: 8, price: 1 }],
  ...extra,
});
const pagar = (extra) => request(app).post('/api/payments/process').set(sesion()).send(cuerpo(extra));
const pasarelaLlamada = () => esperas.mock.calls.some(([, ms]) => ms >= 1000);

beforeAll(() => {
  ({ app } = cargarServidor(fake, { correo: (m) => correos.push(m) }));
});

beforeEach(() => {
  fake.reiniciar();
  correos.length = 0;
  fake.responderRpc('registrar_venta', { data: VENTA_CON_PUNTOS, error: null });
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

describe('POST /api/payments/process con puntos', () => {
  it.each([
    ['negativo', -1],
    ['decimal', 1.5],
    ['texto', '10'],
    ['null', null],
    ['mayor a 1000000', 1000001],
    ['booleano', true],
    ['objeto', { puntos: 1 }],
  ])('puntosUsar %s -> 400 sin venta y sin pasar por la pasarela', async (_, puntosUsar) => {
    const res = await pagar({ puntosUsar });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/puntos/i);
    expect(fake.rpcs()).toHaveLength(0);
    expect(pasarelaLlamada()).toBe(false);
  });

  it('sin puntosUsar canjea 0', async () => {
    await pagar();
    expect(fake.rpcs('registrar_venta')[0].args.p_puntos_usar).toBe(0);
  });

  it('manda los puntos a registrar_venta con el usuario del token (no el del cuerpo)', async () => {
    const res = await pagar({ puntosUsar: 400, userId: 99, id_usuario: 99 });

    expect(res.status).toBe(200);
    expect(fake.rpcs('registrar_venta')[0].args).toEqual({
      p_id_usuario: 3,
      p_items: [{ id_producto: 5, cantidad: 8 }],
      p_estado: 'Pagado',
      p_puntos_usar: 400,
    });
  });

  it('responde los puntos de la compra y el total ya descontado', async () => {
    const res = await pagar({ puntosUsar: 400 });

    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(18000);
    expect(res.body.subtotal).toBe(20000);
    expect(res.body.transaction.amount).toBe(18000);
    expect(res.body.puntos).toEqual({ usados: 400, descuento: 2000, ganados: 180, saldo: 280 });
  });

  it.each([
    ['PUNTOS_INSUFICIENTES', /suficientes/i],
    ['PUNTOS_EXCEDEN_TOPE', /nivel/i],
    ['PUNTOS_INVALIDOS', /puntos/i],
  ])('%s -> 400 con mensaje en español, sin el código interno', async (codigo, patron) => {
    fake.responderRpc('registrar_venta', { data: null, error: { code: 'P0001', message: codigo, details: 'saldo=3' } });

    const res = await pagar({ puntosUsar: 50 });

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(patron);
    expect(JSON.stringify(res.body)).not.toContain(codigo);
    expect(JSON.stringify(res.body)).not.toContain('saldo=3');
  });

  it('el correo de recibo muestra el subtotal y el descuento con Super Points', async () => {
    fake.responder('usuario', 'select', { data: { nombre: 'Ana', email: 'ana@ejemplo.test' }, error: null });

    await pagar({ puntosUsar: 400 });

    expect(correos).toHaveLength(1);
    expect(correos[0].html).toMatch(/Super Points/);
    expect(correos[0].html).toContain('2.000');
    expect(correos[0].html).toContain('20.000');
    expect(correos[0].html).toContain('18.000');
  });

  it('sin descuento, el recibo no menciona descuento', async () => {
    fake.responderRpc('registrar_venta', {
      data: { ...VENTA_CON_PUNTOS, total: 20000, puntos_usados: 0, descuento: 0, puntos_ganados: 200 },
      error: null,
    });
    fake.responder('usuario', 'select', { data: { nombre: 'Ana', email: 'ana@ejemplo.test' }, error: null });

    await pagar();

    expect(correos).toHaveLength(1);
    expect(correos[0].html).not.toMatch(/Descuento/i);
  });
});

describe('GET /api/me/points', () => {
  // El fake usa la PRIMERA respuesta registrada para una tabla: las pruebas que necesitan otro
  // historial lo cambian con historial(...) antes de pedir.
  const historial = (respuesta) => {
    fake._respuestasQuery = fake._respuestasQuery.filter((r) => r.tabla !== 'super_points');
    fake.responder('super_points', 'select', respuesta);
  };

  beforeEach(() => {
    fake.responderRpc('super_points_resumen', { data: RESUMEN, error: null });
    historial({
      data: [
        { tipo: 'ganado', puntos_generados: 180, fecha_generacion: '2026-11-10T10:00:00Z', id_venta: 88 },
        { tipo: 'canjeado', puntos_generados: -400, fecha_generacion: '2026-11-10T10:00:00Z', id_venta: 88 },
      ],
      error: null,
    });
  });

  const misPuntos = (query = '', headers = sesion()) => request(app).get(`/api/me/points${query}`).set(headers);

  it('sin sesión -> 401 y no consulta la base', async () => {
    const res = await request(app).get('/api/me/points');
    expect(res.status).toBe(401);
    expect(fake.llamadas).toHaveLength(0);
  });

  it('devuelve el saldo, el nivel y el historial del usuario del token', async () => {
    const res = await misPuntos();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      saldo: 280,
      ganados: 680,
      nivel: 'Pro',
      pctMax: 15,
      valorSaldo: 1400,
      puntosParaSiguiente: 321,
      siguienteNivel: 'Master',
      movimientos: [
        { tipo: 'ganado', puntos: 180, fecha: '2026-11-10T10:00:00Z', idVenta: 88 },
        { tipo: 'canjeado', puntos: -400, fecha: '2026-11-10T10:00:00Z', idVenta: 88 },
      ],
      limit: 20,
      offset: 0,
      hayMas: false,
    });
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  it('no se puede pedir los puntos de otro usuario', async () => {
    await misPuntos('?id_usuario=99&userId=99');

    expect(fake.rpcs('super_points_resumen')[0].args).toEqual({ p_id_usuario: 3 });
    const consulta = fake.consultas('super_points', 'select')[0];
    expect(consulta.filtros).toContainEqual(['eq', 'id_usuario', 3]);
    expect(consulta.columnas).toBe('tipo, puntos_generados, fecha_generacion, id_venta');
  });

  it('pagina el historial (más recientes primero) y avisa si hay más', async () => {
    historial({
      data: Array.from({ length: 6 }, (_, i) => ({ tipo: 'ganado', puntos_generados: i + 1, fecha_generacion: 'f', id_venta: i })),
      error: null,
    });

    const res = await misPuntos('?limit=5&offset=10');

    const consulta = fake.consultas('super_points', 'select')[0];
    expect(consulta.filtros).toContainEqual(['order', 'fecha_generacion', { ascending: false }]);
    expect(consulta.filtros).toContainEqual(['order', 'id_points', { ascending: false }]);
    expect(consulta.filtros).toContainEqual(['range', 10, 15]); // pide uno de más para saber si hay más
    expect(res.body.movimientos).toHaveLength(5);
    expect(res.body).toMatchObject({ limit: 5, offset: 10, hayMas: true });
  });

  it('limit mayor a 50 se recorta a 50', async () => {
    const res = await misPuntos('?limit=500');
    expect(res.body.limit).toBe(50);
    expect(fake.consultas('super_points', 'select')[0].filtros).toContainEqual(['range', 0, 50]);
  });

  it.each(['?limit=abc', '?limit=0', '?limit=1.5', '?offset=-1', '?offset=x', '?offset=100001'])(
    'paginación inválida %s -> 400 sin consultar',
    async (query) => {
      const res = await misPuntos(query);
      expect(res.status).toBe(400);
      expect(fake.llamadas).toHaveLength(0);
    },
  );

  it('si falla el resumen -> 500 sin detalles internos', async () => {
    fake.responderRpc('super_points_resumen', { data: null, error: { code: 'XX000', message: 'relation secreta' } });

    const res = await misPuntos();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('secreta');
  });

  it('si falla el historial -> 500 (no un saldo sin historial)', async () => {
    historial({ data: null, error: { message: 'fetch failed' } });

    const res = await misPuntos();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });
});

describe('GET /api/points/rules', () => {
  it('es público, sale de la base y se puede guardar en caché 1 hora', async () => {
    fake.responderRpc('super_points_reglas', { data: REGLAS, error: null });

    const res = await request(app).get('/api/points/rules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, pesosPorPunto: 100, valorPunto: 5, niveles: REGLAS.niveles });
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(fake.rpcs('super_points_reglas')).toHaveLength(1);
  });

  it('si la base falla -> 500 y sin caché', async () => {
    fake.responderRpc('super_points_reglas', { data: null, error: { message: 'down' } });

    const res = await request(app).get('/api/points/rules');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.headers['cache-control'] || '').not.toMatch(/max-age=3600/);
  });
});

describe('PUT /api/admin/sales/:id/status con puntos', () => {
  const cambiar = (id, estado) => request(app).put(`/api/admin/sales/${encodeURIComponent(id)}/status`).set(authAdmin()).send({ estado });
  const ID = '987654321'; // no existe en fallback_sales.json

  it('usa cambiar_estado_venta (estado y puntos juntos), sin update directo', async () => {
    fake.responderRpc('cambiar_estado_venta', {
      data: { id_venta: 987654321, id_usuario: null, total: 5000, estado: 'Cancelado', estado_anterior: 'Pagado', puntos_usados: 0, descuento_puntos: 0 },
      error: null,
    });

    const res = await cambiar(ID, 'Cancelado');

    expect(res.status).toBe(200);
    expect(fake.rpcs('cambiar_estado_venta')[0].args).toEqual({ p_id_venta: 987654321, p_estado: 'Cancelado' });
    expect(fake.consultas('venta', 'update')).toHaveLength(0);
  });

  it('si la función falla -> 500, sin éxito falso y sin correo', async () => {
    fake.responderRpc('cambiar_estado_venta', { data: null, error: { code: '57014', message: 'canceling statement' } });

    const res = await cambiar(ID, 'Cancelado');

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    expect(correos).toHaveLength(0);
  });

  it('venta que no existe -> 404', async () => {
    fake.responderRpc('cambiar_estado_venta', { data: null, error: { code: 'P0001', message: 'VENTA_NO_EXISTE' } });

    const res = await cambiar(ID, 'Pagado');

    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
  });

  it.each(['<b>77</b>', 'abc', '1.5', '-3', '0', '99999999999999999999'])('id %j -> 400 sin tocar la base', async (id) => {
    const res = await cambiar(id, 'Pagado');

    expect(res.status).toBe(400);
    expect(fake.llamadas).toHaveLength(0);
    expect(correos).toHaveLength(0);
  });

  it('el correo de estado muestra el descuento con Super Points', async () => {
    fake.responderRpc('cambiar_estado_venta', {
      data: { id_venta: 987654321, id_usuario: 7, total: 18000, estado: 'Enviado', estado_anterior: 'Pagado', puntos_usados: 400, descuento_puntos: 2000 },
      error: null,
    });
    fake.responder('usuario', 'select', { data: { email: 'cliente@ejemplo.test', nombre: 'Ana', apellido: 'Pérez' }, error: null });

    const res = await cambiar(ID, 'Enviado');

    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(correos).toHaveLength(1));
    expect(correos[0].html).toMatch(/Super Points/);
    expect(correos[0].html).toContain('2.000');
    expect(correos[0].html).toContain('18.000');
  });
});

describe('panel de admin', () => {
  it('las ventas traen los puntos usados y el descuento', async () => {
    fake.responder('venta', 'select', {
      data: [{ id_venta: 987654321, id_usuario: null, total: 18000, fecha: '2026-11-10T10:00:00Z', estado: 'Pagado', puntos_usados: 400, descuento_puntos: 2000 }],
      error: null,
    });

    const res = await request(app).get('/api/admin/dashboard').set(authAdmin());

    expect(res.status).toBe(200);
    expect(fake.consultas('venta', 'select')[0].columnas).toMatch(/puntos_usados/);
    expect(fake.consultas('venta', 'select')[0].columnas).toMatch(/descuento_puntos/);
    const venta = res.body.sales.find((s) => String(s.id_venta) === '987654321');
    expect(venta).toMatchObject({ puntos_usados: 400, descuento_puntos: 2000, total: 18000 });
  });
});
