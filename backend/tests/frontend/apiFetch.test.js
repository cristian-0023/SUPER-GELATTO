// apiFetch (frontend/src/utils/api.js): cierra la sesión y manda a /login SOLO ante 401 (sesión vencida o
// inválida). Un 403 es un "no tienes permiso para esto" de negocio: la sesión sigue y la respuesta llega a
// quien llamó para que muestre el mensaje (API-007).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiFetch } from '../../../frontend/src/utils/api.js';

function almacen(inicial = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
}

let local;
let sesion;
let ventana;
let fetchFalso;
const SESION = { superGelatto_token: 'tok.abc', superGelatto_user: '{"id":1,"rol":"admin"}' };

function responderCon(status, cuerpo = { ok: false, message: 'Solo el super administrador puede hacerlo.' }) {
  fetchFalso = vi.fn(async () => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchFalso);
}

beforeEach(() => {
  local = almacen(SESION);
  sesion = almacen(SESION);
  ventana = { location: { href: '/admin' } };
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', sesion);
  vi.stubGlobal('window', ventana);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('manda el token guardado en Authorization: Bearer', async () => {
    responderCon(200, { ok: true });
    await apiFetch('/api/admin/dashboard');
    const [, opciones] = fetchFalso.mock.calls[0];
    expect(opciones.headers.Authorization).toBe('Bearer tok.abc');
  });

  it('403: NO cierra la sesión ni redirige, y devuelve la respuesta con su mensaje', async () => {
    responderCon(403);
    const res = await apiFetch('/api/admin/users/50/role', { method: 'PUT', body: '{"rol":"admin"}' });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/super administrador/i);
    expect(ventana.location.href).toBe('/admin');
    expect(local.getItem('superGelatto_token')).toBe('tok.abc');
    expect(sesion.getItem('superGelatto_token')).toBe('tok.abc');
  });

  it('401: cierra la sesión (borra token y usuario) y manda a /login', async () => {
    responderCon(401, { ok: false, message: 'Token de sesión inválido o expirado.' });
    const res = await apiFetch('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(ventana.location.href).toBe('/login');
    for (const a of [local, sesion]) {
      expect(a.getItem('superGelatto_token')).toBeNull();
      expect(a.getItem('superGelatto_user')).toBeNull();
    }
  });

  it('200: no toca la sesión', async () => {
    responderCon(200, { ok: true });
    await apiFetch('/api/admin/dashboard');
    expect(ventana.location.href).toBe('/admin');
    expect(local.getItem('superGelatto_token')).toBe('tok.abc');
  });
});
