// Lector de GLB de las pruebas (tests/helpers/leerGlb.js): debe rechazar archivos dañados con un mensaje claro
// en lugar de leer basura. Se arman GLB pequeños a mano para cada caso.
import { describe, it, expect } from 'vitest';
import { leerGlb, medidasWebp } from '../helpers/leerGlb.js';

const JSON_TIPO = 0x4e4f534a; // 'JSON'
const BIN_TIPO = 0x004e4942;  // 'BIN\0'

function rellenar(buf, relleno) {
  const resto = buf.length % 4;
  return resto ? Buffer.concat([buf, Buffer.alloc(4 - resto, relleno)]) : buf;
}

// Arma un GLB válido y deja cambiar cada campo para romperlo a propósito.
function armarGlb({ magia = 'glTF', version = 2, largoTotal, tipoJson = JSON_TIPO, tipoBin = BIN_TIPO, json = { asset: { version: '2.0' } }, bin = Buffer.from([1, 2, 3, 4]), sinBin = false, recortar = 0 } = {}) {
  const datosJson = rellenar(Buffer.from(JSON.stringify(json)), 0x20);
  const partes = [];
  const cabJson = Buffer.alloc(8); cabJson.writeUInt32LE(datosJson.length, 0); cabJson.writeUInt32LE(tipoJson, 4);
  partes.push(cabJson, datosJson);
  if (!sinBin) {
    const datosBin = rellenar(bin, 0);
    const cabBin = Buffer.alloc(8); cabBin.writeUInt32LE(datosBin.length, 0); cabBin.writeUInt32LE(tipoBin, 4);
    partes.push(cabBin, datosBin);
  }
  const cuerpo = Buffer.concat(partes);
  const cab = Buffer.alloc(12);
  cab.write(magia, 0, 'ascii');
  cab.writeUInt32LE(version, 4);
  cab.writeUInt32LE(largoTotal ?? 12 + cuerpo.length, 8);
  const total = Buffer.concat([cab, cuerpo]);
  return recortar ? total.subarray(0, total.length - recortar) : total;
}

describe('leerGlb', () => {
  it('lee un GLB válido: JSON y bloque binario', () => {
    const r = leerGlb(armarGlb({ json: { asset: { version: '2.0' }, hola: 1 } }));
    expect(r.json.hola).toBe(1);
    expect([...r.binario.subarray(0, 4)]).toEqual([1, 2, 3, 4]);
  });

  it('acepta un GLB sin bloque binario', () => {
    const r = leerGlb(armarGlb({ sinBin: true }));
    expect(r.binario.length).toBe(0);
  });

  it('rechaza un archivo que no empieza con la marca glTF', () => {
    expect(() => leerGlb(armarGlb({ magia: 'gLTX' }))).toThrow(/no es un GLB/i);
  });

  it('rechaza versiones distintas de 2', () => {
    expect(() => leerGlb(armarGlb({ version: 1 }))).toThrow(/versión/i);
  });

  it('rechaza si el largo declarado no coincide con el tamaño del archivo', () => {
    expect(() => leerGlb(armarGlb({ largoTotal: 9999 }))).toThrow(/largo/i);
    expect(() => leerGlb(armarGlb({ recortar: 4 }))).toThrow(/largo/i);
  });

  it('rechaza si el primer bloque no es JSON', () => {
    expect(() => leerGlb(armarGlb({ tipoJson: 0x12345678 }))).toThrow(/JSON/);
  });

  it('rechaza si el segundo bloque no es BIN', () => {
    expect(() => leerGlb(armarGlb({ tipoBin: 0x12345678 }))).toThrow(/BIN/);
  });

  it('rechaza archivos demasiado cortos', () => {
    expect(() => leerGlb(Buffer.from('glTF'))).toThrow(/corto/i);
  });
});

describe('medidasWebp', () => {
  // WebP con perdida (VP8): RIFF + WEBP + 'VP8 ' + tamaño + 3 bytes de cuadro + marca 9d 01 2a + ancho/alto.
  function webpVp8(ancho, alto, marca = [0x9d, 0x01, 0x2a]) {
    const b = Buffer.alloc(30);
    b.write('RIFF', 0, 'ascii'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'ascii'); b.write('VP8 ', 12, 'ascii');
    b.writeUInt32LE(10, 16);
    b[23] = marca[0]; b[24] = marca[1]; b[25] = marca[2];
    b.writeUInt16LE(ancho, 26); b.writeUInt16LE(alto, 28);
    return b;
  }

  it('lee ancho y alto de un WebP VP8 con su marca de inicio', () => {
    expect(medidasWebp(webpVp8(2048, 1024))).toEqual([2048, 1024]);
  });

  it('devuelve null si al VP8 le falta la marca 9d 01 2a', () => {
    expect(medidasWebp(webpVp8(2048, 2048, [0, 0, 0]))).toBeNull();
  });

  it('devuelve null si no es WebP', () => {
    expect(medidasWebp(Buffer.from('no es una imagen webp para nada'))).toBeNull();
  });
});
