// Login: en ilike, "_" y "%" son comodines. Sin escaparlos, "a_b@x.com" también encajaría con "axb@x.com".
//  - correoParaIlike (backend/servicios/correoIlike.js) escapa "_", "%" y "\" (el mismo helper del login con Google).
//  - POST /api/login manda a ilike el correo escapado y un correo con "_" sigue entrando a su cuenta.
import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const require = createRequire(import.meta.url);
const CLAVE = 'Clave123!';

describe('correoParaIlike', () => {
  it('escapa "_", "%" y "\\" y deja lo demás igual', () => {
    const { correoParaIlike } = require('../../servicios/correoIlike.js');
    expect(correoParaIlike('a_b%c\\d@x.com')).toBe('a\\_b\\%c\\\\d@x.com');
    expect(correoParaIlike('ana.perez@example.com')).toBe('ana.perez@example.com');
  });
});

describe('POST /api/login: comodines de ilike', () => {
  let fake;
  beforeEach(() => {
    fake = crearFakeSupabase();
  });

  it('el valor que llega a ilike lleva el "_" escapado', async () => {
    const { app } = cargarServidor(fake);
    await request(app).post('/api/login').send({ email: 'a_b@example.com', password: CLAVE });

    expect(fake.consultas('usuario', 'select')[0].filtros).toContainEqual(['ilike', 'email', 'a\\_b@example.com']);
  });

  it('un correo con "_" sigue entrando a su propia cuenta', async () => {
    const { app } = cargarServidor(fake);
    fake.responder('usuario', 'select', {
      data: { id_usuario: 7, nombre: 'Ana', email: 'a_b@example.com', rol: 'cliente', password_hash: bcrypt.hashSync(CLAVE, 4) },
      error: null,
    });

    const res = await request(app).post('/api/login').send({ email: 'A_B@example.com', password: CLAVE });

    expect(res.status).toBe(200);
    expect(res.body.user.id_usuario).toBe(7);
  });
});
