// Despertador diario: GET /api/health hace una consulta mínima a la base (para que Supabase gratis
// no se pause por falta de actividad) y la llama Vercel Cron una vez al día.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const fake = crearFakeSupabase();
let app;
const SECRETO = 'secreto-de-prueba-cron';
const ERROR_BASE = { data: null, error: { code: '57P03', message: 'database is starting up' } };

beforeAll(() => {
  ({ app } = cargarServidor(fake));
});
beforeEach(() => fake.reiniciar());
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('GET /api/health sin CRON_SECRET', () => {
  it('es público: 200 {ok:true}, sin datos y con no-store', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('hace una consulta real y mínima a producto', async () => {
    await request(app).get('/api/health');
    expect(fake.consultas('producto', 'select')).toHaveLength(1);
  });

  it('si la base falla responde 503 {ok:false} sin detalles internos', async () => {
    fake.responder('producto', 'select', ERROR_BASE);
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
    expect(JSON.stringify(res.body)).not.toMatch(/starting|57P03/);
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('GET /api/health con CRON_SECRET', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRETO;
  });

  it('sin cabecera Authorization -> 401 y no toca la base', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(401);
    expect(fake.consultas('producto', 'select')).toHaveLength(0);
  });

  it('con cabecera incorrecta -> 401', async () => {
    const res = await request(app).get('/api/health').set('Authorization', 'Bearer otro-secreto-distinto');
    expect(res.status).toBe(401);
    const res2 = await request(app).get('/api/health').set('Authorization', 'Bearer x');
    expect(res2.status).toBe(401);
  });

  it('con la cabecera correcta -> 200', async () => {
    const res = await request(app).get('/api/health').set('Authorization', `Bearer ${SECRETO}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

describe('vercel.json del backend', () => {
  it('programa un cron diario a /api/health', () => {
    const ruta = path.resolve(__dirname, '../../vercel.json');
    const config = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    expect(config.crons).toContainEqual({ path: '/api/health', schedule: '0 12 * * *' });
  });
});
