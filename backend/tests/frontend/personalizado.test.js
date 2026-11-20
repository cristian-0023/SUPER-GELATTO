// Lógica pura del helado personalizado 3D (frontend/src/utils/personalizado.js):
//  - armar la línea del carrito desde la selección del armador (ids que ya usa el armador);
//  - el precio mostrado sale de los precios de la base (o de un respaldo igual a la semilla);
//  - dos composiciones distintas = dos líneas; la misma composición = la misma línea;
//  - qué se manda al servidor (solo composición y cantidad) y cómo se describe la composición.
import { describe, it, expect } from 'vitest';
import {
  PRECIOS_RESPALDO,
  precioPersonalizado,
  idLineaPersonalizada,
  armarItemPersonalizado,
  describirSeleccion,
  describirPersonalizacion,
  lineaParaPago,
  limpiarCarritoGuardado,
} from '../../../frontend/src/utils/personalizado.js';
import { armarPago } from '../../../frontend/src/utils/pagos.js';

const COMPONENTES = [
  { id: 'cone', tipo: 'envase', nombre: 'Cono', precio: 8000 },
  { id: 'cup', tipo: 'envase', nombre: 'Copa', precio: 9000 },
  { id: 'vanilla', tipo: 'sabor', nombre: 'Vainilla', precio: 2000 },
  { id: 'mora', tipo: 'sabor', nombre: 'Mora', precio: 2500 },
  { id: 'cherry', tipo: 'topping', nombre: 'Cereza', precio: 1000 },
];

const seleccion = (extra = {}) => ({ envase: 'cone', sabores: ['vanilla'], toppings: [], ...extra });

describe('precioPersonalizado', () => {
  it('suma envase + sabores + toppings con los precios de la base', () => {
    expect(precioPersonalizado(seleccion({ envase: 'cup', sabores: ['vanilla', 'mora'], toppings: ['cherry'] }), COMPONENTES))
      .toBe(9000 + 2000 + 2500 + 1000);
  });

  it('el respaldo reproduce la fórmula de siempre: $10.000 + $2.000 por bola extra + $1.000 por topping', () => {
    const SABORES = ['vanilla', 'chocolate', 'fresa'];
    const TOPPINGS = ['cherry', 'chips', 'coco'];
    for (let n = 1; n <= 3; n += 1) {
      for (let t = 0; t <= 3; t += 1) {
        const precio = precioPersonalizado(seleccion({ sabores: SABORES.slice(0, n), toppings: TOPPINGS.slice(0, t) }), PRECIOS_RESPALDO);
        expect(precio).toBe(10000 + (n - 1) * 2000 + t * 1000);
      }
    }
  });

  it('sin lista de precios usa el respaldo', () => {
    expect(precioPersonalizado(seleccion(), null)).toBe(10000);
    expect(precioPersonalizado(seleccion(), [])).toBe(10000);
  });

  it('un id que la base no tiene da null (no se inventa un precio)', () => {
    expect(precioPersonalizado(seleccion({ sabores: ['pistacho'] }), COMPONENTES)).toBeNull();
  });
});

describe('idLineaPersonalizada', () => {
  it('la misma composición da la misma línea y otra composición, otra línea', () => {
    const a = idLineaPersonalizada(seleccion({ sabores: ['vanilla', 'mora'], toppings: ['cherry'] }));
    expect(a).toBe('pers:cone|vanilla,mora|cherry');
    expect(idLineaPersonalizada(seleccion({ sabores: ['vanilla', 'mora'], toppings: ['cherry'] }))).toBe(a);
    expect(idLineaPersonalizada(seleccion({ sabores: ['mora', 'vanilla'], toppings: ['cherry'] }))).not.toBe(a);
    expect(idLineaPersonalizada(seleccion({ envase: 'cup', sabores: ['vanilla', 'mora'], toppings: ['cherry'] }))).not.toBe(a);
  });
});

