// Alta de productos del panel (frontend/src/utils/editorProductos.js): cuerpo del POST y fila para la lista.
import { describe, it, expect } from 'vitest';
import { armarCuerpoAlta, productoCreadoParaPanel, IMAGENES_PREDETERMINADAS } from '../../../frontend/src/utils/editorProductos.js';

const FORM = { name: 'Fresa', price: '5000', category: 'Gourmet', description: 'Rica', image: '', featured: false, stock: '12' };

describe('armarCuerpoAlta', () => {
  it('manda los nombres que lee el servidor, con números de verdad', () => {
    expect(armarCuerpoAlta(FORM)).toEqual({
      name: 'Fresa', precio: 5000, categoria: 'Gourmet', descripcion: 'Rica', stock: 12, featured: false,
    });
  });
  it('precio vacío se manda vacío (no 0) para que el servidor lo rechace', () => {
    expect(armarCuerpoAlta({ ...FORM, price: '' }).precio).toBe('');
  });
  it('stock vacío no se manda (el servidor pone 50)', () => {
    expect(armarCuerpoAlta({ ...FORM, stock: '' })).not.toHaveProperty('stock');
  });
  it('imagen vacía o con espacios no se manda (el servidor elige una por el nombre)', () => {
    expect(armarCuerpoAlta({ ...FORM, image: '   ' })).not.toHaveProperty('image');
  });
  it('imagen con valor se manda recortada', () => {
    expect(armarCuerpoAlta({ ...FORM, image: ' /images/gelato_mango.png ' }).image).toBe('/images/gelato_mango.png');
  });
  it('destacado siempre es booleano', () => {
    expect(armarCuerpoAlta({ ...FORM, featured: undefined }).featured).toBe(false);
    expect(armarCuerpoAlta({ ...FORM, featured: true }).featured).toBe(true);
  });
});

describe('productoCreadoParaPanel', () => {
  it('convierte la fila de la base al formato de la lista del panel', () => {
    const fila = { id_producto: 9, nombre: 'Fresa', precio: 5000, stock: 12, descripcion: 'Rica', imagen: '/a.png', categoria: 'Gourmet', estado: true, destacado: true };
    expect(productoCreadoParaPanel(fila)).toEqual({
      id: 9, name: 'Fresa', precio: 5000, price: 5000, stock: 12, desc: 'Rica', categoria: 'Gourmet', image: '/a.png', destacado: true,
    });
  });
});

describe('IMAGENES_PREDETERMINADAS', () => {
  it('son rutas locales que el servidor acepta (empiezan con /images/ y sin "..")', () => {
    expect(IMAGENES_PREDETERMINADAS.length).toBeGreaterThanOrEqual(10);
    for (const { label, url } of IMAGENES_PREDETERMINADAS) {
      expect(typeof label).toBe('string');
      expect(url.startsWith('/images/')).toBe(true);
      expect(url.includes('..')).toBe(false);
    }
  });
});
