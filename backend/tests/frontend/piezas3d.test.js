// Estado de cada pieza 3D del armador (frontend/src/utils/piezas3d.js).
//  - Lista de piezas que se están cargando: alimenta la región role="status" fuera del Canvas.
//  - Si un .glb falla (por ejemplo, 404), esa pieza muestra un aviso y el resto sigue visible.
import { describe, it, expect } from 'vitest';
import { registrarCarga, quitarCarga, textoDeCarga, estadoPorError, textoFallo } from '../../../frontend/src/utils/piezas3d.js';

describe('cargas de piezas', () => {
  it('registrar agrega la pieza sin modificar la lista original', () => {
    const vacia = [];
    const una = registrarCarga(vacia, 'scoop-0', 'Cargando Mango…');
    expect(una).toEqual([{ clave: 'scoop-0', texto: 'Cargando Mango…' }]);
    expect(vacia).toEqual([]);
  });

  it('registrar la misma pieza dos veces no la duplica', () => {
    let l = registrarCarga([], 'scoop-0', 'Cargando Mango…');
    l = registrarCarga(l, 'scoop-0', 'Cargando Mango…');
    expect(l).toHaveLength(1);
  });

  it('quitar saca solo esa pieza', () => {
    let l = registrarCarga([], 'scoop-0', 'Cargando Mango…');
    l = registrarCarga(l, 'topping-0', 'Cargando Cereza…');
    expect(quitarCarga(l, 'scoop-0')).toEqual([{ clave: 'topping-0', texto: 'Cargando Cereza…' }]);
    expect(quitarCarga(l, 'no-existe')).toHaveLength(2);
  });

  it('el texto de estado está vacío si no carga nada', () => {
    expect(textoDeCarga([])).toBe('');
    expect(textoDeCarga(undefined)).toBe('');
  });

  it('con una pieza muestra su texto; con varias, cuántas faltan', () => {
    const una = registrarCarga([], 'scoop-0', 'Cargando Mango…');
    expect(textoDeCarga(una)).toBe('Cargando Mango…');
    const dos = registrarCarga(una, 'topping-0', 'Cargando Cereza…');
    expect(textoDeCarga(dos)).toBe('Cargando 2 piezas…');
  });
});

describe('errores de piezas', () => {
  it('cualquier error marca la pieza como fallida', () => {
    expect(estadoPorError(new Error('boom')).fallo).toBe(true);
    expect(estadoPorError(undefined).fallo).toBe(true);
  });

  it('distingue un archivo que no existe (404)', () => {
    expect(estadoPorError(new Error('fetch for "/360/x.glb" responded with 404: Not Found')).noEncontrado).toBe(true);
    expect(estadoPorError(new Error('Unexpected token')).noEncontrado).toBe(false);
  });

  it('el aviso es corto, en español y sin detalles internos', () => {
    expect(textoFallo('Mango')).toBe('No se pudo cargar Mango');
    expect(textoFallo()).toBe('No se pudo cargar esta pieza');
    expect(textoFallo('Mango')).not.toMatch(/404|glb|error/i);
  });
});