describe('armarItemPersonalizado', () => {
  it('arma la línea del carrito con los ids del armador, nombre, precio y descripción', () => {
    const item = armarItemPersonalizado({
      seleccion: seleccion({ sabores: ['vanilla', 'mora'], toppings: ['cherry'] }),
      componentes: COMPONENTES,
      imagen: 'data:image/png;base64,AAA',
      extra: { emoji: '🍨' },
    });

    expect(item).toMatchObject({
      id: 'pers:cone|vanilla,mora|cherry',
      tipo: 'personalizado',
      envase: 'cone',
      sabores: ['vanilla', 'mora'],
      toppings: ['cherry'],
      nombre: 'Helado personalizado 3D',
      precio: 13500,
      image: 'data:image/png;base64,AAA',
      isCustom: true,
      categoria: 'Personalizado',
      detalle: 'Cono · Vainilla, Mora · Toppings: Cereza',
      emoji: '🍨',
    });
  });

  it('no comparte las listas con el estado del armador (copias)', () => {
    const sabores = ['vanilla'];
    const item = armarItemPersonalizado({ seleccion: seleccion({ sabores }), componentes: COMPONENTES });
    sabores.push('mora');
    expect(item.sabores).toEqual(['vanilla']);
  });
});

describe('descripciones', () => {
  it('describirSeleccion usa los nombres de la base (o el id si no lo conoce)', () => {
    expect(describirSeleccion(seleccion(), COMPONENTES)).toBe('Cono · Vainilla');
    expect(describirSeleccion(seleccion({ toppings: ['oro'] }), COMPONENTES)).toBe('Cono · Vainilla · Toppings: oro');
  });

  it('describirPersonalizacion entiende la composición que guarda la base', () => {
    const p = {
      envase: { id: 'cup', nombre: 'Copa', precio: 8000 },
      sabores: [{ id: 'mora', nombre: 'Mora', precio: 2000 }],
      toppings: [{ id: 'coco', nombre: 'Coco', precio: 1000 }, { id: 'nuts', nombre: 'Nueces', precio: 1000 }],
    };
    expect(describirPersonalizacion(p)).toBe('Copa · Mora · Toppings: Coco, Nueces');
    expect(describirPersonalizacion(null)).toBe('');
  });
});

describe('lo que se manda al servidor', () => {
  it('lineaParaPago manda solo la composición y la cantidad de un personalizado', () => {
    const item = { ...armarItemPersonalizado({ seleccion: seleccion({ toppings: ['cherry'] }), componentes: COMPONENTES, imagen: 'data:x' }), quantity: 2 };
    expect(lineaParaPago(item)).toEqual({ tipo: 'personalizado', envase: 'cone', sabores: ['vanilla'], toppings: ['cherry'], quantity: 2 });
  });

  it('armarPago manda los personalizados sin foto ni precio, y los normales como siempre', () => {
    const personalizado = { ...armarItemPersonalizado({ seleccion: seleccion(), componentes: COMPONENTES, imagen: 'data:image/png;base64,AAAA' }), quantity: 1 };
    const cuerpo = JSON.parse(armarPago({
      token: 't', metodo: 'NEQUI', banco: 'Nequi', totalPrice: 1, referencia: 'R',
      cart: [{ id: 5, nombre: 'Helado de fresa', quantity: 2, precio: 12500 }, personalizado],
    }).body);

    expect(cuerpo.items).toEqual([
      { id: 5, id_producto: 5, name: 'Helado de fresa', quantity: 2, price: 12500 },
      { tipo: 'personalizado', envase: 'cone', sabores: ['vanilla'], toppings: [], quantity: 1 },
    ]);
    expect(JSON.stringify(cuerpo)).not.toContain('data:image');
  });
});

describe('limpiarCarritoGuardado', () => {
  it('quita los personalizados viejos (custom-...) que el servidor ya no acepta y deja lo demás', () => {
    const guardado = [
      { id: 5, nombre: 'Helado de fresa', quantity: 1 },
      { id: 'custom-1700000000000', nombre: 'Personalizado: Cono', isCustom: true, quantity: 1 },
      { id: 'pers:cone|vanilla|', tipo: 'personalizado', envase: 'cone', sabores: ['vanilla'], toppings: [], quantity: 1 },
    ];
    expect(limpiarCarritoGuardado(guardado).map((i) => i.id)).toEqual([5, 'pers:cone|vanilla|']);
  });

  it('si lo guardado no es una lista devuelve un carrito vacío', () => {
    expect(limpiarCarritoGuardado(null)).toEqual([]);
    expect(limpiarCarritoGuardado({ a: 1 })).toEqual([]);
  });
});
