// Lógica pura del helado personalizado 3D (frontend/src/utils/personalizado.js):
//  - armar la línea del carrito desde la selección del armador (ids que ya usa el armador), SOLO con los
//    precios y nombres que entregó la base (sin respaldo inventado y sin ids crudos guardados);
//  - dos composiciones distintas = dos líneas; la misma composición = la misma línea;
//  - límites del armador desde la base (3 solo mientras carga);
//  - estado del botón "agregar" mientras cargan o fallan los precios;
//  - en el checkout, recalcular precio y descripción de los personalizados con los precios recién pedidos;
//  - qué se manda al servidor (solo composición y cantidad) y cómo se describe la composición.
import { describe, it, expect } from 'vitest';
import {
  LIMITES_MIENTRAS_CARGA,
  leerRespuestaPrecios,
  limitesArmador,
  estadoAgregar,
  precioPersonalizado,
  idLineaPersonalizada,
  armarItemPersonalizado,
  describirSeleccion,
  describirPersonalizacion,
  recalcularCarrito,
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

describe('leerRespuestaPrecios', () => {
  it('toma componentes y límites de la respuesta de /api/personalizado/precios', () => {
    expect(leerRespuestaPrecios({ ok: true, maxSabores: 2, maxToppings: 4, componentes: COMPONENTES }))
      .toEqual({ componentes: COMPONENTES, maxSabores: 2, maxToppings: 4 });
  });

  it('una respuesta rota o sin componentes es null (cuenta como fallo, no como precios vacíos)', () => {
    for (const malo of [null, {}, { ok: false }, { ok: true, componentes: [] }, { ok: true, componentes: 'x' },
      { ok: true, componentes: COMPONENTES, maxSabores: 0, maxToppings: 3 },
      { ok: true, componentes: COMPONENTES, maxSabores: 3, maxToppings: -1 },
      { ok: true, componentes: COMPONENTES, maxSabores: '3', maxToppings: 3 }]) {
      expect(leerRespuestaPrecios(malo)).toBeNull();
    }
  });
});

describe('limitesArmador', () => {
  it('usa los límites de la base', () => {
    expect(limitesArmador({ componentes: COMPONENTES, maxSabores: 2, maxToppings: 5 })).toEqual({ maxSabores: 2, maxToppings: 5 });
  });

  it('mientras carga (o si falló) usa 3 y 3', () => {
    expect(LIMITES_MIENTRAS_CARGA).toEqual({ maxSabores: 3, maxToppings: 3 });
    expect(limitesArmador(null)).toEqual({ maxSabores: 3, maxToppings: 3 });
  });
});

describe('estadoAgregar', () => {
  it('mientras cargan los precios no se puede agregar', () => {
    expect(estadoAgregar({ estado: 'cargando', precio: null })).toEqual({ puede: false, mensaje: 'Cargando precios…', reintentar: false });
  });

  it('si fallaron, no se puede agregar y se ofrece reintentar', () => {
    expect(estadoAgregar({ estado: 'error', precio: null }))
      .toEqual({ puede: false, mensaje: 'No pudimos cargar los precios, reintenta', reintentar: true });
  });

  it('con precios cargados pero una pieza sin precio, tampoco', () => {
    expect(estadoAgregar({ estado: 'listo', precio: null }).puede).toBe(false);
  });

  it('con precios cargados y precio calculado, sí', () => {
    expect(estadoAgregar({ estado: 'listo', precio: 12000 })).toEqual({ puede: true, mensaje: '', reintentar: false });
  });
});

describe('precioPersonalizado', () => {
  it('suma envase + sabores + toppings con los precios de la base', () => {
    expect(precioPersonalizado(seleccion({ envase: 'cup', sabores: ['vanilla', 'mora'], toppings: ['cherry'] }), COMPONENTES))
      .toBe(9000 + 2000 + 2500 + 1000);
  });

  it('sin precios cargados da null (no hay respaldo inventado)', () => {
    expect(precioPersonalizado(seleccion(), null)).toBeNull();
    expect(precioPersonalizado(seleccion(), [])).toBeNull();
  });

  it('un id que la base no tiene da null', () => {
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
  it('arma la línea del carrito con los ids del armador, nombre, precio y descripción de la base', () => {
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

  it('sin precios de la base o con una pieza desconocida no arma nada (null)', () => {
    expect(armarItemPersonalizado({ seleccion: seleccion(), componentes: null })).toBeNull();
    expect(armarItemPersonalizado({ seleccion: seleccion(), componentes: [] })).toBeNull();
    expect(armarItemPersonalizado({ seleccion: seleccion({ toppings: ['oro'] }), componentes: COMPONENTES })).toBeNull();
  });

  it('una pieza sin nombre en la base no deja el id crudo en el carrito', () => {
    const sinNombre = COMPONENTES.map((c) => (c.id === 'cherry' ? { ...c, nombre: '' } : c));
    expect(armarItemPersonalizado({ seleccion: seleccion({ toppings: ['cherry'] }), componentes: sinNombre })).toBeNull();
  });

  it('no comparte las listas con el estado del armador (copias)', () => {
    const sabores = ['vanilla'];
    const item = armarItemPersonalizado({ seleccion: seleccion({ sabores }), componentes: COMPONENTES });
    sabores.push('mora');
    expect(item.sabores).toEqual(['vanilla']);
  });
});

describe('descripciones', () => {
  it('describirSeleccion usa los nombres de la base y nunca muestra un id crudo', () => {
    expect(describirSeleccion(seleccion(), COMPONENTES)).toBe('Cono · Vainilla');
    expect(describirSeleccion(seleccion({ toppings: ['oro'] }), COMPONENTES)).toBe('Cono · Vainilla');
    expect(describirSeleccion(seleccion({ toppings: ['oro'] }), COMPONENTES)).not.toContain('oro');
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

describe('recalcularCarrito (checkout)', () => {
  const viejo = { id: 'pers:cup|mora|cherry', tipo: 'personalizado', envase: 'cup', sabores: ['mora'], toppings: ['cherry'], nombre: 'Helado personalizado 3D', precio: 11000, detalle: 'viejo', quantity: 2 };
  const normal = { id: 5, nombre: 'Helado de fresa', precio: 2500, quantity: 1 };

  it('vuelve a calcular precio y descripción de los personalizados y deja igual lo normal', () => {
    const r = recalcularCarrito([normal, viejo], COMPONENTES);

    expect(r.cart[0]).toBe(normal);
    expect(r.cart[1]).toMatchObject({ precio: 9000 + 2500 + 1000, detalle: 'Copa · Mora · Toppings: Cereza', quantity: 2 });
    expect(r.subtotal).toBe(2500 + 2 * 12500);
    expect(r.invalidos).toBe(0);
    expect(r.confirmado).toBe(true);
  });

  it('una pieza que ya no está en la base marca la línea como no disponible', () => {
    const r = recalcularCarrito([{ ...viejo, toppings: ['oro'] }], COMPONENTES);

    expect(r.invalidos).toBe(1);
    expect(r.cart[0].noDisponible).toBe(true);
  });

  it('sin precios (la ruta falló) deja el carrito como estaba y avisa que no está confirmado', () => {
    const r = recalcularCarrito([normal, viejo], null);

    expect(r.cart).toEqual([normal, viejo]);
    expect(r.subtotal).toBe(2500 + 2 * 11000);
    expect(r.confirmado).toBe(false);
  });

  it('sin personalizados no hace falta confirmar nada', () => {
    expect(recalcularCarrito([normal], null)).toMatchObject({ subtotal: 2500, confirmado: true, invalidos: 0 });
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
