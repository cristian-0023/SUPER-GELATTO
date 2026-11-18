/**
 * sondeoModelo3D.js — Preguntar al servidor si el modelo 3D de un producto ya está listo.
 * - Cada 3 s mientras Tripo genera; cada 10 s mientras el servidor guarda el modelo en el bucket
 *   ("Guardando el modelo…"): esa copia puede tardar y no hace falta preguntar tan seguido.
 * - Nunca dos consultas a la vez: la siguiente se programa cuando termina la anterior.
 * - Para al llegar "listo" o "error"; a los 50 intentos se rinde con error.
 */

export const INTERVALO_MODELO_MS = 3000;
export const INTERVALO_GUARDANDO_MS = 10000;
export const MAXIMO_INTENTOS_MODELO = 50;
// Mismo texto que manda el servidor (server.js, MENSAJE_GUARDANDO_MODELO).
export const MENSAJE_GUARDANDO_MODELO = 'Guardando el modelo…';

/**
 * consultar: async () => respuesta del servidor ({ estado, message, ... }) o null.
 * Devuelve { detener }.
 */
export function crearSondeoModelo3D({ consultar, alListo, alError }) {
  let detenido = false;
  let reloj = null;
  let intentos = 0;

  const tic = async () => {
    intentos++;
    if (intentos > MAXIMO_INTENTOS_MODELO) {
      alError();
      return;
    }
    let espera = INTERVALO_MODELO_MS;
    try {
      const modelo = await consultar();
      if (detenido) return;
      if (modelo?.estado === 'listo') { alListo(modelo); return; }
      if (modelo?.estado === 'error') { alError(); return; }
      if (modelo?.message === MENSAJE_GUARDANDO_MODELO) espera = INTERVALO_GUARDANDO_MS;
    } catch (err) {
      console.error(err);
    }
    if (!detenido) reloj = setTimeout(tic, espera);
  };

  reloj = setTimeout(tic, INTERVALO_MODELO_MS);
  return {
    detener() {
      detenido = true;
      clearTimeout(reloj);
    },
  };
}
