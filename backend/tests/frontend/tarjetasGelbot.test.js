// Tarjetas de helados del chat Gelbot (frontend/src/utils/tarjetasGelbot.js): el servidor manda
// `productos` y el navegador los vuelve a validar antes de mostrarlos (nunca confía a ciegas).
import { describe, it, expect } from 'vitest';
import { armarTarjetasProductos, productoDeTarjeta, FOTO_POR_DEFECTO, MAX_TARJETAS } from '../../../frontend/src/utils/tarjetasGelbot.js';

describe('armarTarjetasProductos', () => {
  it('arma id, nombre, precio, precio en texto ($9.000) y foto', () => {
    expect(armarTarjetasProductos([{ id: 1, nombre: 'Fresa Salvaje', precio: 9000, image: '/images/gelato_fresa.png' }])).toEqual([
      { id: 1, nombre: 'Fresa Salvaje', precio: 9000, precioTexto: '$9.000', image: '/images/gelato_fresa.png' },
    ]);
  });

  it('acepta fotos https y rutas locales', () => {
    const [a, b] = armarTarjetasProductos([
      { id: 1, nombre: 'A', precio: 1, image: 'https://cdn.example.com/a.png' },
      { id: 2, nombre: 'B', precio: 1, image: '/images/b y c.png' },
    ]);
    expect(a.image).toBe('https://cdn.example.com/a.png');
    expect(b.image).toBe('/images/b y c.png');
  });

  it.each([
    [null], [''], ['javascript:alert(1)'], ['http://cdn.example.com/a.png'], ['//evil.example.com/a.png'],
    ['/images/../secreto'], ['data:image/png;base64,AAAA'], [42],
  ])('foto inválida %s -> foto por defecto', (image) => {
    expect(armarTarjetasProductos([{ id: 1, nombre: 'A', precio: 1, image }])[0].image).toBe(FOTO_POR_DEFECTO);
  });

  it('descarta productos sin id válido, sin nombre o con precio inválido', () => {
    const lista = [
      { id: 0, nombre: 'A', precio: 1 },
      { id: 'x', nombre: 'A', precio: 1 },
      { id: 2, nombre: '   ', precio: 1 },
      { id: 3, nombre: 'B', precio: -1 },
      { id: 4, nombre: 'C', precio: 'mucho' },
      null,
      { id: 5, nombre: 'Bueno', precio: 100 },
    ];
    expect(armarTarjetasProductos(lista).map((t) => t.id)).toEqual([5]);
  });

  it(`muestra como máximo ${12} tarjetas`, () => {
    const lista = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, nombre: `S${i}`, precio: 1000 }));
    expect(MAX_TARJETAS).toBe(12);
    expect(armarTarjetasProductos(lista)).toHaveLength(12);
  });

  it('recorta nombres larguísimos', () => {
    expect(armarTarjetasProductos([{ id: 1, nombre: 'x'.repeat(300), precio: 1 }])[0].nombre.length).toBeLessThanOrEqual(80);
  });

  it('si no llega una lista devuelve []', () => {
    for (const v of [undefined, null, 'hola', { id: 1 }]) expect(armarTarjetasProductos(v)).toEqual([]);
  });
});

describe('productoDeTarjeta', () => {
  it('devuelve lo que necesita el carrito (sin el texto del precio)', () => {
    const [t] = armarTarjetasProductos([{ id: 1, nombre: 'Fresa', precio: 9000, image: '/images/f.png' }]);
    expect(productoDeTarjeta(t)).toEqual({ id: 1, nombre: 'Fresa', precio: 9000, image: '/images/f.png' });
  });
});
