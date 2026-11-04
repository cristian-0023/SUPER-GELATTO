/**
 * pagos.js — Lógica pura de la pasarela: qué se le manda al servidor y qué se le muestra al cliente.
 * El usuario NO va en el cuerpo: el servidor lo saca del token de la sesión.
 */

export const MENSAJE_SESION_VENCIDA = 'Tu sesión venció. Inicia sesión de nuevo para pagar: tu carrito sigue guardado.';

export function armarPago({ token, metodo, banco, cart, totalPrice, referencia, forzarRechazo }) {
  return {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      method: metodo,
      bank: banco,
      items: cart.map((item) => ({
        id: item.id,
        id_producto: item.id,
        name: item.nombre || item.name,
        quantity: item.quantity,
        price: item.precio || item.price,
      })),
      amount: totalPrice,
      reference: referencia,
      deliveryDetails: {},
      forceDecline: forzarRechazo,
    }),
  };
}

// Sin sesión válida no hubo pago: no es un rechazo del banco y el carrito no se toca.
export function resultadoPago(status, data) {
  if (status === 401) {
    return { ok: false, sesionVencida: true, message: MENSAJE_SESION_VENCIDA, transaction: null };
  }
  return data;
}
