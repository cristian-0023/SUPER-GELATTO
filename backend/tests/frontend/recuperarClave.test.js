// Lógica pura de "Olvidé mi contraseña" (frontend/src/utils/recuperarClave.js): qué se le muestra a la
// persona según la respuesta del servidor (enlace vencido o usado, contraseña débil, demasiados intentos...).
import { describe, it, expect } from 'vitest';
import {
  resultadoValidarEnlace,
  resultadoCambioClave,
  mensajeErrorOlvido,
  MENSAJE_ENLACE_INVALIDO,
  MENSAJE_DEMASIADOS_INTENTOS,
} from '../../../frontend/src/utils/recuperarClave.js';

describe('resultadoValidarEnlace (GET /api/reset-password/:token)', () => {
  it('200 con valid:true -> enlace válido', () => {
    expect(resultadoValidarEnlace(200, { ok: true, valid: true })).toEqual({ valido: true, mensaje: '' });
  });

  it('400 con mensaje del servidor -> inválido con ese mensaje', () => {
    expect(resultadoValidarEnlace(400, { valid: false, message: 'Este enlace venció.' }))
      .toEqual({ valido: false, mensaje: 'Este enlace venció.' });
  });

  it('respuesta sin cuerpo (servidor caído) -> inválido con mensaje genérico', () => {
    expect(resultadoValidarEnlace(500, {})).toEqual({ valido: false, mensaje: MENSAJE_ENLACE_INVALIDO });
  });

  it('429 -> mensaje de demasiados intentos', () => {
    expect(resultadoValidarEnlace(429, { message: 'x' })).toEqual({ valido: false, mensaje: MENSAJE_DEMASIADOS_INTENTOS });
  });

  it('200 sin valid:true no se toma como válido', () => {
    expect(resultadoValidarEnlace(200, {}).valido).toBe(false);
  });
});

describe('resultadoCambioClave (POST /api/reset-password/:token)', () => {
  it('200 -> éxito con el mensaje del servidor', () => {
    expect(resultadoCambioClave(200, { ok: true, message: 'Contraseña actualizada.' }))
      .toEqual({ exito: true, enlaceInvalido: false, mensaje: 'Contraseña actualizada.' });
  });

  it('enlace vencido o usado -> pide enlace nuevo', () => {
    const r = resultadoCambioClave(400, { code: 'ENLACE_INVALIDO', message: 'Este enlace venció, ya fue usado o no es válido. Pide uno nuevo.' });
    expect(r.exito).toBe(false);
    expect(r.enlaceInvalido).toBe(true);
    expect(r.mensaje).toMatch(/Pide uno nuevo/);
  });

  it('contraseña débil -> se queda en el formulario con el mensaje del servidor', () => {
    expect(resultadoCambioClave(400, { message: 'La contraseña debe tener 8 caracteres...' }))
      .toEqual({ exito: false, enlaceInvalido: false, mensaje: 'La contraseña debe tener 8 caracteres...' });
  });

  it('429 -> demasiados intentos', () => {
    expect(resultadoCambioClave(429, {}).mensaje).toBe(MENSAJE_DEMASIADOS_INTENTOS);
  });

  it('error sin mensaje -> texto genérico en español', () => {
    expect(resultadoCambioClave(500, {}).mensaje).toMatch(/No se pudo cambiar la contraseña/);
  });
});

describe('mensajeErrorOlvido (POST /api/forgot-password)', () => {
  it('429 -> demasiados intentos', () => {
    expect(mensajeErrorOlvido(429, {})).toBe(MENSAJE_DEMASIADOS_INTENTOS);
  });

  it('503 -> no disponible (mensaje del servidor o genérico)', () => {
    expect(mensajeErrorOlvido(503, { message: 'No disponible ahora.' })).toBe('No disponible ahora.');
    expect(mensajeErrorOlvido(503, {})).toMatch(/no está disponible/);
  });

  it('otro error -> mensaje del servidor o genérico', () => {
    expect(mensajeErrorOlvido(400, { message: 'El correo no es válido.' })).toBe('El correo no es válido.');
    expect(mensajeErrorOlvido(500, {})).toMatch(/No se pudo procesar/);
  });
});
