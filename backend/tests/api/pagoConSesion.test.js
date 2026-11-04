// POST /api/payments/process exige sesión. Contrato:
//  - Sin token, con token inválido, vencido o sin id_usuario válido -> 401 { ok:false }, sin tocar la base.
//  - La venta queda SIEMPRE a nombre del usuario del token: userId del cuerpo se ignora.
//  - El recibo va al correo del usuario del token (el que está en la base).
//  - El límite de intentos va DESPUÉS de la sesión (igual que create-admin): un visitante sin sesión
//    no gasta los intentos de los clientes que comparten su IP.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba, JWT_SECRET_PRUEBA } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
const correos = [];
let app;

const VENTA_OK = {
  id_venta: 77,
  total: 25000,
  estado: 'Pagado',
  items: [{ id_producto: 5, nombre: 'Helado de fresa', cantidad: 2, precio_unitario: 12500, subtotal: 25000 }],
};
const CUERPO = { method: 'NEQUI', bank: 'Nequi', items: [{ id: 5, quantity: 2 }], amount: 1 };
const sesion = (datos) => ({ Authorization: `Bearer ${tokenPrueba({ email: 'x@example.com', rol: 'cliente', ...datos })}` });
const pagar = (cabeceras = {}, extra = {}) =>
  request(app).post('/api/payments/process').set(cabeceras).send({ ...CUERPO, ...extra });
const rpcVenta = () => fake.rpcs('registrar_venta');

// La base solo conoce a dos clientes: así se ve a quién se le manda el recibo.
const USUARIOS = {
  7: { nombre: 'Dueña del token', email: 'token@example.com' },
  3: { nombre: 'Víctima', email: 'victima@example.com' },
};
const idConsultado = (llamada) => llamada.filtros.find(([f, col]) => f === 'eq' && col === 'id_usuario')?.[2];

beforeAll(() => {
  ({ app } = cargarServidor(fake, { correo: (m) => correos.push(m) }));
});

beforeEach(() => {
  fake.reiniciar();
  correos.length = 0;
  fake.responderRpc('registrar_venta', { data: VENTA_OK, error: null });
  fake.responder('usuario', 'select', (llamada) => ({ data: USUARIOS[idConsultado(llamada)] ?? null, error: null }));
  vi.spyOn(Math, 'random').mockReturnValue(0.1); // siempre aprobado
  const original = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...a) => original(fn, ms >= 1000 ? 0 : ms, ...a));
});

afterEach(() => {
  vi.mocked(Math.random).mockRestore();
  vi.mocked(globalThis.setTimeout).mockRestore();
});

describe('POST /api/payments/process - sesión obligatoria', () => {
  it('sin token -> 401 en español y sin registrar venta', async () => {
    const res = await pagar();

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/sesión/i);
    expect(rpcVenta()).toHaveLength(0);
  });

  it('con userId en el cuerpo pero sin token -> 401 (el cuerpo no da identidad)', async () => {
    const res = await pagar({}, { userId: 3 });

    expect(res.status).toBe(401);
    expect(rpcVenta()).toHaveLength(0);
  });

  it('token inválido -> 401 y sin registrar venta', async () => {
    const res = await pagar({ Authorization: 'Bearer esto-no-es-un-token' });

    expect(res.status).toBe(401);
    expect(rpcVenta()).toHaveLength(0);
  });

  it('token firmado con otro secreto -> 401', async () => {
    const falso = jwt.sign({ id_usuario: 7, rol: 'cliente' }, 'otro-secreto-que-no-es-el-del-servidor-1234', { algorithm: 'HS256' });

    const res = await pagar({ Authorization: `Bearer ${falso}` });

    expect(res.status).toBe(401);
    expect(rpcVenta()).toHaveLength(0);
  });

  it('token vencido -> 401', async () => {
    const vencido = jwt.sign({ id_usuario: 7, rol: 'cliente' }, JWT_SECRET_PRUEBA, { algorithm: 'HS256', expiresIn: -10 });

    const res = await pagar({ Authorization: `Bearer ${vencido}` });

    expect(res.status).toBe(401);
    expect(rpcVenta()).toHaveLength(0);
  });

  it.each([
    ['sin id_usuario', {}],
    ['con id_usuario de texto', { id_usuario: '7 or 1=1' }],
    ['con id_usuario negativo', { id_usuario: -7 }],
  ])('token válido %s -> 401 (una venta nunca queda sin dueño)', async (_, datos) => {
    const res = await pagar(sesion(datos));

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(rpcVenta()).toHaveLength(0);
  });
});

describe('POST /api/payments/process - el usuario sale del token', () => {
  it('userId ajeno en el cuerpo: la venta queda a nombre del token', async () => {
    const res = await pagar(sesion({ id_usuario: 7 }), { userId: 3 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(rpcVenta()).toHaveLength(1);
    expect(rpcVenta()[0].args.p_id_usuario).toBe(7);
  });

  it('userId ajeno en el cuerpo: el recibo va al correo del usuario del token', async () => {
    await pagar(sesion({ id_usuario: 7 }), { userId: 3 });

    await vi.waitFor(() => expect(correos).toHaveLength(1));
    expect(correos[0].to).toBe('token@example.com');
    expect(fake.consultas('usuario', 'select').map(idConsultado)).toEqual([7]);
  });

  it('el pago rechazado también queda a nombre del token, sin recibo', async () => {
    const res = await pagar(sesion({ id_usuario: 7 }), { userId: 3, forceDecline: true });

    expect(res.body.ok).toBe(false);
    expect(rpcVenta()[0].args).toMatchObject({ p_id_usuario: 7, p_estado: 'Fallido' });
    expect(correos).toHaveLength(0);
  });
});
