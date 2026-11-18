// Edición rápida de la tabla de productos del panel (precio, stock y categoría en línea).

// Lee un entero SIN truncar decimales (parseInt convertía 1.5 en 1 y "12abc" en 12).
// Devuelve { valor } o { error } con el texto para el aviso.
export function leerEntero(entrada, minimo) {
  const esTextoConContenido = typeof entrada === 'string' && entrada.trim() !== '';
  const numero = typeof entrada === 'number' || esTextoConContenido ? Number(entrada) : NaN;
  if (!Number.isInteger(numero)) return { error: 'Debe ser un número entero.' };
  if (numero < minimo) {
    return { error: minimo > 0 ? 'Debe ser un número entero mayor que 0.' : 'Debe ser un número entero mayor o igual a 0.' };
  }
  return { valor: numero };
}

// Qué hacer después de guardar: 'ok' (se queda el cambio), 'sesion' (sesión vencida: se revierte y
// se pide verificar de nuevo) o 'revertir' (error del servidor o de conexión: se vuelve al valor anterior).
export function decidirTrasGuardar(respuesta) {
  if (respuesta && respuesta.ok) return 'ok';
  if (respuesta && respuesta.status === 401) return 'sesion';
  return 'revertir';
}

// Lista de productos con los cambios aplicados a uno (sin mutar la original).
export function cambiarProducto(productos, idProducto, cambios) {
  return (productos || []).map(p => (String(p.id) === String(idProducto) ? { ...p, ...cambios } : p));
}
