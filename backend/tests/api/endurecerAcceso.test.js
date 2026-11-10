// Endurecimiento del acceso. Contrato:
//  - /api/login solo acepta la contraseña real (bcrypt.compare). La contraseña cifrada guardada en la
//    base NO sirve como contraseña (antes se aceptaba "password === password_hash").
//  - En producción (NODE_ENV=production, RENDER o VERCEL) el servidor no arranca sin
//    SUPABASE_SERVICE_ROLE_KEY: con la llave pública, tras los candados de la base, todo fallaría en silencio.
//  - En Vercel también se exige JWT_SECRET y se confía en 1 proxy (la IP real llega en X-Forwarded-For).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const CLAVE = 'Clave#Segura123';
const HASH = bcrypt.hashSync(CLAVE, 4);
const USUARIO = { id_usuario: 7, nombre: 'Ana', apellido: 'Prueba', email: 'ana@prueba.com', password_hash: HASH, rol: 'cliente' };

afterEach(() => {
  delete process.env.RENDER;
  delete process.env.VERCEL;
});

describe('login: la contraseña cifrada no sirve como contraseña', () => {
  const fake = crearFakeSupabase();
  let app;
  beforeAll(() => {
    ({ app } = cargarServidor(fake));
  });
  beforeEach(() => {
    fake.reiniciar();
    fake.responder('usuario', 'select', { data: { ...USUARIO }, error: null });
  });

  it('enviar el hash guardado como contraseña -> 401 y no toca la base', async () => {
    const res = await request(app).post('/api/login').send({ email: USUARIO.email, password: HASH });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
    expect(fake.consultas('usuario', 'update')).toHaveLength(0);
  });

  it('contraseña correcta -> 200 con sesión', async () => {
    const res = await request(app).post('/api/login').send({ email: USUARIO.email, password: CLAVE });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe('string');
  });

  it('contraseña incorrecta -> 401', async () => {
    const res = await request(app).post('/api/login').send({ email: USUARIO.email, password: 'Otra#Clave999' });
    expect(res.status).toBe(401);
  });

  it('contraseña que no es texto -> 400, sin romper el servidor', async () => {
    const res = await request(app).post('/api/login').send({ email: USUARIO.email, password: { $gt: '' } });
    expect(res.status).toBe(400);
  });

  it('fila sin password_hash (cuenta rara) -> 401, sin romper el servidor', async () => {
    fake.reiniciar();
    fake.responder('usuario', 'select', { data: { ...USUARIO, password_hash: null }, error: null });
    const res = await request(app).post('/api/login').send({ email: USUARIO.email, password: CLAVE });
    expect(res.status).toBe(401);
  });
});

describe('arranque en producción sin SUPABASE_SERVICE_ROLE_KEY', () => {
  const fake = { client: {} };

  it('NODE_ENV=production solo con la llave pública -> se niega a arrancar y explica qué falta', () => {
    expect(() => cargarServidor(fake, { produccion: true, soloLlavePublica: true })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('Render solo con la llave pública -> se niega a arrancar', () => {
    expect(() => cargarServidor(fake, { render: true, soloLlavePublica: true })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('Vercel solo con la llave pública -> se niega a arrancar', () => {
    expect(() => cargarServidor(fake, { vercel: true, soloLlavePublica: true })).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('Vercel sin Supabase -> se niega a arrancar (no modo simulado)', () => {
    expect(() => cargarServidor(null, { vercel: true, sinSupabase: true })).toThrow(/SUPABASE_URL/);
  });

  it('el mensaje dice por qué: con la llave pública la base rechaza las consultas', () => {
    let mensaje = '';
    try {
      cargarServidor(fake, { vercel: true, soloLlavePublica: true });
    } catch (e) {
      mensaje = e.message;
    }
    expect(mensaje).toMatch(/llave pública|SUPABASE_KEY/i);
    expect(mensaje).toMatch(/Vercel|Render|producción/i);
  });

  it('producción y Vercel con la llave de servicio -> arrancan', () => {
    expect(() => cargarServidor(fake, { produccion: true })).not.toThrow();
    expect(() => cargarServidor(fake, { vercel: true })).not.toThrow();
  });

  it('desarrollo solo con la llave pública -> arranca (con aviso)', () => {
    expect(() => cargarServidor(fake, { soloLlavePublica: true })).not.toThrow();
  });
});

describe('Vercel cuenta como producción', () => {
  it('sin JWT_SECRET en Vercel -> se niega a arrancar', () => {
    expect(() => cargarServidor({ client: {} }, { vercel: true, jwtSecret: '' })).toThrow(/JWT_SECRET/);
  });

  it('en Vercel se confía en 1 proxy (la IP real para el límite de intentos)', () => {
    const { app } = cargarServidor({ client: {} }, { vercel: true });
    expect(app.get('trust proxy')).toBe(1);
  });

  it('en desarrollo (sin Render/Vercel/TRUST_PROXY) no se confía en X-Forwarded-For', () => {
    const anterior = process.env.TRUST_PROXY;
    delete process.env.TRUST_PROXY;
    try {
      const { app } = cargarServidor({ client: {} });
      expect(app.get('trust proxy')).toBeFalsy();
    } finally {
      if (anterior !== undefined) process.env.TRUST_PROXY = anterior;
    }
  });
});
