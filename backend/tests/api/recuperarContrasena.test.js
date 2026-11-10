// "Olvidé mi contraseña" de punta a punta. Contrato:
//  - POST /api/forgot-password responde lo MISMO exista o no el correo (no revela cuentas).
//  - El enlace lleva un token aleatorio de 64 caracteres; en la base (tabla reset_tokens) se guarda solo
//    su sha256, con vencimiento de 30 minutos y un solo uso. Pedir otro enlace anula los anteriores.
//  - El correo va a la dirección guardada en la base, con el nombre escapado (sin HTML).
//  - GET /api/reset-password/:token solo dice si el enlace sirve (sin datos personales).
//  - POST /api/reset-password/:token valida la contraseña (mismas reglas que el registro), la guarda con
//    bcrypt y gasta el token. Token usado, vencido o inventado -> 400.
//  - En producción, sin FRONTEND_URL o sin correo configurado -> 503 (nunca enlaces a localhost).
//  - Todo con límite de intentos (429) y sin éxitos falsos si la base falla (500).
// Los tokens viven en la base, no en memoria: en Vercel cada petición puede caer en otra instancia.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const FRONT = 'https://tienda.prueba.local';
const CLAVE_VIEJA = 'Vieja#Clave1';
const CLAVE_NUEVA = 'Nueva#Clave2';
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
const COLUMNAS_RESET = ['id', 'token', 'email', 'expires_at', 'used']; // columnas reales de public.reset_tokens

