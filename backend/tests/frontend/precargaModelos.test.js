// Precarga de modelos 3D (frontend/src/utils/precargaModelos.js): Home NO debe bajar los 17 modelos de golpe.
//  - Con N modelos se precarga como máximo 1: el que se muestra por defecto.
//  - Si el modelo por defecto no está en la lista (o no hay lista), no se precarga nada.
//  - El resto se baja solo cuando el cliente lo elige.
import { describe, it, expect } from 'vitest';
import { modelosAPrecargar } from '../../../frontend/src/utils/precargaModelos.js';

const modelos = [
  { id: 'cone', file: 'cone.glb' },
  { id: 'cup', file: 'cup.glb' },
  { id: 'glass', file: 'glass.glb' },
  { id: 'vanilla', file: 'scoop_vanilla.glb' },
  { id: 'cherry', file: 'topping_cherry.glb' },
];

describe('modelosAPrecargar', () => {
  it('con N modelos precarga como máximo 1', () => {
    for (let n = 0; n <= modelos.length; n++) {
      expect(modelosAPrecargar(modelos.slice(0, n), 'cone').length).toBeLessThanOrEqual(1);
    }
  });

  it('precarga solo el modelo que se muestra por defecto', () => {
    expect(modelosAPrecargar(modelos, 'cone')).toEqual(['cone.glb']);
    expect(modelosAPrecargar(modelos, 'vanilla')).toEqual(['scoop_vanilla.glb']);
  });

  it('si el modelo por defecto no está en la lista, no precarga nada', () => {
    expect(modelosAPrecargar(modelos, 'no-existe')).toEqual([]);
    expect(modelosAPrecargar(modelos)).toEqual([]);
  });

  it('acepta listas vacías o ausentes sin romperse', () => {
    expect(modelosAPrecargar([], 'cone')).toEqual([]);
    expect(modelosAPrecargar(undefined, 'cone')).toEqual([]);
    expect(modelosAPrecargar(null, 'cone')).toEqual([]);
  });

  it('compara el id como texto (los sabores de la base pueden venir con id numérico)', () => {
    const conNumeros = [{ id: 7, file: 'scoop_fresa.glb' }, { id: 8, file: 'scoop_mora.glb' }];
    expect(modelosAPrecargar(conNumeros, '8')).toEqual(['scoop_mora.glb']);
  });

  it('ignora modelos sin archivo', () => {
    expect(modelosAPrecargar([{ id: 'cone' }], 'cone')).toEqual([]);
  });
});
