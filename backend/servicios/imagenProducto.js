// Valida la URL de la imagen de un producto. La usan server.js (al guardarla) y chatbot.js (al mostrarla
// en las tarjetas de Gelbot). Devuelve la URL limpia o null si no es segura.
// Solo se aceptan rutas locales ("/images/...") o enlaces https sin usuario ni clave.
function imagenProductoValida(valor) {
  if (typeof valor !== 'string') return null;
  const img = valor.trim();
  if (img.length < 1 || img.length > 2048) return null;
  // Los espacios normales sí valen (hay imágenes como "caramelo salado.png"); no los controles ni "\".
  if (/[\\\u0000-\u001f\u007f]/.test(img)) return null;
  if (img.startsWith('/')) {
    return img.startsWith('//') || img.includes('..') ? null : img;
  }
  try {
    const url = new URL(img);
    // Con usuario o clave (https://user:pass@...) se podría engañar a quien mira el enlace o filtrar datos.
    if (url.username || url.password) return null;
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

module.exports = { imagenProductoValida };
