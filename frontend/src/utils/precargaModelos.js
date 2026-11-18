// Decide qué modelos 3D se precargan al abrir Home.
// Antes se precargaban los 17 (unos 160 MB). Ahora solo el que se ve por defecto;
// el resto se baja cuando el cliente lo elige.
export function modelosAPrecargar(modelos, idPorDefecto) {
  if (!Array.isArray(modelos) || idPorDefecto == null) return [];
  const elegido = modelos.find((m) => String(m?.id) === String(idPorDefecto));
  return elegido?.file ? [elegido.file] : [];
}
