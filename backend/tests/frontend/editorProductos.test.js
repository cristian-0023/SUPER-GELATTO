// Utilidades del editor de productos (frontend/src/utils/editorProductos.js).
import { describe, it, expect } from 'vitest';
import { armarCuerpoProducto, revertirStock } from '../../../frontend/src/utils/editorProductos.js';

describe('armarCuerpoProducto', () => {
  it('manda descripcion (no desc) y convierte precio y stock a número', () => {
    const cuerpo = armarCuerpoProducto({ name: 'Fresa', precio: '5000', stock: '3', categoria: 'Clásico', desc: 'Rica' });
    expect(cuerpo).toEqual({ name: 'Fresa', precio: 5000, stock: 3, categoria: 'Clásico', descripcion: 'Rica' });
    expect(cuerpo).not.toHaveProperty('desc');
  });

  it('sin descripción manda texto vacío', () => {
    expect(armarCuerpoProducto({ name: 'a', precio: 1, stock: 0, categoria: 'x' }).descripcion).toBe('');
  });
});

describe('revertirStock', () => {
  const lista = [{ id: 1, stock: 9 }, { id: 2, stock: 4 }];

  it('devuelve el stock anterior solo del producto indicado, sin mutar la lista', () => {
    const res = revertirStock(lista, 1, 3);
    expect(res).toEqual([{ id: 1, stock: 3 }, { id: 2, stock: 4 }]);
    expect(lista[0].stock).toBe(9);
  });
});
