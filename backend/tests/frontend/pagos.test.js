// Lógica pura de la pasarela (frontend/src/utils/pagos.js): qué se le manda al servidor y qué se le
// muestra al cliente cuando la sesión venció.
import { describe, it, expect } from 'vitest';
import { armarPago, resultadoPago, MENSAJE_SESION_VENCIDA } from '../../../frontend/src/utils/pagos.js';

const datos = (extra = {}) => ({
  token: 'mi-token',
  metodo: 'NEQUI',
  banco: 'Nequi',
  cart: [{ id: 5, nombre: 'Helado de fresa', quantity: 2, precio: 12500 }],
  totalPrice: 25000,
  referencia: 'ORD-SG-1',
  forzarRechazo: false,
  ...extra,
});

describe('armarPago', () => {
  it('manda el token en Authorization: Bearer', () => {
    const { headers } = armarPago(datos());

    expect(headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer mi-token' });
  });

  it('nunca manda userId en el cuerpo: el usuario sale del token', () => {
    const cuerpo = JSON.parse(armarPago(datos()).body);

    expect(cuerpo).not.toHaveProperty('userId');
  });

  it('conserva los datos que el servidor necesita', () => {
    const cuerpo = JSON.parse(armarPago(datos({ forzarRechazo: true })).body);

    expect(cuerpo).toMatchObject({
      method: 'NEQUI',
      bank: 'Nequi',
      amount: 25000,
      reference: 'ORD-SG-1',
      forceDecline: true,
      items: [{ id: 5, id_producto: 5, name: 'Helado de fresa', quantity: 2, price: 12500 }],
    });
  });
});

describe('armarPago con Super Points', () => {
  it('manda puntosUsar solo cuando el cliente canjea', () => {
    expect(JSON.parse(armarPago(datos({ puntosUsar: 120 })).body).puntosUsar).toBe(120);
    expect(JSON.parse(armarPago(datos({ puntosUsar: 0 })).body)).not.toHaveProperty('puntosUsar');
    expect(JSON.parse(armarPago(datos()).body)).not.toHaveProperty('puntosUsar');
  });

  it('nunca manda puntosUsar inválido (null, negativo, decimal o texto)', () => {
    for (const malo of [null, -3, 2.5, 'abc', NaN]) {
      expect(JSON.parse(armarPago(datos({ puntosUsar: malo })).body)).not.toHaveProperty('puntosUsar');
    }
  });
});

describe('resultadoPago con Super Points', () => {
  it('400 con puntos enviados: avisa que hay que volver a pedir el saldo', () => {
    const r = resultadoPago(400, { ok: false, message: 'No tienes puntos suficientes.' }, 120);

    expect(r).toMatchObject({ ok: false, message: 'No tienes puntos suficientes.', recargarPuntos: true });
  });

  it('400 sin puntos enviados, o un pago aprobado, no piden recargar', () => {
    expect(resultadoPago(400, { ok: false, message: 'x' }, 0)).not.toHaveProperty('recargarPuntos');
    expect(resultadoPago(400, { ok: false, message: 'x' })).not.toHaveProperty('recargarPuntos');
    expect(resultadoPago(200, { ok: true, transaction: {} }, 120)).not.toHaveProperty('recargarPuntos');
  });

  it('401 con puntos enviados sigue siendo sesión vencida', () => {
    expect(resultadoPago(401, {}, 120)).toMatchObject({ sesionVencida: true });
  });
});

describe('resultadoPago', () => {
  it('401 -> pide iniciar sesión de nuevo, avisa que el carrito sigue y no es un pago exitoso', () => {
    const r = resultadoPago(401, { ok: false, message: 'texto del servidor' });

    expect(r).toEqual({ ok: false, sesionVencida: true, message: MENSAJE_SESION_VENCIDA, transaction: null });
    expect(MENSAJE_SESION_VENCIDA).toMatch(/inicia sesión/i);
    expect(MENSAJE_SESION_VENCIDA).toMatch(/carrito/i);
  });

  it('cualquier otra respuesta se muestra tal cual', () => {
    const aprobado = { ok: true, transaction: { id: 'T' }, message: 'bien' };

    expect(resultadoPago(200, aprobado)).toBe(aprobado);
    expect(resultadoPago(409, { ok: false, message: 'sin stock' })).toEqual({ ok: false, message: 'sin stock' });
  });
});
