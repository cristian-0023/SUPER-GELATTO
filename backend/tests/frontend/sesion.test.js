// Guardado de la sesión en el navegador (frontend/src/utils/sesion.js), compartido por Login y Register:
// el token y el usuario van a localStorage y sessionStorage con las claves de siempre.
import { describe, it, expect } from 'vitest';
import { guardarSesion } from '../../../frontend/src/utils/sesion.js';

function almacen() {
  const datos = new Map();
  return {
    datos,
    getItem: (k) => (datos.has(k) ? datos.get(k) : null),
    setItem: (k, v) => datos.set(k, String(v)),
    removeItem: (k) => datos.delete(k),
  };
}

const USUARIO = { id: 7, id_usuario: 7, name: 'Ana', email: 'ana@example.com', rol: 'cliente' };

describe('guardarSesion', () => {
  it('guarda token y usuario en los dos almacenes y responde true', () => {
    const local = almacen();
    const sesion = almacen();

    const ok = guardarSesion({ token: 'tok.abc', user: USUARIO }, { local, sesion });

    expect(ok).toBe(true);
    for (const a of [local, sesion]) {
      expect(a.getItem('superGelatto_token')).toBe('tok.abc');
      expect(JSON.parse(a.getItem('superGelatto_user'))).toEqual(USUARIO);
    }
  });

  it('sin token no guarda nada y responde false', () => {
    const local = almacen();
    const sesion = almacen();

    expect(guardarSesion({ user: USUARIO }, { local, sesion })).toBe(false);
    expect(guardarSesion({ token: '', user: USUARIO }, { local, sesion })).toBe(false);
    expect(guardarSesion(undefined, { local, sesion })).toBe(false);
    expect(local.datos.size).toBe(0);
    expect(sesion.datos.size).toBe(0);
  });

  it('con token pero sin usuario guarda solo el token', () => {
    const local = almacen();
    const sesion = almacen();

    expect(guardarSesion({ token: 'tok.abc' }, { local, sesion })).toBe(true);
    expect(local.getItem('superGelatto_token')).toBe('tok.abc');
    expect(local.getItem('superGelatto_user')).toBeNull();
    expect(sesion.getItem('superGelatto_user')).toBeNull();
  });

  it('si el navegador bloquea el almacenamiento no rompe la pantalla', () => {
    const roto = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };

    expect(() => guardarSesion({ token: 'tok.abc', user: USUARIO }, { local: roto, sesion: roto })).not.toThrow();
  });
});
