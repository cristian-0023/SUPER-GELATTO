// La ficha de cada sabor vive en su propio módulo. /api/products responde EXACTAMENTE lo mismo que antes
// (la foto se tomó antes de mover los datos); solo el chat exige que la ficha sea del producto.
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';
import { cargarServidor } from '../helpers/cargarServidor.js';
import { CATALOGO_REAL, FICHAS } from '../helpers/catalogoReal.js';

const ruta = new URL('../../datosSabores.js', import.meta.url);
const cargar = () => {
  expect(existsSync(ruta)).toBe(true);
  return createRequire(import.meta.url)('../../datosSabores.js');
};

describe('/api/products no cambia al mover las fichas', () => {
  it('la respuesta completa es idéntica (catálogo real, coincidencias parciales y nombres raros)', async () => {
    const fake = crearFakeSupabase();
    const raros = ['Helado de Chocolate', 'LIMONADA rosa', 'Tiramisu', 'Frutos secos', 'Menta', '', null, 'Mango con fresa']
      .map((nombre, i) => ({ id_producto: 50 + i, nombre, precio: 1000, estado: true, stock: 1, tags: null, categoria: null }));
    fake.responder('producto', 'select', { data: [...CATALOGO_REAL, ...raros], error: null });
    const { app } = cargarServidor(fake);
    const { body } = await request(app).get('/api/products');
    expect(body).toHaveLength(21);
    expect(body).toMatchSnapshot();
  });
});

describe('fichaPropia: la ficha solo vale si el nombre del producto es el suyo', () => {
  it.each(CATALOGO_REAL.map((p) => [p.nombre, p.id_producto]))('%s', (nombre, id) => {
    const { fichaPropia } = cargar();
    const ficha = fichaPropia(nombre);
    if (!FICHAS[id]) {
      expect(ficha).toBeNull();
      return;
    }
    expect(ficha.ingredients.join(', ')).toBe(FICHAS[id][0]);
    expect(ficha.allergens.join(', ')).toBe(FICHAS[id][1] ?? 'Ninguno');
  });

  it.each([['fresa salvaje'], [' FRESA  SALVAJE '], ['Tiramisu Artigianale'], ['coco & lima']])('"%s" se reconoce sin importar tildes, mayúsculas ni espacios', (nombre) => {
    expect(cargar().fichaPropia(nombre)).not.toBeNull();
  });

  it.each([['Fresa'], ['Fresa Salvaje Light'], ['Mango Biche'], ['Frutos secos'], ['Vainilla'], [''], [null], [undefined], [7], ['.*'], ['__proto__'], ['constructor']])(
    '%j no toma prestada la ficha de otro', (nombre) => {
      expect(cargar().fichaPropia(nombre)).toBeNull();
    });

  it('getFlavorData (la de la tienda) sigue emparejando por palabra suelta', () => {
    const { getFlavorData } = cargar();
    expect(getFlavorData('Helado de Pistacho Italiano').allergens).toEqual(['Pistacho', 'Lácteos', 'Huevo']);
    expect(getFlavorData('Menta')).toBeNull();
  });
});
