// Ocultar / Mostrar un producto en la tienda desde el panel de admin (columna producto.estado).
// La tienda y Gelbot solo muestran los productos visibles; el panel los lista todos.

// El borrado de un producto con ventas responde 409 (la base lo protege): el aviso ofrece la salida.
export const MENSAJE_BORRADO_CON_VENTAS = 'Este producto tiene ventas registradas y no se puede borrar. Puedes ocultarlo de la tienda.';

// Visible salvo que estado sea false. Un producto recién creado no trae estado: la base lo crea visible.
export function estaVisible(producto) {
  return Boolean(producto) && producto.estado !== false;
}

export function textoBotonVisibilidad(producto) {
  return estaVisible(producto) ? 'Ocultar de la tienda' : 'Mostrar en la tienda';
}

// Lista del panel: todos, o solo los visibles si el filtro "Mostrar ocultos" está apagado.
export function filtrarProductosPanel(productos, mostrarOcultos) {
  const lista = productos || [];
  return mostrarOcultos ? lista : lista.filter(estaVisible);
}

export function contarOcultos(productos) {
  return (productos || []).filter((p) => !estaVisible(p)).length;
}

// Aviso cuando el borrado falla: { texto, ofrecerOcultar }. Solo el 409 por ventas ofrece el botón "Ocultar".
export function avisoTrasBorrar(status, data) {
  const mensaje = typeof data?.message === 'string' && data.message.trim() ? data.message : '';
  if (status === 409 && /ventas/i.test(mensaje)) return { texto: MENSAJE_BORRADO_CON_VENTAS, ofrecerOcultar: true };
  return { texto: mensaje || 'Error al eliminar producto', ofrecerOcultar: false };
}
