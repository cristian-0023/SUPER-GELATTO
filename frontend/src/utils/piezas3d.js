// Estado de carga y de error de cada pieza 3D del armador de helados.
// Las piezas que se están bajando se guardan en una lista { clave, texto } que alimenta
// la región role="status" (fuera del Canvas), para que los lectores de pantalla la anuncien.

export function registrarCarga(cargas, clave, texto) {
  const lista = Array.isArray(cargas) ? cargas : [];
  return [...lista.filter((c) => c.clave !== clave), { clave, texto }];
}

export function quitarCarga(cargas, clave) {
  const lista = Array.isArray(cargas) ? cargas : [];
  return lista.filter((c) => c.clave !== clave);
}

export function textoDeCarga(cargas) {
  if (!Array.isArray(cargas) || cargas.length === 0) return '';
  if (cargas.length === 1) return cargas[0].texto;
  return `Cargando ${cargas.length} piezas…`;
}

// Lo que guarda el límite de errores de una pieza cuando su .glb falla.
export function estadoPorError(error) {
  const mensaje = String(error?.message ?? error ?? '');
  return { fallo: true, noEncontrado: /\b404\b|not found/i.test(mensaje) };
}

// Aviso para el cliente: corto y sin detalles internos.
export function textoFallo(nombre) {
  return `No se pudo cargar ${nombre || 'esta pieza'}`;
}
