// 2. Sin SUPABASE_URL el servidor usa su base simulada (mockDb). El pago debe seguir funcionando
// con la misma forma de respuesta que la función real registrar_venta, y total calculado en el servidor.
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

let app;
beforeAll(() => {
  // Correo falso: el pago aprobado no debe crear una cuenta de Ethereal ni salir a la red.
  ({ app } = cargarServidor(null, { sinSupabase: true, correo: () => {} }));
});
beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.1); // siempre aprobado
  const original = globalThis.setTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...a) => original(fn, ms >= 1000 ? 0 : ms, ...a));
});
afterEach(() => {
  vi.mocked(Math.random).mockRestore();
  vi.mocked(globalThis.setTimeout).mockRestore();
});

const sesion = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 1, email: 'u1@example.com', rol: 'cliente' })}` });
const pagarSinSesion = (items, extra = {}) =>
  request(app).post('/api/payments/process').send({ method: 'NEQUI', bank: 'Nequi', items, amount: 1, ...extra });
const pagar = (items, extra = {}) =>
  request(app).post('/api/payments/process').set(sesion()).send({ method: 'NEQUI', bank: 'Nequi', items, amount: 1, ...extra });

describe('modo simulado (sin Supabase): sesión', () => {
  it('pagar también exige sesión: sin base real no hay puerta trasera', async () => {
    const res = await pagarSinSesion([{ id: 1, quantity: 1 }], { userId: 1 });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });
});

describe('modo simulado (sin Supabase): registrar_venta', () => {
  it('calcula el total con el catálogo local e ignora el precio del cliente', async () => {
    const res = await pagar([
      { id: 1, quantity: 2, price: 1 }, // Fresa Salvaje 12500 x 2
      { id: 2, quantity: 1, price: 1 }, // Cioccolato Nero 13000
    ]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(38000);
    expect(res.body.id_venta).toBeTruthy();
    expect(res.body.transaction.amount).toBe(38000);
    expect(res.body.transaction.items).toHaveLength(2);
    expect(res.body.transaction.items[0]).toMatchObject({ name: 'Fresa Salvaje', quantity: 2, price: 12500, subtotal: 25000 });
  });

  it('producto que no existe -> 400, no aprobado', async () => {
    const res = await pagar([{ id: 987654, quantity: 1 }]);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('pago rechazado por la pasarela -> ok:false', async () => {
    const res = await pagar([{ id: 1, quantity: 1 }], { forceDecline: true });

    expect(res.body.ok).toBe(false);
    expect(res.body.transaction.status).toBe('DECLINED');
  });
});

// Super Points en modo simulado: la página debe poder probarse sin base real (sin datos reales).
describe('modo simulado (sin Supabase): Super Points', () => {
  const sesionDe = (id) => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: id, email: `u${id}@example.com`, rol: 'cliente' })}` });
  const authAdminSim = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 1, rol: 'admin' })}` });

  it('las reglas responden con niveles', async () => {
    const res = await request(app).get('/api/points/rules');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.niveles.length).toBeGreaterThan(0);
    expect(res.body.pesosPorPunto).toBeGreaterThan(0);
    expect(res.body.valorPunto).toBeGreaterThan(0);
  });

  it('una compra suma puntos al saldo del cliente y se ven en /api/me/points', async () => {
    const res = await request(app).post('/api/payments/process').set(sesionDe(55))
      .send({ method: 'NEQUI', bank: 'Nequi', items: [{ id: 1, quantity: 2 }] }); // 25000 -> 250 puntos
    expect(res.body.ok).toBe(true);
    expect(res.body.puntos).toMatchObject({ usados: 0, ganados: 250, saldo: 250 });

    const mios = await request(app).get('/api/me/points').set(sesionDe(55));
    expect(mios.status).toBe(200);
    expect(mios.body).toMatchObject({ ok: true, saldo: 250, ganados: 250, nivel: 'Fan' });
    expect(mios.body.movimientos[0]).toMatchObject({ tipo: 'ganado', puntos: 250 });
  });

  it('el nivel sale del saldo actual: canjear puntos puede bajarlo (regla del 2026-11-19)', async () => {
    const compra = await request(app).post('/api/payments/process').set(sesionDe(58))
      .send({ method: 'NEQUI', bank: 'Nequi', items: [{ id: 1, quantity: 4 }] }); // 50000 -> 500 puntos (Fan)
    expect(compra.body.puntos).toMatchObject({ ganados: 500, saldo: 500 });

    // 12500 con 250 puntos (tope Fan = 250): paga 11250 y gana 112 -> saldo 362, ganados 612
    const canje = await request(app).post('/api/payments/process').set(sesionDe(58))
      .send({ method: 'NEQUI', bank: 'Nequi', items: [{ id: 1, quantity: 1 }], puntosUsar: 250 });
    expect(canje.body.ok).toBe(true);
    expect(canje.body.puntos).toMatchObject({ usados: 250, ganados: 112, saldo: 362 });

    const mios = await request(app).get('/api/me/points').set(sesionDe(58));
    // Por puntos ganados (612) sería Pro; por saldo (362) es Fan.
    expect(mios.body).toMatchObject({ saldo: 362, ganados: 612, nivel: 'Fan', pctMax: 10, puntosParaSiguiente: 139, siguienteNivel: 'Pro' });
  });

  it('canjear más puntos de los que tiene -> 400 sin aprobar', async () => {
    const res = await request(app).post('/api/payments/process').set(sesionDe(56))
      .send({ method: 'NEQUI', bank: 'Nequi', items: [{ id: 1, quantity: 1 }], puntosUsar: 10 });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('el admin puede cambiar el estado de una venta simulada', async () => {
    const pago = await request(app).post('/api/payments/process').set(sesionDe(57))
      .send({ method: 'NEQUI', bank: 'Nequi', items: [{ id: 1, quantity: 1 }] });
    const res = await request(app).put(`/api/admin/sales/${pago.body.id_venta}/status`).set(authAdminSim()).send({ estado: 'Enviado' });
    expect(res.status).toBe(200);
  });
});

// Helado personalizado 3D en modo simulado: mismos precios y reglas que la semilla de la base.
describe('modo simulado (sin Supabase): helado personalizado', () => {
  const helado = (extra = {}) => ({ tipo: 'personalizado', envase: 'cup', sabores: ['vanilla', 'mora'], toppings: ['cherry'], quantity: 1, price: 1, ...extra });
  const authAdminSim = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 1, rol: 'admin' })}` });

  it('cobra el personalizado con los precios simulados e ignora el precio del cliente', async () => {
    const res = await pagar([helado({ quantity: 2 }), { id: 1, quantity: 1, price: 1 }]);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(2 * 13000 + 12500);
    expect(res.body.transaction.items.map((i) => i.name)).toEqual(['Fresa Salvaje', 'Helado personalizado 3D']);
    expect(res.body.transaction.items[1].personalizacion.sabores.map((s) => s.nombre)).toEqual(['Vainilla', 'Mora']);
  });

  it('un componente que no existe -> 400, no aprobado', async () => {
    const res = await pagar([helado({ toppings: ['oro'] })]);

    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('demasiados sabores o repetidos -> 400', async () => {
    expect((await pagar([helado({ sabores: ['vanilla', 'mora', 'fresa', 'mango'] })])).status).toBe(400);
    expect((await pagar([helado({ sabores: ['vanilla', 'vanilla'] })])).status).toBe(400);
  });

  it('la ruta de precios responde con la tabla simulada', async () => {
    const res = await request(app).get('/api/personalizado/precios');

    expect(res.status).toBe(200);
    expect(res.body.maxSabores).toBe(3);
    expect(res.body.maxToppings).toBe(3);
    expect(res.body.componentes).toHaveLength(17);
  });

  it('el admin ve el detalle de una venta simulada con la composición', async () => {
    const pago = await pagar([helado()]);
    const res = await request(app).get(`/api/admin/sales/${pago.body.id_venta}/items`).set(authAdminSim());

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ nombre: 'Helado personalizado 3D', cantidad: 1, precio_unitario: 13000 });
    expect(res.body.items[0].personalizacion.envase.nombre).toBe('Copa');
  });
});

describe('modo simulado (sin Supabase): login con "_" en el correo', () => {
  it('quien se registra con "_" puede iniciar sesión (ilike entiende el escape de comodines)', async () => {
    const datos = { name: 'Ana', lastName: 'Sim', email: 'ana_sim@example.com', password: 'Clave123!', confirmPassword: 'Clave123!' };
    const reg = await request(app).post('/api/register').send(datos);
    expect(reg.status).toBe(201);

    const res = await request(app).post('/api/login').send({ email: 'ana_sim@example.com', password: 'Clave123!' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('ana_sim@example.com');

    // "anaxsim" no debe encajar con la cuenta "ana_sim".
    const otro = await request(app).post('/api/login').send({ email: 'anaxsim@example.com', password: 'Clave123!' });
    expect(otro.status).toBe(401);
  });
});
