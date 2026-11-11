// Límite de enlaces de recuperación POR CORREO (además del límite por IP).
//  - Espera mínima: si ese correo ya tiene un enlace creado hace menos de 2 min, no se crea otro, no se
//    anula el vivo y no se manda correo.
//  - Tope diario: máximo 5 enlaces por correo en 24 h (usados o no).
//  - La respuesta al cliente es IDÉNTICA en todos los casos (no revela si la cuenta existe ni el límite).
//  - Si la base falla al consultar, no se manda correo y responde 500 sin detalles.
// El estado vive en la tabla reset_tokens (en Vercel cada petición puede caer en otra instancia).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';

const VIGENCIA = 30 * 60 * 1000;
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const COLUMNAS_RESET = ['id', 'token', 'email', 'expires_at', 'used'];

function crearBaseMemoria(fake) {
  const db = { usuario: [], reset_tokens: [] };
  let siguienteId = 1;
  const cumple = (fila, [op, col, val]) => {
    if (op === 'eq') return String(fila[col]) === String(val);
    if (op === 'ilike') return String(fila[col]).toLowerCase() === String(val).toLowerCase();
    if (op === 'gt') return fila[col] > val;
    if (op === 'gte') return fila[col] >= val;
    if (op === 'lt') return fila[col] < val;
    if (op === 'lte') return fila[col] <= val;
    return true;
  };
  const filtrar = (tabla, filtros) => db[tabla].filter((f) => filtros.every((x) => cumple(f, x)));
  const salida = (l, filas) => ({
    data: l.modo === 'varias' ? filas.map((f) => ({ ...f })) : filas[0] ? { ...filas[0] } : null,
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
    fake.responder(tabla, 'delete', (l) => {
      const borrar = new Set(filtrar(tabla, l.filtros));
      db[tabla] = db[tabla].filter((f) => !borrar.has(f));
      return { data: null, error: null };
    });
  }
  return {
    get tokens() { return db.reset_tokens; },
    usuario: db.usuario,
    poner: (f) => db.reset_tokens.push({ id: siguienteId++, used: false, ...f }),
  };
}

// Fila de token "creado hace `haceMs`" (expires_at = creación + 30 min).
const fila = (email, haceMs, extra = {}) => ({
  token: 'h' + Math.random().toString(16).slice(2), email, expires_at: Date.now() - haceMs + VIGENCIA, ...extra,
});

describe('límite de enlaces de recuperación por correo', () => {
  const fake = crearFakeSupabase();
  const correos = [];
  let app;
  let db;

  const cargar = (opciones = {}) => ({ app } = cargarServidor(fake, { correo: (m) => correos.push(m), frontendUrl: 'https://tienda.prueba.local', ...opciones }));
  const pedir = (email = 'ana@prueba.com') => request(app).post('/api/forgot-password').send({ email });

  beforeAll(() => cargar({ esperaEnlaceMs: 2 * MIN, maxEnlacesDia: 5 }));

  beforeEach(() => {
    fake.reiniciar();
    fake.columnas.reset_tokens = new Set(COLUMNAS_RESET);
    correos.length = 0;
    db = crearBaseMemoria(fake);
    db.usuario.push({ id_usuario: 7, nombre: 'Ana', apellido: 'P', email: 'ana@prueba.com', rol: 'cliente' });
  });

  it('segundo pedido dentro de 2 min: misma respuesta, sin correo nuevo y el primer token sigue vivo', async () => {
    const primero = await pedir();
    expect(correos).toHaveLength(1);
    const segundo = await pedir();
    expect(segundo.status).toBe(primero.status);
    expect(segundo.body).toEqual(primero.body);
    expect(correos).toHaveLength(1);
    expect(db.tokens).toHaveLength(1);
    expect(db.tokens[0].used).toBe(false);
  });

  it('pedido después de 2 min: correo nuevo y el anterior queda anulado', async () => {
    db.poner(fila('ana@prueba.com', 3 * MIN));
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(correos).toHaveLength(1);
    expect(db.tokens).toHaveLength(2);
    expect(db.tokens[0].used).toBe(true);
    expect(db.tokens.at(-1).used).toBe(false);
  });

  it('6.º pedido en 24 h: misma respuesta, sin correo ni fila nueva', async () => {
    for (let i = 0; i < 5; i++) db.poner(fila('ana@prueba.com', (3 + i) * MIN, { used: true }));
    const res = await pedir();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, message: 'Si este correo está registrado, recibirás un enlace.' });
    expect(correos).toHaveLength(0);
    expect(db.tokens).toHaveLength(5);
  });

  it('el 5.º pedido sí se envía (4 en las últimas 24 h)', async () => {
    for (let i = 0; i < 4; i++) db.poner(fila('ana@prueba.com', (3 + i) * MIN, { used: true }));
    await pedir();
    expect(correos).toHaveLength(1);
  });

  it('los enlaces de hace más de 24 h no cuentan y se borran al crear uno nuevo', async () => {
    for (let i = 0; i < 6; i++) db.poner(fila('ana@prueba.com', 25 * HORA + i * MIN, { used: true }));
    db.poner(fila('otra@prueba.com', 25 * HORA, { used: true }));
    await pedir();
    expect(correos).toHaveLength(1);
    expect(db.tokens.filter((f) => f.email === 'ana@prueba.com')).toHaveLength(1);
    expect(db.tokens.filter((f) => f.email === 'otra@prueba.com')).toHaveLength(1);
  });

  it('los enlaces de otro correo no cuentan', async () => {
    for (let i = 0; i < 6; i++) db.poner(fila('otra@prueba.com', (3 + i) * MIN, { used: true }));
    db.poner(fila('otra@prueba.com', 10 * 1000));
    await pedir();
    expect(correos).toHaveLength(1);
  });

  it('correo inexistente: misma respuesta que uno limitado', async () => {
    db.poner(fila('ana@prueba.com', 10 * 1000));
    const limitado = await pedir();
    const inexistente = await pedir('nadie@prueba.com');
    expect(inexistente.status).toBe(limitado.status);
    expect(inexistente.body).toEqual(limitado.body);
    expect(correos).toHaveLength(0);
  });

  it('si la base falla al consultar los enlaces: 500 sin detalles y sin correo', async () => {
    // Gana la primera respuesta registrada: se reinicia y se vuelve a montar con el select roto.
    fake.reiniciar();
    fake.columnas.reset_tokens = new Set(COLUMNAS_RESET);
    fake.responder('reset_tokens', 'select', () => ({ data: null, error: { message: 'detalle interno secreto', code: 'XX000' } }));
    db = crearBaseMemoria(fake);
    db.usuario.push({ id_usuario: 7, nombre: 'Ana', apellido: 'P', email: 'ana@prueba.com', rol: 'cliente' });
    const res = await pedir();
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('secreto');
    expect(correos).toHaveLength(0);
  });

  it('los valores por entorno cambian el comportamiento', async () => {
    cargar({ esperaEnlaceMs: 0, maxEnlacesDia: 2 });
    db.poner(fila('ana@prueba.com', 10 * 1000, { used: true })); // sin espera: no bloquea
    await pedir();
    expect(correos).toHaveLength(1);
    await pedir(); // ya hay 2 en 24 h -> tope 2
    expect(correos).toHaveLength(1);
    cargar({ esperaEnlaceMs: 2 * MIN, maxEnlacesDia: 5 });
  });
});
