// Utilidades del editor de productos (frontend/src/utils/editorProductos.js).
import { describe, it, expect } from 'vitest';
import { armarCuerpoProducto, mapearProductoGuardado } from '../../../frontend/src/utils/editorProductos.js';

const ORIGINAL = { name: 'Fresa', precio: 5000, stock: 3, categoria: 'Clásico', desc: 'Rica' };

describe('armarCuerpoProducto (solo lo que cambió)', () => {
  it('editar solo el nombre no manda stock ni precio', () => {
    const cuerpo = armarCuerpoProducto({ ...ORIGINAL, name: 'Fresa nueva' }, ORIGINAL);
    expect(cuerpo).toEqual({ name: 'Fresa nueva' });
  });

  it('el stock viaja solo si cambió, como número', () => {
    expect(armarCuerpoProducto({ ...ORIGINAL, stock: '8' }, ORIGINAL)).toEqual({ stock: 8 });
  });

  it('manda descripcion (no desc)', () => {
    const cuerpo = armarCuerpoProducto({ ...ORIGINAL, desc: 'Otra' }, ORIGINAL);
    expect(cuerpo).toEqual({ descripcion: 'Otra' });
    expect(cuerpo).not.toHaveProperty('desc');
  });

  it('sin cambios devuelve un objeto vacío', () => {
    expect(armarCuerpoProducto({ ...ORIGINAL, precio: '5000' }, ORIGINAL)).toEqual({});
  });

  it('un precio vacío no se convierte en 0: se manda vacío para que el servidor lo rechace', () => {
    expect(armarCuerpoProducto({ ...ORIGINAL, precio: '' }, ORIGINAL)).toEqual({ precio: '' });
  });
});

describe('mapearProductoGuardado', () => {
  it('usa lo que respondió el servidor', () => {
    const fila = { id_producto: 7, nombre: 'Fresa', precio: 5000, stock: 9, descripcion: 'Rica', categoria: 'Gourmet', imagen: '/a.png' };
    expect(mapearProductoGuardado(fila)).toEqual({ name: 'Fresa', precio: 5000, price: 5000, stock: 9, desc: 'Rica', categoria: 'Gourmet', image: '/a.png' });
  });
});
