// Modelos 3D de la heladería (frontend/public/360/*.glb): deben estar COMPRIMIDOS para que Home no baje 160 MB.
//  - Geometría con meshopt (EXT_meshopt_compression): three-stdlib trae el decodificador incluido, sin CDN.
//  - Texturas en WebP (EXT_texture_webp) de 2048 px como máximo.
//  - Cada archivo pesa 3 MB o menos y el total 40 MB o menos (MB = 1.000.000 bytes).
// Se lee solo el encabezado JSON de cada GLB; no hace falta ninguna librería 3D.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CARPETA = path.resolve(__dirname, '../../../frontend/public/360');
const MB = 1_000_000;
const MAX_POR_ARCHIVO = 3 * MB;
const MAX_TOTAL = 40 * MB;
const MAX_LADO_TEXTURA = 2048;

// GLB = encabezado de 12 bytes + bloque JSON (largo + tipo + datos) + bloque binario.
function leerGlb(ruta) {
  const buf = fs.readFileSync(ruta);
  if (buf.toString('ascii', 0, 4) !== 'glTF') throw new Error(`${ruta} no es un GLB`);
  const largoJson = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + largoJson));
  const binario = buf.subarray(20 + largoJson + 8);
  return { tamano: buf.length, json, binario };
}

// Ancho y alto de una imagen WebP leyendo su cabecera (VP8, VP8L o VP8X).
function medidasWebp(b) {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null;
  const tipo = b.toString('ascii', 12, 16);
  if (tipo === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (tipo === 'VP8L') { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
  if (tipo === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  return null;
}

const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.glb')).sort();

describe('modelos 3D comprimidos (frontend/public/360)', () => {
  it('existen los 17 modelos que usa el armador de helados', () => {
    expect(archivos).toHaveLength(17);
  });

  it(`el total pesa ${MAX_TOTAL / MB} MB o menos`, () => {
    const total = archivos.reduce((s, f) => s + fs.statSync(path.join(CARPETA, f)).size, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL);
  });

  describe.each(archivos)('%s', (archivo) => {
    const { tamano, json, binario } = leerGlb(path.join(CARPETA, archivo));

    it(`pesa ${MAX_POR_ARCHIVO / MB} MB o menos`, () => {
      expect(tamano).toBeLessThanOrEqual(MAX_POR_ARCHIVO);
    });

    it('usa compresión meshopt en la geometría', () => {
      expect(json.extensionsUsed || []).toContain('EXT_meshopt_compression');
      const comprimidas = (json.bufferViews || []).filter((bv) => bv.extensions?.EXT_meshopt_compression);
      expect(comprimidas.length).toBeGreaterThan(0);
    });

    it('no usa Draco (su decodificador se bajaría de un CDN)', () => {
      expect(json.extensionsUsed || []).not.toContain('KHR_draco_mesh_compression');
    });

    it('todas las texturas son WebP de 2048 px como máximo', () => {
      const imagenes = json.images || [];
      expect(imagenes.length).toBeGreaterThan(0);
      for (const img of imagenes) {
        expect(img.mimeType).toBe('image/webp');
        const bv = json.bufferViews[img.bufferView];
        const inicio = bv.byteOffset || 0;
        const medidas = medidasWebp(binario.subarray(inicio, inicio + bv.byteLength));
        expect(medidas).not.toBeNull();
        expect(Math.max(...medidas)).toBeLessThanOrEqual(MAX_LADO_TEXTURA);
      }
      for (const tex of json.textures || []) {
        expect(tex.extensions?.EXT_texture_webp).toBeDefined();
      }
    });
  });
});
