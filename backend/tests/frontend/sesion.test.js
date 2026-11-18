// Sesión en el navegador (frontend/src/utils/sesion.js), igual para todos los caminos (contraseña, Google,
// facial y registro): token y usuario en localStorage y sessionStorage con las claves de siempre.
// Editar el perfil actualiza el usuario en los dos y cerrar sesión borra los dos.
import { describe, it, expect } from 'vitest';
import { guardarSesion, actualizarUsuarioGuardado, borrarSesion, leerUsuarioGuardado } from '../../../frontend/src/utils/sesion.js';

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

  it('con token pero sin usuario no guarda nada (sin sesión a medias) y responde false', () => {
    const local = almacen();
    const sesion = almacen();

    expect(guardarSesion({ token: 'tok.abc' }, { local, sesion })).toBe(false);
    expect(guardarSesion({ token: 'tok.abc', user: null }, { local, sesion })).toBe(false);
    expect(local.datos.size).toBe(0);
    expect(sesion.datos.size).toBe(0);
  });

  it('si el navegador bloquea el almacenamiento no rompe la pantalla', () => {
    const roto = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };

    expect(() => guardarSesion({ token: 'tok.abc', user: USUARIO }, { local: roto, sesion: roto })).not.toThrow();
  });
});

describe('actualizarUsuarioGuardado (editar perfil, datos nuevos del usuario)', () => {
  it('actualiza el usuario en los dos almacenes y no toca el token', () => {
    const local = almacen();
    const sesion = almacen();
    guardarSesion({ token: 'tok.abc', user: USUARIO }, { local, sesion });
    const nuevo = { ...USUARIO, picture: 'data:image/png;base64,AAA' };

    expect(actualizarUsuarioGuardado(nuevo, { local, sesion })).toBe(true);
    for (const a of [local, sesion]) {
      expect(JSON.parse(a.getItem('superGelatto_user'))).toEqual(nuevo);
      expect(a.getItem('superGelatto_token')).toBe('tok.abc');
    }
  });

  it('sin usuario válido no guarda nada', () => {
    const local = almacen();
    const sesion = almacen();
    expect(actualizarUsuarioGuardado(null, { local, sesion })).toBe(false);
    expect(local.datos.size + sesion.datos.size).toBe(0);
  });
});

describe('borrarSesion (cerrar sesión)', () => {
  it('borra token, usuario y la verificación facial de los dos almacenes y deja lo demás', () => {
    const local = almacen();
    const sesion = almacen();
    guardarSesion({ token: 'tok.abc', user: USUARIO }, { local, sesion });
    for (const a of [local, sesion]) {
      a.setItem('superGelatto_face_verified', 'true');
      a.setItem('superGelatto_face_verified_at', '123');
      a.setItem('superGelatto_cart_guest', '[]');
    }

    borrarSesion({ local, sesion });

    for (const a of [local, sesion]) {
      expect([...a.datos.keys()]).toEqual(['superGelatto_cart_guest']);
    }
  });
});

describe('leerUsuarioGuardado (al abrir la app: la sesión no dura más que el token de 24 h)', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const tokenQueVence = (expSeg) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ id_usuario: 7, rol: 'cliente', exp: expSeg })}.firma`;
  const AHORA = 1_800_000_000_000;

  function conSesion(token) {
    const local = almacen();
    const sesion = almacen();
    guardarSesion({ token, user: USUARIO }, { local, sesion });
    return { local, sesion };
  }

  it('token vigente -> devuelve el usuario guardado', () => {
    const almacenes = conSesion(tokenQueVence(AHORA / 1000 + 3600));
    expect(leerUsuarioGuardado({ ...almacenes, ahora: AHORA })).toEqual(USUARIO);
  });

  it('token vencido -> null y borra la sesión de los dos almacenes', () => {
    const almacenes = conSesion(tokenQueVence(AHORA / 1000 - 1));
    expect(leerUsuarioGuardado({ ...almacenes, ahora: AHORA })).toBeNull();
    expect(almacenes.local.datos.size + almacenes.sesion.datos.size).toBe(0);
  });

  it('sin token, token ilegible o usuario dañado -> null y borra la sesión', () => {
    for (const token of [null, 'no-es-un-jwt', `${b64({})}.%%%.x`]) {
      const local = almacen();
      const sesion = almacen();
      if (token) local.setItem('superGelatto_token', token);
      local.setItem('superGelatto_user', JSON.stringify(USUARIO));
      expect(leerUsuarioGuardado({ local, sesion, ahora: AHORA })).toBeNull();
      expect(local.datos.size).toBe(0);
    }
    const almacenes = conSesion(tokenQueVence(AHORA / 1000 + 3600));
    almacenes.local.setItem('superGelatto_user', '{roto');
    almacenes.sesion.setItem('superGelatto_user', '{roto');
    expect(leerUsuarioGuardado({ ...almacenes, ahora: AHORA })).toBeNull();
  });

  it('nada guardado -> null sin errores', () => {
    expect(leerUsuarioGuardado({ local: almacen(), sesion: almacen(), ahora: AHORA })).toBeNull();
  });
});
