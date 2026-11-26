// Aviso que debe verse en la página siguiente (por ejemplo, al salir del panel porque la cuenta ya no es
// de administrador: el aviso del panel se iría con él). Se guarda en sessionStorage y se lee una sola vez.
export const CLAVE_AVISO_PENDIENTE = 'superGelatto_aviso_pendiente';
const LARGO_MAXIMO = 300;

export function guardarAvisoPendiente(texto, almacen = globalThis.sessionStorage) {
  if (typeof texto !== 'string' || !texto.trim()) return;
  try {
    almacen?.setItem(CLAVE_AVISO_PENDIENTE, texto.slice(0, LARGO_MAXIMO));
  } catch {
    // Almacenamiento bloqueado (modo privado): el aviso no se verá, pero la salida sigue igual.
  }
}

export function tomarAvisoPendiente(almacen = globalThis.sessionStorage) {
  try {
    const texto = almacen?.getItem(CLAVE_AVISO_PENDIENTE);
    if (texto === null || texto === undefined) return null;
    almacen.removeItem(CLAVE_AVISO_PENDIENTE);
    return texto ? texto.slice(0, LARGO_MAXIMO) : null;
  } catch {
    return null;
  }
}
