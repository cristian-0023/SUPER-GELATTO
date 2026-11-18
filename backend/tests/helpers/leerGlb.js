// Lector mínimo de archivos GLB para las pruebas: valida la estructura y falla con un mensaje claro.
// Formato: encabezado de 12 bytes ('glTF', versión, largo total) + bloque JSON + bloque BIN opcional.
const TIPO_JSON = 0x4e4f534a; // 'JSON'
const TIPO_BIN = 0x004e4942;  // 'BIN\0'

export function leerGlb(buf, nombre = 'el archivo') {
  if (buf.length < 20) throw new Error(`${nombre} es demasiado corto para ser un GLB (${buf.length} bytes)`);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${nombre} no es un GLB: falta la marca 'glTF' al inicio`);
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`${nombre}: versión de GLB ${version} no soportada (se espera 2)`);
  const largoDeclarado = buf.readUInt32LE(8);
  if (largoDeclarado !== buf.length) {
    throw new Error(`${nombre}: el largo declarado (${largoDeclarado}) no coincide con el tamaño del archivo (${buf.length})`);
  }
  const largoJson = buf.readUInt32LE(12);
  const tipoJson = buf.readUInt32LE(16);
  if (tipoJson !== TIPO_JSON) throw new Error(`${nombre}: el primer bloque no es JSON (tipo 0x${tipoJson.toString(16)})`);
  const finJson = 20 + largoJson;
  if (finJson > buf.length) throw new Error(`${nombre}: el bloque JSON se sale del archivo`);
  const json = JSON.parse(buf.toString('utf8', 20, finJson));

  let binario = Buffer.alloc(0);
  if (finJson < buf.length) {
    if (finJson + 8 > buf.length) throw new Error(`${nombre}: encabezado del bloque BIN incompleto`);
    const largoBin = buf.readUInt32LE(finJson);
    const tipoBin = buf.readUInt32LE(finJson + 4);
    if (tipoBin !== TIPO_BIN) throw new Error(`${nombre}: el segundo bloque no es BIN (tipo 0x${tipoBin.toString(16)})`);
    if (finJson + 8 + largoBin > buf.length) throw new Error(`${nombre}: el bloque BIN se sale del archivo`);
    binario = buf.subarray(finJson + 8, finJson + 8 + largoBin);
  }
  return { tamano: buf.length, json, binario };
}

// Ancho y alto de una imagen WebP leyendo su cabecera (VP8, VP8L o VP8X). null si no es un WebP reconocible.
export function medidasWebp(b) {
  if (b.length < 30 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const tipo = b.toString('ascii', 12, 16);
  if (tipo === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null; // marca de inicio del cuadro VP8
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }
  if (tipo === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (tipo === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return null;
}
