// Lógica pura de "Olvidé mi contraseña": traduce la respuesta del servidor (código HTTP + cuerpo) a lo
// que la pantalla muestra. Sin React ni fetch, para poder probarla sola.

export const MENSAJE_ENLACE_INVALIDO = 'Este enlace venció, ya fue usado o no es válido. Pide uno nuevo.';
export const MENSAJE_DEMASIADOS_INTENTOS = 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';

// Lee la respuesta como JSON sin romperse si el servidor devolvió otra cosa (por ejemplo, una caída).
export const leerJson = (res) => res.json().catch(() => ({}));

// GET /api/reset-password/:token -> { valido, mensaje }
export function resultadoValidarEnlace(status, data = {}) {
  if (status === 200 && data.valid === true) return { valido: true, mensaje: '' };
  if (status === 429) return { valido: false, mensaje: MENSAJE_DEMASIADOS_INTENTOS };
  return { valido: false, mensaje: data.message || MENSAJE_ENLACE_INVALIDO };
}

// POST /api/reset-password/:token -> { exito, enlaceInvalido, mensaje }
// enlaceInvalido: el enlace venció o ya se usó (hay que pedir otro), no es culpa de la contraseña.
export function resultadoCambioClave(status, data = {}) {
  if (status >= 200 && status < 300) {
    return { exito: true, enlaceInvalido: false, mensaje: data.message || 'Contraseña actualizada correctamente.' };
  }
  if (status === 429) return { exito: false, enlaceInvalido: false, mensaje: MENSAJE_DEMASIADOS_INTENTOS };
  if (data.code === 'ENLACE_INVALIDO') {
    return { exito: false, enlaceInvalido: true, mensaje: data.message || MENSAJE_ENLACE_INVALIDO };
  }
  return { exito: false, enlaceInvalido: false, mensaje: data.message || 'No se pudo cambiar la contraseña. Inténtalo de nuevo.' };
}

// POST /api/forgot-password con error -> mensaje para la persona
export function mensajeErrorOlvido(status, data = {}) {
  if (status === 429) return MENSAJE_DEMASIADOS_INTENTOS;
  if (status === 503) return data.message || 'La recuperación de contraseña no está disponible en este momento. Inténtalo más tarde.';
  return data.message || 'No se pudo procesar la solicitud. Inténtalo de nuevo.';
}
