// Foto de perfil liviana: la foto se guarda dentro del usuario y en localStorage (cupo de ~5 MB),
// así que antes de guardarla se achica en el navegador a 256x256 como máximo (JPEG, calidad 0,8).
// Aquí está la parte pura (validar y calcular medidas); el dibujo en canvas lo hace ProfilePage.

export const LADO_MAXIMO_FOTO = 256;
export const TAMANO_MAXIMO_FOTO = 5 * 1024 * 1024; // 5 MB de entrada
export const CALIDAD_FOTO = 0.8;
export const TIPO_SALIDA_FOTO = 'image/jpeg';

// SVG no: puede traer código y no siempre se dibuja bien en canvas.
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export const MENSAJE_FOTO_TIPO = 'Elige una imagen JPG, PNG, WebP o GIF.';
export const MENSAJE_FOTO_GRANDE = 'La imagen pesa más de 5 MB. Elige una más liviana.';

export function validarFotoPerfil(archivo) {
  if (!archivo || !TIPOS_FOTO.includes(archivo.type)) return { ok: false, mensaje: MENSAJE_FOTO_TIPO };
  if (!(archivo.size > 0)) return { ok: false, mensaje: MENSAJE_FOTO_TIPO };
  if (archivo.size > TAMANO_MAXIMO_FOTO) return { ok: false, mensaje: MENSAJE_FOTO_GRANDE };
  return { ok: true };
}

// Medidas que caben en ladoMaximo x ladoMaximo manteniendo la proporción. No agranda fotos pequeñas.
// Medidas no válidas -> null.
export function medidasAchicadas(ancho, alto, ladoMaximo = LADO_MAXIMO_FOTO) {
  if (!Number.isFinite(ancho) || !Number.isFinite(alto) || ancho <= 0 || alto <= 0) return null;
  const escala = Math.min(1, ladoMaximo / Math.max(ancho, alto));
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  };
}

// Dibuja la foto en un canvas a 256x256 como máximo (misma proporción) y la devuelve como dataURL JPEG.
// Fondo blanco: un PNG transparente no queda negro al pasarlo a JPEG. Solo funciona en el navegador.
export const achicarFoto = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    const medidas = medidasAchicadas(img.naturalWidth, img.naturalHeight);
    const ctx = medidas && document.createElement('canvas').getContext('2d');
    if (!ctx) return reject(new Error('No se pudo dibujar la imagen.'));
    ctx.canvas.width = medidas.ancho;
    ctx.canvas.height = medidas.alto;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, medidas.ancho, medidas.alto);
    ctx.drawImage(img, 0, 0, medidas.ancho, medidas.alto);
    resolve(ctx.canvas.toDataURL(TIPO_SALIDA_FOTO, CALIDAD_FOTO));
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Imagen no válida.'));
  };
  img.src = url;
});
