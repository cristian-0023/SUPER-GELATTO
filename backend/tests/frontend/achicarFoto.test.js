// achicarFoto (frontend/src/utils/fotoPerfil.js): dibuja la foto en un canvas de 256x256 como máximo y la
// devuelve como dataURL JPEG. Se prueba con fakes mínimos de Image, canvas y URL (sin DOM completo):
//  - si la imagen no carga -> rechaza y libera la URL temporal (revokeObjectURL);
//  - si carga -> canvas con las medidas achicadas, JPEG calidad 0,8, y también libera la URL.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { achicarFoto, CALIDAD_FOTO, TIPO_SALIDA_FOTO } from '../../../frontend/src/utils/fotoPerfil.js';

let imagen; // la última Image creada
let canvas;
let comoCarga; // 'ok' | 'error'
let medidasImagen;

class ImagenFalsa {
  constructor() {
    imagen = this;
  }
  set src(valor) {
    this._src = valor;
    Object.assign(this, medidasImagen);
    queueMicrotask(() => (comoCarga === 'ok' ? this.onload() : this.onerror()));
  }
  get src() {
    return this._src;
  }
}

beforeEach(() => {
  comoCarga = 'ok';
  medidasImagen = { naturalWidth: 4000, naturalHeight: 3000 };
  const ctx = { fillRect: vi.fn(), drawImage: vi.fn() };
  canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn(() => 'data:image/jpeg;base64,AAA') };
  ctx.canvas = canvas;
  vi.stubGlobal('Image', ImagenFalsa);
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:foto-1');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const archivo = { type: 'image/png', size: 1000 };

describe('achicarFoto', () => {
  it('si la imagen no carga -> rechaza y libera la URL temporal', async () => {
    comoCarga = 'error';
    await expect(achicarFoto(archivo)).rejects.toThrow();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:foto-1');
  });

  it('si la imagen trae medidas no válidas -> rechaza y libera la URL', async () => {
    medidasImagen = { naturalWidth: 0, naturalHeight: 0 };
    await expect(achicarFoto(archivo)).rejects.toThrow();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:foto-1');
  });

  it('si carga -> canvas achicado, JPEG calidad 0,8 y URL liberada', async () => {
    const resultado = await achicarFoto(archivo);

    expect(URL.createObjectURL).toHaveBeenCalledWith(archivo);
    expect(imagen.src).toBe('blob:foto-1');
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(192);
    expect(canvas.toDataURL).toHaveBeenCalledWith(TIPO_SALIDA_FOTO, CALIDAD_FOTO);
    expect(resultado).toBe('data:image/jpeg;base64,AAA');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:foto-1');
  });
});
