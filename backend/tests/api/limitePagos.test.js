// 3. Límite de intentos en POST /api/payments/process (solo esa ruta).
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, tokenPrueba } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
let app;
const LIMITE = 3;

beforeAll(() => {
  ({ app } = cargarServidor(fake, { limitePagos: LIMITE }));
});

// Cuerpo inválido a propósito: responde 400 al instante (sin la espera de la pasarela) pero cuenta como intento.
const sesion = () => ({ Authorization: `Bearer ${tokenPrueba({ id_usuario: 3, rol: 'cliente' })}` });
const intento = () => request(app).post('/api/payments/process').set(sesion()).send({ method: 'NOPE' });

describe('POST /api/payments/process - límite de intentos', () => {
  // Debe ir primero: los intentos se cuentan por servidor y las demás pruebas los gastan.
  it('sin sesión responde 401 y no gasta los intentos de los clientes de esa IP', async () => {
    for (let i = 0; i < LIMITE + 2; i++) {
      const res = await request(app).post('/api/payments/process').send({ method: 'NOPE' });
      expect(res.status).toBe(401);
    }
  });

  it(`las primeras ${LIMITE} peticiones pasan y la siguiente recibe 429 en español`, async () => {
    for (let i = 0; i < LIMITE; i++) expect((await intento()).status).toBe(400);

    const res = await intento();

    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/demasiados intentos/i);
  });

  it('el límite es solo de esa ruta: /api/products sigue respondiendo', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).not.toBe(429);
  });
});
