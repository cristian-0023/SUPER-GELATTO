/**
 * sondeo.js — Pedir datos al servidor cada cierto tiempo sin saturarlo.
 * - Intervalo de 30 s (antes había pantallas que pedían cada 2-3 s).
 * - Se pausa mientras la pestaña está oculta y refresca apenas vuelve a verse.
 * - Nunca hay dos peticiones iguales a la vez: si una sigue en curso, se reutiliza.
 */

export const INTERVALO_SONDEO_MS = 30000;

/** Envuelve una tarea asíncrona para que, mientras una llamada está en curso, las demás reciban esa misma promesa. */
export function unaALaVez(tarea) {
  let enCurso = null;
  return (...args) => {
    if (!enCurso) {
      // async: la tarea arranca en el acto y un error síncrono también llega como promesa rechazada.
      enCurso = (async () => tarea(...args))().finally(() => { enCurso = null; });
    }
    return enCurso;
  };
}

/**
 * Crea un sondeo para `tarea`. Devuelve { iniciar, detener, refrescar }.
 * `documento` permite probarlo sin navegador (null = sin pausa por visibilidad).
 */
export function crearSondeo(tarea, { intervaloMs = INTERVALO_SONDEO_MS, documento = globalThis.document } = {}) {
  const pedir = unaALaVez(tarea);
  let temporizador = null;
  let activo = false;

  const visible = () => !documento || documento.visibilityState !== 'hidden';
  // En los tics automáticos un error no debe romper nada: la pantalla ya muestra lo último que tenía.
  const pedirSinRomper = () => pedir().catch(() => {});

  const programar = () => {
    clearInterval(temporizador);
    temporizador = setInterval(pedirSinRomper, intervaloMs);
  };
  const pausar = () => {
    clearInterval(temporizador);
    temporizador = null;
  };

  const alCambiarVisibilidad = () => {
    if (!activo) return;
    if (visible()) {
      pedirSinRomper();
      programar();
    } else {
      pausar();
    }
  };

  return {
    iniciar() {
      if (activo) return;
      activo = true;
      documento?.addEventListener?.('visibilitychange', alCambiarVisibilidad);
      if (visible()) {
        pedirSinRomper();
        programar();
      }
    },
    detener() {
      activo = false;
      pausar();
      documento?.removeEventListener?.('visibilitychange', alCambiarVisibilidad);
    },
    /** Pide ya (por ejemplo, tras guardar un cambio). Si hay una petición en curso, devuelve esa. */
    refrescar: pedir,
  };
}

/** Agrega un parámetro único a la URL para saltarse la caché del navegador y del CDN. */
export function urlSinCache(url, ahora = Date.now()) {
  return `${url}${url.includes('?') ? '&' : '?'}_=${ahora}`;
}
