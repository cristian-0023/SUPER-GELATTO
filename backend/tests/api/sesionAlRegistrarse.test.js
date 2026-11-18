// Al registrarse, el cliente queda con la sesión iniciada. Contrato de POST /api/register:
//  - 201 { message, token, user }: token firmado igual que el del login (HS256, 24 h, rol 'cliente' sacado
//    de la fila insertada, id del usuario nuevo) y `user` con el mismo formato del login, sin password_hash.
//  - Validación fallida (400), correo ya registrado (409) o reservado de admin (403) -> sin token.
//  - Si el insert no devuelve la fila -> 201 sin token (el frontend manda a /login como antes).
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, JWT_SECRET_PRUEBA } from '../helpers/cargarServidor.js';

const CLAVE = 'Clave123!';
const ENTORNO = { adminEmails: 'jefe@example.com', superAdmin: 'principal@example.com' };

const datos = (extra = {}) => ({ name: 'Ana', lastName: 'Perez', email: 'ana@example.com', password: CLAVE, confirmPassword: CLAVE, ...extra });
const registro = (app, extra) => request(app).post('/api/register').send(datos(extra));

let fake;
beforeEach(() => {
  fake = crearFakeSupabase();
});

describe('POST /api/register: deja la sesión iniciada', () => {
  it('registro correcto -> 201 con token válido de cliente y user sin datos sensibles', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Usuario registrado exitosamente.');
    expect(typeof res.body.token).toBe('string');

    const idNuevo = res.body.user.id_usuario;
    expect(Number.isInteger(idNuevo)).toBe(true);
    const contenido = jwt.verify(res.body.token, JWT_SECRET_PRUEBA, { algorithms: ['HS256'] });
    expect(contenido).toMatchObject({ id_usuario: idNuevo, email: 'ana@example.com', rol: 'cliente' });
    // Misma duración que el login: 24 h.
    expect(contenido.exp - contenido.iat).toBe(24 * 60 * 60);
    expect(jwt.decode(res.body.token, { complete: true }).header.alg).toBe('HS256');

    // Mismo formato que el login.
    expect(res.body.user).toEqual({ id: idNuevo, id_usuario: idNuevo, name: 'Ana', email: 'ana@example.com', rol: 'cliente' });
    expect(JSON.stringify(res.body)).not.toMatch(/password|\$2[aby]\$/);
  });

  it('el rol del token sale de la fila insertada, no de lo que manda el navegador', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app, { rol: 'admin' });

    expect(res.status).toBe(201);
    expect(fake.consultas('usuario', 'insert')[0].payload[0].rol).toBe('cliente');
    expect(jwt.verify(res.body.token, JWT_SECRET_PRUEBA).rol).toBe('cliente');
    expect(res.body.user.rol).toBe('cliente');
  });

  it('el token del registro sirve para GET /api/me/points (200)', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app);
    fake.responderRpc('super_points_resumen', {
      data: { saldo: 0, ganados: 0, nivel: 'Lover', pct_max: 5, valor_saldo: 0, puntos_para_siguiente: 101, siguiente_nivel: 'Fan' },
      error: null,
    });

    const puntos = await request(app).get('/api/me/points').set('Authorization', `Bearer ${res.body.token}`);

    expect(puntos.status).toBe(200);
    expect(fake.rpcs('super_points_resumen')[0].args).toEqual({ p_id_usuario: res.body.user.id_usuario });
  });

  it('el token del registro tiene el mismo formato que el del login de esa cuenta', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const reg = await registro(app);
    const fila = { ...fake.consultas('usuario', 'insert')[0].payload[0], id_usuario: reg.body.user.id_usuario };
    fila.password_hash = bcrypt.hashSync(CLAVE, 4);
    fake.responder('usuario', 'select', { data: fila, error: null });

    const login = await request(app).post('/api/login').send({ email: 'ana@example.com', password: CLAVE });

    expect(login.status).toBe(200);
    expect(login.body.user).toEqual(reg.body.user);
    const sinTiempos = ({ iat, exp, ...resto }) => resto;
    expect(sinTiempos(jwt.decode(reg.body.token))).toEqual(sinTiempos(jwt.decode(login.body.token)));
  });

  it('validación fallida -> 400 sin token y sin insertar', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app, { confirmPassword: 'Otra123!' });

    expect(res.status).toBe(400);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(fake.consultas('usuario', 'insert')).toHaveLength(0);
  });

  it('correo ya registrado -> 409 sin token', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    fake.responder('usuario', 'select', { data: { email: 'ana@example.com' }, error: null });
    const res = await registro(app);

    expect(res.status).toBe(409);
    expect(res.body.token).toBeUndefined();
    expect(fake.consultas('usuario', 'insert')).toHaveLength(0);
  });

  it.each(['jefe@example.com', 'PRINCIPAL@example.com'])('correo reservado de admin (%s) -> 403 sin token', async (email) => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app, { email });

    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
    expect(fake.consultas('usuario', 'insert')).toHaveLength(0);
  });

  it('el insert no devuelve la fila -> 201 sin token', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    fake.responder('usuario', 'insert', { data: null, error: null });
    const res = await registro(app);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Usuario registrado exitosamente.');
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).toBeUndefined();
  });

  it('falla el insert -> 500 sin token', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    fake.responder('usuario', 'insert', { data: null, error: { message: 'fallo de red' } });
    const res = await registro(app);

    expect(res.status).toBe(500);
    expect(res.body.token).toBeUndefined();
  });

  it('correo con mayúsculas -> se guarda en minúsculas y la búsqueda de duplicados usa minúsculas', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    const res = await registro(app, { email: 'Ana.Perez@Example.COM' });

    expect(res.status).toBe(201);
    expect(fake.consultas('usuario', 'insert')[0].payload[0].email).toBe('ana.perez@example.com');
    expect(fake.consultas('usuario', 'select')[0].filtros).toContainEqual(['eq', 'email', 'ana.perez@example.com']);
    expect(res.body.user.email).toBe('ana.perez@example.com');
  });

  it('dos registros a la vez con el mismo correo: el insert choca (23505) -> 409 sin token', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    fake.responder('usuario', 'insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "usuario_email_key"' },
    });
    const res = await registro(app);

    expect(res.status).toBe(409);
    expect(res.body.message).toBe('El email ya está registrado.');
    expect(res.body.token).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/duplicate|constraint/);
  });

  it('el insert solo pide de vuelta columnas no sensibles', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    await registro(app);

    const columnas = fake.consultas('usuario', 'insert')[0].columnasRetorno;
    expect(typeof columnas).toBe('string');
    expect(columnas).not.toMatch(/password|\*/);
  });
});

describe('POST /api/login: cuentas viejas guardadas con mayúsculas', () => {
  it('busca sin distinguir mayúsculas (ilike en minúsculas) y deja entrar', async () => {
    const { app } = cargarServidor(fake, ENTORNO);
    fake.responder('usuario', 'select', {
      data: { id_usuario: 9, nombre: 'Ana', email: 'Ana@Example.com', rol: 'cliente', password_hash: bcrypt.hashSync(CLAVE, 4) },
      error: null,
    });

    const res = await request(app).post('/api/login').send({ email: 'ANA@example.com', password: CLAVE });

    expect(res.status).toBe(200);
    expect(fake.consultas('usuario', 'select')[0].filtros).toContainEqual(['ilike', 'email', 'ana@example.com']);
    expect(res.body.user.id_usuario).toBe(9);
  });
});
