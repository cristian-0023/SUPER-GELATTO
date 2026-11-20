// Tarjetas de helados del chat Gelbot. El servidor manda `productos` (datos de la base) y aquí se vuelven
// a validar antes de mostrarlos: id y precio válidos, nombre recortado y foto segura (https o ruta local).

export const FOTO_POR_DEFECTO = '/images/gelato_berries.png';
export const MAX_TARJETAS = 12;
const MAX_LARGO_NOMBRE = 80;

// Misma regla que el servidor (backend/imagenProducto.js): ruta local "/..." sin "//" ni "..", o https sin usuario.
export function fotoSegura(valor) {
  if (typeof valor !== 'string') return FOTO_POR_DEFECTO;
  const img = valor.trim();
  if (!img || img.length > 2048 || /[\\\u0000-\u001f\u007f]/.test(img)) return FOTO_POR_DEFECTO;
  if (img.startsWith('/')) return img.startsWith('//') || img.includes('..') ? FOTO_POR_DEFECTO : img;
  try {
    const url = new URL(img);
    if (url.username || url.password || url.protocol !== 'https:') return FOTO_POR_DEFECTO;
    return url.href;
  } catch {
    return FOTO_POR_DEFECTO;
  }
}

export const formatearCOP = (valor) => '$' + new Intl.NumberFormat('es-CO').format(valor);

export function armarTarjetasProductos(productos) {
  if (!Array.isArray(productos)) return [];
  const tarjetas = [];
  for (const p of productos) {
    if (tarjetas.length >= MAX_TARJETAS) break;
    if (!p || typeof p !== 'object') continue;
    const id = Number(p.id);
    const precio = Number(p.precio);
    const nombre = typeof p.nombre === 'string' ? p.nombre.trim().slice(0, MAX_LARGO_NOMBRE) : '';
    if (!Number.isInteger(id) || id <= 0 || !nombre || !Number.isFinite(precio) || precio <= 0) continue;
    tarjetas.push({ id, nombre, precio, precioTexto: formatearCOP(precio), image: fotoSegura(p.image) });
  }
  return tarjetas;
}

// Lo que recibe addToCart del carrito.
export function productoDeTarjeta(tarjeta) {
  return { id: tarjeta.id, nombre: tarjeta.nombre, precio: tarjeta.precio, image: tarjeta.image };
}
