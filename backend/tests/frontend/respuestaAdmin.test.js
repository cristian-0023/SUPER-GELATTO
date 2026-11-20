// Decisión del panel de administración ante una respuesta que no salió bien (frontend/src/utils/respuestaAdmin.js).
// En el panel de datos y en la consulta del modelo 3D, el único 403 posible es "ya no eres administrador":
// el panel borra la sesión, avisa y sale a la portada en vez de quedarse trabado.
import { describe, it, expect } from 'vitest';
import { decidirAnteErrorPanel, mensajeDeError } from '../../../frontend/src/utils/respuestaAdmin.js';

describe('decidirAnteErrorPanel', () => {
  it('401 -> sesion-vencida (apiFetch ya manda a /login)', () => {
    expect(decidirAnteErrorPanel(401)).toBe('sesion-vencida');
  });

  it('403 -> sin-permiso (la sesión ya no es de administrador: salir del panel)', () => {
    expect(decidirAnteErrorPanel(403)).toBe('sin-permiso');
  });

  it('errores del servidor (500, 503) -> reintentable', () => {
    expect(decidirAnteErrorPanel(500)).toBe('reintentable');
    expect(decidirAnteErrorPanel(503)).toBe('reintentable');
  });

  it('otros errores (400, 404) -> error (se avisa y no se reintenta)', () => {
    expect(decidirAnteErrorPanel(400)).toBe('error');
    expect(decidirAnteErrorPanel(404)).toBe('error');
  });
});

describe('mensajeDeError', () => {
  it('usa el mensaje del servidor si viene', () => {
    expect(mensajeDeError({ message: 'Se requieren permisos de administrador.' }, 'x')).toBe('Se requieren permisos de administrador.');
  });

  it('sin mensaje (o vacío, o cuerpo nulo) usa el texto por defecto', () => {
    expect(mensajeDeError({}, 'Por defecto')).toBe('Por defecto');
    expect(mensajeDeError({ message: '  ' }, 'Por defecto')).toBe('Por defecto');
    expect(mensajeDeError(null, 'Por defecto')).toBe('Por defecto');
  });
});
