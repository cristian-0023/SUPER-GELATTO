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
  const pedir = (...args) => {
    if (!enCurso) {
      // async: la tarea arranca en el acto y un error síncrono también llega como promesa rechazada.
      enCurso = (async () => tarea(...args))().finally(() => { enCurso = null; });
    }
    return enCurso;
  };
  /** La promesa del pedido en vuelo, o null si no hay ninguno. */
  pedir.enVuelo = () => enCurso;
  return pedir;
}

/**
 * Crea un sondeo para `tarea`. Devuelve { iniciar, detener, refrescar }.
 * `documento` permite probarlo sin navegador (null = sin pausa por visibilidad).
 */
export function crearSondeo(tarea, { intervaloMs = INTERVALO_SONDEO_MS, documento = globalThis.document } = {}) {
  const pedir = unaALaVez(tarea);
  let encadenado = null; // pedido forzado esperando a que termine el que está en vuelo
  let temporizador = null;
  let activo = false;

  const visible = () => !documento || documento.visibilityState !== 'hidden';
  // En los tics automáticos un error no debe romper nada: la pantalla ya muestra lo último que tenía.
  const pedirSinRomper = () => pedir({}).catch(() => {});

  // Pide ya. Con forzar: si hay un pedido en vuelo (que pudo salir ANTES del cambio y traer datos viejos),
  // encadena uno nuevo al terminar; varios avisos seguidos comparten ese mismo pedido extra.
  const refrescar = ({ forzar = false, ...opciones } = {}) => {
    const enVuelo = pedir.enVuelo();
    if (!forzar || !enVuelo) return pedir(opciones);
    if (!encadenado) {
      encadenado = enVuelo.catch(() => {}).then(() => {
        encadenado = null;
        return pedir(opciones);
      });
    }
    return encadenado;
  };

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
    /**
     * Pide ya. Sin opciones, si hay una petición en curso devuelve esa. Con { forzar: true } (avisos de que
     * algo cambió) encadena una nueva. Las demás opciones (p. ej. { sinCache: true }) llegan a la tarea.
     */
    refrescar,
  };
}

/** Agrega un parámetro único a la URL para saltarse la caché del navegador y del CDN. */
export function urlSinCache(url, ahora = Date.now()) {
  return `${url}${url.includes('?') ? '&' : '?'}_=${ahora}`;
}

// ─── Aviso entre pestañas: el panel de admin cambió productos ─────────
// El panel escribe esta marca en localStorage después de guardar (res.ok); las demás pestañas reciben el
// evento "storage" y piden el catálogo saltándose la caché.
export const CLAVE_PRODUCTOS_ACTUALIZADOS = 'supergelatto_products_updated';

export function avisarProductosActualizados(almacen = globalThis.localStorage, ahora = Date.now()) {
  try {
    almacen?.setItem(CLAVE_PRODUCTOS_ACTUALIZADOS, String(ahora));
  } catch {
    // localStorage bloqueado (modo privado): las otras pestañas se enterarán en el próximo sondeo.
  }
}

export function esAvisoDeProductos(evento) {
  return evento?.key === CLAVE_PRODUCTOS_ACTUALIZADOS;
}
