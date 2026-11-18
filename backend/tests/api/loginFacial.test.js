// POST /api/admin/faceid/rekognition-login: forma de la respuesta. Con un rostro reconocido de un admin,
// responde el mismo { token, user } que el login con contraseña (misma función sesionDe), sin password_hash.
// AWS nunca se llama de verdad: se reemplaza RekognitionClient.prototype.send.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor, JWT_SECRET_PRUEBA } from '../helpers/cargarServidor.js';

const requireNode = createRequire(import.meta.url);
const { RekognitionClient } = requireNode('@aws-sdk/client-rekognition');

const CLAVE = 'Clave123!';
const ADMIN = {
  id_usuario: 3, nombre: 'Jefa', apellido: 'Lopez', email: 'jefa@example.com', rol: 'admin',
  password_hash: bcrypt.hashSync(CLAVE, 4),
};
const FOTO = Buffer.from('foto-de-prueba').toString('base64');

let fake;
let envio;
beforeEach(() => {
  fake = crearFakeSupabase();
  envio = vi.spyOn(RekognitionClient.prototype, 'send').mockResolvedValue({
    FaceMatches: [{ Similarity: 99.1, Face: { FaceId: 'rostro-1' } }],
  });
});
afterEach(() => vi.restoreAllMocks());

const loginFacial = (app) => request(app).post('/api/admin/faceid/rekognition-login').send({ image: FOTO });

describe('POST /api/admin/faceid/rekognition-login: respuesta de sesión', () => {
  it('rostro de un admin -> 200 con el mismo { token, user } que el login y sin password_hash', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('admin_face_rekognition', 'select', { data: { id_usuario: 3 }, error: null });
    fake.responder('usuario', 'select', { data: ADMIN, error: null });

    const facial = await loginFacial(app);
    const login = await request(app).post('/api/login').send({ email: ADMIN.email, password: CLAVE });

    expect(envio).toHaveBeenCalledTimes(1);
    expect(facial.status).toBe(200);
    expect(facial.body.ok).toBe(true);
    expect(facial.body.user).toEqual({ id: 3, id_usuario: 3, name: 'Jefa', email: 'jefa@example.com', rol: 'admin' });
    expect(facial.body.user).toEqual(login.body.user);
    const contenido = jwt.verify(facial.body.token, JWT_SECRET_PRUEBA, { algorithms: ['HS256'] });
    expect(contenido).toMatchObject({ id_usuario: 3, email: 'jefa@example.com', rol: 'admin' });
    expect(contenido.exp - contenido.iat).toBe(24 * 60 * 60);
    const sinTiempos = ({ iat, exp, ...resto }) => resto;
    expect(sinTiempos(contenido)).toEqual(sinTiempos(jwt.decode(login.body.token)));
    expect(JSON.stringify(facial.body)).not.toMatch(/password|apellido|\$2[aby]\$/);
  });

  it('rostro reconocido pero la cuenta no es admin -> 401 sin token', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('admin_face_rekognition', 'select', { data: { id_usuario: 3 }, error: null });
    fake.responder('usuario', 'select', { data: { ...ADMIN, rol: 'cliente' }, error: null });

    const res = await loginFacial(app);

    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });
});
