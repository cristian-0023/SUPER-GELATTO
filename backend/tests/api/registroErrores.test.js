// Errores de la base en POST /api/register (supabase-js no lanza: devuelve { error }):
//  - Si falla la búsqueda del correo ya existente -> 500 { ok:false, message } genérico y NO se inserta.
//  - Un error inesperado (algo que sí lanza) -> 500 { ok:false, message } genérico, sin detalles internos.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const CLAVE = 'Clave123!';
const datos = { name: 'Ana', lastName: 'Perez', email: 'ana@example.com', password: CLAVE, confirmPassword: CLAVE };

let fake;
beforeEach(() => {
  fake = crearFakeSupabase();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/register: errores de la base', () => {
  it('falla la búsqueda del correo -> 500 genérico y no inserta', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('usuario', 'select', { data: null, error: { message: 'connection refused at db-interna:5432' } });

    const res = await request(app).post('/api/register').send(datos);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(JSON.stringify(res.body)).not.toMatch(/connection|db-interna|5432/);
    expect(res.body.token).toBeUndefined();
    expect(fake.consultas('usuario', 'insert')).toHaveLength(0);
  });

  it('error inesperado -> 500 { ok:false } genérico sin detalles internos', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('usuario', 'insert', () => {
      throw new Error('detalle interno: tabla usuario bloqueada');
    });

    const res = await request(app).post('/api/register').send(datos);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(typeof res.body.message).toBe('string');
    expect(res.body.message.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/detalle interno|bloqueada|stack/);
    expect(res.body.token).toBeUndefined();
  });

  it('falla el insert con error de la base -> 500 { ok:false } genérico', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('usuario', 'insert', { data: null, error: { message: 'permission denied for table usuario' } });

    const res = await request(app).post('/api/register').send(datos);

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/permission|denied/);
  });
});
