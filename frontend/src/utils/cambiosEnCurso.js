// Cambios rápidos del panel (por ahora, Ocultar / Mostrar en la tienda) con varios PUT en vuelo.
import { decidirTrasGuardar } from './edicionRapida.js';

// Ids con un PUT en curso: un segundo clic sobre el mismo producto se ignora hasta que llegue la respuesta.
// (Vive en un useRef del panel: no necesita volver a pintar la pantalla.)
export function crearPendientes() {
  const enVuelo = new Set();
  return {
    empezar(id) {
      const clave = String(id);
      if (enVuelo.has(clave)) return false;
      enVuelo.add(clave);
      return true;
    },
    terminar(id) { enVuelo.delete(String(id)); },
    enCurso(id) { return enVuelo.has(String(id)); },
  };
}

// Vuelve al valor anterior SOLO si el producto sigue con el valor optimista: si mientras tanto llegó uno
// más nuevo (otro cambio o una recarga), no se pisa. No muta la lista.
export function revertirSiNoCambio(productos, idProducto, campo, valorOptimista, valorAnterior) {
  return (productos || []).map((p) => (
    String(p.id) === String(idProducto) && p[campo] === valorOptimista ? { ...p, [campo]: valorAnterior } : p
  ));
}

// Qué queda en pantalla y qué aviso mostrar cuando responde el PUT de visibilidad.
// siguiente = el estado que se aplicó de forma optimista. mensajeServidor = el "message" de la respuesta.
// Devuelve { productos, decision: 'ok' | 'sesion' | 'revertir', aviso: { texto, tipo } | null }.
export function resolverCambioVisibilidad(productos, idProducto, siguiente, respuesta, mensajeServidor) {
  const decision = decidirTrasGuardar(respuesta);
  if (decision === 'ok') {
    const texto = siguiente ? 'El producto ya se muestra en la tienda.' : 'Producto oculto: la tienda y Gelbot ya no lo ofrecen.';
    return { productos, decision, aviso: { texto, tipo: 'success' } };
  }
  const revertidos = revertirSiNoCambio(productos, idProducto, 'estado', siguiente, !siguiente);
  if (decision === 'sesion') return { productos: revertidos, decision, aviso: null };
  const porDefecto = respuesta ? 'No se pudo cambiar la visibilidad del producto.' : 'Error de conexión al cambiar la visibilidad del producto.';
  const texto = typeof mensajeServidor === 'string' && mensajeServidor.trim() ? mensajeServidor : porDefecto;
  return { productos: revertidos, decision, aviso: { texto, tipo: 'error' } };
}

// Si la fila desaparece al ocultarla (filtro "Mostrar ocultos" apagado), el foco va a la fila siguiente,
// o a la anterior si era la última; null = no queda ninguna (el panel lo lleva al título).
export function focoTrasOcultar(idsVisibles, idProducto) {
  const lista = idsVisibles || [];
  const i = lista.findIndex((id) => String(id) === String(idProducto));
  if (i === -1) return null;
  if (i + 1 < lista.length) return lista[i + 1];
  return i > 0 ? lista[i - 1] : null;
}