// Mini base en memoria para el fake: aplica los filtros que manda el servidor (eq, ilike, gt, lt).
// ilike se comporta como en Postgres: "_" y "%" sin escapar son comodines.
function crearBaseMemoria(fake) {
  const db = { usuario: [], reset_tokens: [] };
  let siguienteId = 1;
  const likeARegex = (patron) => {
    let re = '';
    for (let i = 0; i < patron.length; i++) {
      const c = patron[i];
      if (c === '\\' && i + 1 < patron.length) re += patron[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      else if (c === '_') re += '.';
      else if (c === '%') re += '.*';
      else re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(`^${re}$`, 'i');
  };
  const cumple = (fila, [op, col, val]) => {
    if (op === 'eq') return String(fila[col]) === String(val);
    if (op === 'ilike') return likeARegex(String(val)).test(String(fila[col]));
    if (op === 'gt') return fila[col] > val;
    if (op === 'lt') return fila[col] < val;
    return true;
  };
  const filtrar = (tabla, filtros) => db[tabla].filter((f) => filtros.every((x) => cumple(f, x)));
  const salida = (llamada, filas) => ({
    data: llamada.modo === 'varias' ? filas.map((f) => ({ ...f })) : filas[0] ? { ...filas[0] } : null,
    error: null,
  });
  for (const tabla of ['usuario', 'reset_tokens']) {
    fake.responder(tabla, 'select', (l) => salida(l, filtrar(tabla, l.filtros)));
    fake.responder(tabla, 'update', (l) => {
      const filas = filtrar(tabla, l.filtros);
      for (const f of filas) Object.assign(f, l.payload);
      return salida(l, filas);
    });
    fake.responder(tabla, 'insert', (l) => {
      const nuevas = (Array.isArray(l.payload) ? l.payload : [l.payload]).map((f) => ({ id: siguienteId++, ...f }));
      db[tabla].push(...nuevas);
      return salida(l, nuevas);
    });
  }
  return db;
}

const tokenDelCorreo = (correo) => {
  const m = /\/reset-password\/([a-f0-9]{64})/.exec(correo.html);
  return m && m[1];
};

describe('recuperar contraseña (desarrollo, con correo falso)', () => {
  const fake = crearFakeSupabase();
  const correos = [];
  let app;
  let db;

  beforeAll(() => {
    ({ app } = cargarServidor(fake, { correo: (m) => correos.push(m), frontendUrl: FRONT }));
  });

  beforeEach(() => {
    fake.reiniciar();
    fake.columnas.reset_tokens = new Set(COLUMNAS_RESET);
    correos.length = 0;
    db = crearBaseMemoria(fake);
    db.usuario.push({
      id_usuario: 7, nombre: '<b>Ana</b>', apellido: 'Prueba', email: 'ana@prueba.com',
      password_hash: bcrypt.hashSync(CLAVE_VIEJA, 4), rol: 'cliente',
    });
  });

  const pedir = (email = 'ana@prueba.com') => request(app).post('/api/forgot-password').send({ email });
  const pedirToken = async () => {
    const res = await pedir();
    expect(res.status).toBe(200);
    return tokenDelCorreo(correos.at(-1));
  };
  const cambiar = (token, password = CLAVE_NUEVA, confirmPassword = password) =>
    request(app).post(`/api/reset-password/${token}`).send({ password, confirmPassword });

  it('correo inexistente y existente -> misma respuesta; solo el existente recibe correo', async () => {
    const noExiste = await pedir('nadie@prueba.com');
    const existe = await pedir('ana@prueba.com');
    expect(noExiste.status).toBe(200);
    expect(existe.status).toBe(noExiste.status);
    expect(existe.body).toEqual(noExiste.body);
    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('ana@prueba.com');
  });

  it('el correo trae el enlace al frontend y la base guarda solo el sha256, con 30 min y sin usar', async () => {
    const antes = Date.now();
    const token = await pedirToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(correos[0].html).toContain(`${FRONT}/reset-password/${token}`);
    expect(db.reset_tokens).toHaveLength(1);
    const fila = db.reset_tokens[0];
    expect(fila.token).toBe(sha256(token));
    expect(JSON.stringify(db.reset_tokens)).not.toContain(token);
    expect(fila.email).toBe('ana@prueba.com');
    expect(fila.used).toBe(false);
    expect(fila.expires_at).toBeGreaterThanOrEqual(antes + 29 * 60 * 1000);
    expect(fila.expires_at).toBeLessThanOrEqual(Date.now() + 31 * 60 * 1000);
  });

  it('el nombre va escapado en el correo (sin HTML del usuario)', async () => {
    await pedirToken();
    expect(correos[0].html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(correos[0].html).not.toContain('<b>Ana</b>');
  });

  it('un "_" en el correo no actúa como comodín (an_@... no encuentra a ana@...)', async () => {
    const res = await pedir('an_@prueba.com');
    expect(res.status).toBe(200);
    expect(correos).toHaveLength(0);
    expect(db.reset_tokens).toHaveLength(0);
  });

  it('el correo se busca sin distinguir mayúsculas y se envía a la dirección guardada', async () => {
    const res = await pedir('ANA@prueba.com');
    expect(res.status).toBe(200);
    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('ana@prueba.com');
  });

  it('GET con token válido -> 200 {valid:true}, sin datos personales', async () => {
    const token = await pedirToken();
    const res = await request(app).get(`/api/reset-password/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/ana@prueba\.com|Ana/);
  });

  it('GET con token inventado -> 400 {valid:false} con mensaje en español', async () => {
    const res = await request(app).get(`/api/reset-password/${crypto.randomBytes(32).toString('hex')}`);
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.message).toMatch(/enlace/i);
    expect(res.body.code).toBe('ENLACE_INVALIDO');
  });

  it('GET con token mal formado -> 400 sin consultar la base', async () => {
    const res = await request(app).get('/api/reset-password/no-es-un-token');
    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(fake.consultas('reset_tokens')).toHaveLength(0);
  });

  it('token válido -> cambia la contraseña (bcrypt), gasta el token y el login funciona con la nueva', async () => {
    const token = await pedirToken();
    const res = await cambiar(token);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const hash = db.usuario[0].password_hash;
    expect(hash).toMatch(/^\$2[aby]\$/);
    expect(bcrypt.compareSync(CLAVE_NUEVA, hash)).toBe(true);
    expect(db.reset_tokens[0].used).toBe(true);

    const nueva = await request(app).post('/api/login').send({ email: 'ana@prueba.com', password: CLAVE_NUEVA });
    expect(nueva.status).toBe(200);
    const vieja = await request(app).post('/api/login').send({ email: 'ana@prueba.com', password: CLAVE_VIEJA });
    expect(vieja.status).toBe(401);
  });

  it('token ya usado -> 400 y la contraseña no vuelve a cambiar', async () => {
    const token = await pedirToken();
    expect((await cambiar(token)).status).toBe(200);
    const hashTrasUso = db.usuario[0].password_hash;
    const otra = await cambiar(token, 'Otra#Clave33');
    expect(otra.status).toBe(400);
    expect(otra.body.message).toMatch(/venció|usado|inválido/i);
    expect(otra.body.code).toBe('ENLACE_INVALIDO'); // la página lo usa para mostrar "pide un enlace nuevo"
    expect(db.usuario[0].password_hash).toBe(hashTrasUso);
    expect((await request(app).get(`/api/reset-password/${token}`)).status).toBe(400);
  });

  it('token vencido -> 400 en GET y en POST', async () => {
    const token = await pedirToken();
    db.reset_tokens[0].expires_at = Date.now() - 1000;
    expect((await request(app).get(`/api/reset-password/${token}`)).status).toBe(400);
    expect((await cambiar(token)).status).toBe(400);
    expect(bcrypt.compareSync(CLAVE_VIEJA, db.usuario[0].password_hash)).toBe(true);
  });

  it('token inventado -> 400 en POST y no toca la contraseña', async () => {
    const res = await cambiar(crypto.randomBytes(32).toString('hex'));
    expect(res.status).toBe(400);
    expect(fake.consultas('usuario', 'update')).toHaveLength(0);
  });

  it('pedir un segundo enlace anula el primero', async () => {
    const primero = await pedirToken();
    const segundo = await pedirToken();
    expect(segundo).not.toBe(primero);
    expect((await cambiar(primero)).status).toBe(400);
    expect((await cambiar(segundo)).status).toBe(200);
  });

  it('contraseña débil -> 400 con mensaje claro y el token sigue sirviendo', async () => {
    const token = await pedirToken();
    const debil = await cambiar(token, 'abc');
    expect(debil.status).toBe(400);
    expect(debil.body.message).toMatch(/8 caracteres/);
    expect(db.reset_tokens[0].used).toBe(false);
    expect((await cambiar(token)).status).toBe(200);
  });

  it('contraseñas que no coinciden o que no son texto -> 400', async () => {
    const token = await pedirToken();
    expect((await cambiar(token, CLAVE_NUEVA, 'Distinta#Clave9')).status).toBe(400);
    const raro = await request(app).post(`/api/reset-password/${token}`).send({ password: { a: 1 }, confirmPassword: { a: 1 } });
    expect(raro.status).toBe(400);
    expect(db.reset_tokens[0].used).toBe(false);
  });

  it('si la base falla al guardar el token -> 500, nunca un "te enviamos el enlace"', async () => {
    fake.reiniciar();
    fake.columnas.reset_tokens = new Set(COLUMNAS_RESET);
    db = crearBaseMemoria(fake);
    db.usuario.push({ id_usuario: 7, nombre: 'Ana', email: 'ana@prueba.com', password_hash: 'x', rol: 'cliente' });
    fake._respuestasQuery.unshift({ tabla: 'reset_tokens', op: 'insert', respuesta: { data: null, error: { message: 'caída' } } });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(correos).toHaveLength(0);
  });

  it('si la base falla al buscar el usuario -> 500', async () => {
    fake._respuestasQuery.unshift({ tabla: 'usuario', op: 'select', respuesta: { data: null, error: { message: 'caída' } } });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('si la base falla al guardar la contraseña -> 500', async () => {
    const token = await pedirToken();
    fake._respuestasQuery.unshift({ tabla: 'usuario', op: 'update', respuesta: { data: null, error: { message: 'caída' } } });
    const res = await cambiar(token);
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
  });

  it('si el correo no se puede enviar -> la misma respuesta genérica (no revela la cuenta)', async () => {
    const generica = (await pedir('nadie@prueba.com')).body;
    const { app: appSinCorreo } = cargarServidor(fake, {
      frontendUrl: FRONT,
      correo: () => { throw new Error('SMTP caído'); },
    });
    const res = await request(appSinCorreo).post('/api/forgot-password').send({ email: 'ana@prueba.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(generica);
  });
});

describe('recuperar contraseña en producción', () => {
  const fake = crearFakeSupabase();
  const correos = [];
  beforeEach(() => {
    fake.reiniciar();
    fake.columnas.reset_tokens = new Set(COLUMNAS_RESET);
    correos.length = 0;
    const db = crearBaseMemoria(fake);
    db.usuario.push({ id_usuario: 7, nombre: 'Ana', email: 'ana@prueba.com', password_hash: 'x', rol: 'cliente' });
  });

  it('sin FRONTEND_URL -> 503 claro, sin tocar la base ni mandar correos', async () => {
    const { app } = cargarServidor(fake, { produccion: true, smtp: true, correo: (m) => correos.push(m) });
    const res = await request(app).post('/api/forgot-password').send({ email: 'ana@prueba.com' });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/no está disponible/i);
    expect(fake.consultas('reset_tokens')).toHaveLength(0);
    expect(correos).toHaveLength(0);
  });

  it('sin correo (SMTP) configurado -> 503 (no se finge un envío)', async () => {
    const { app } = cargarServidor(fake, { produccion: true, frontendUrl: FRONT, correo: (m) => correos.push(m) });
    const res = await request(app).post('/api/forgot-password').send({ email: 'ana@prueba.com' });
    expect(res.status).toBe(503);
    expect(correos).toHaveLength(0);
  });

  it('con todo configurado -> 200, enlace al frontend real y sin previewUrl', async () => {
    const { app } = cargarServidor(fake, { produccion: true, smtp: true, frontendUrl: `${FRONT}/`, correo: (m) => correos.push(m) });
    const res = await request(app).post('/api/forgot-password').send({ email: 'ana@prueba.com' });
    expect(res.status).toBe(200);
    expect(res.body.previewUrl).toBeUndefined();
    expect(correos[0].html).toContain(`${FRONT}/reset-password/`);
    expect(correos[0].html).not.toContain('localhost');
  });
});

describe('límite de intentos en el restablecimiento', () => {
  const fake = crearFakeSupabase();
  let app;
  beforeAll(() => {
    ({ app } = cargarServidor(fake, { limiteLogin: 2, frontendUrl: FRONT }));
  });

  it('GET /api/reset-password/:token -> 429 al pasar el límite', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    for (let i = 0; i < 2; i++) expect((await request(app).get(`/api/reset-password/${token}`)).status).not.toBe(429);
    const res = await request(app).get(`/api/reset-password/${token}`);
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/demasiados intentos/i);
  });

  it('POST /api/reset-password/:token -> 429 al pasar el límite (cuenta propia)', async () => {
    const token = crypto.randomBytes(32).toString('hex');
    const enviar = () => request(app).post(`/api/reset-password/${token}`).send({});
    for (let i = 0; i < 2; i++) expect((await enviar()).status).not.toBe(429);
    const res = await enviar();
    expect(res.status).toBe(429);
    expect(res.body.ok).toBe(false);
  });
});

describe('modo simulado (sin base)', () => {
  it('la recuperación responde 503 en vez de fallar', async () => {
    const { app } = cargarServidor(null, { sinSupabase: true, frontendUrl: FRONT });
    const res = await request(app).post('/api/forgot-password').send({ email: 'cliente@supergelatto.com' });
    expect(res.status).toBe(503);
  });

  it('validar o usar un enlace también responde 503 (no se cae el servidor)', async () => {
    const { app } = cargarServidor(null, { sinSupabase: true, frontendUrl: FRONT });
    const token = crypto.randomBytes(32).toString('hex');
    expect((await request(app).get(`/api/reset-password/${token}`)).status).toBe(503);
    const res = await request(app).post(`/api/reset-password/${token}`).send({ password: CLAVE_NUEVA, confirmPassword: CLAVE_NUEVA });
    expect(res.status).toBe(503);
  });
});
