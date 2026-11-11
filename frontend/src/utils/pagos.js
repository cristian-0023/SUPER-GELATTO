/**
 * pagos.js — Lógica pura de la pasarela: qué se le manda al servidor y qué se le muestra al cliente.
 * El usuario NO va en el cuerpo: el servidor lo saca del token de la sesión.
 */

export const MENSAJE_SESION_VENCIDA = 'Tu sesión venció. Inicia sesión de nuevo para pagar: tu carrito sigue guardado.';

export function armarPago({ token, metodo, banco, cart, totalPrice, referencia, forzarRechazo, puntosUsar }) {
  // Solo se manda si hay canje real: el servidor rechaza null, negativos y decimales.
  const canje = Number.isSafeInteger(puntosUsar) && puntosUsar > 0 ? { puntosUsar } : {};
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
      ...canje,
    }),
  };
}

// Sin sesión válida no hubo pago: no es un rechazo del banco y el carrito no se toca.
// Un 400 después de mandar puntos puede ser por el saldo o el tope: la pantalla debe volver a pedir el saldo.
export function resultadoPago(status, data, puntosUsar = 0) {
  if (status === 401) {
    return { ok: false, sesionVencida: true, message: MENSAJE_SESION_VENCIDA, transaction: null };
  }
  if (status === 400 && puntosUsar > 0 && data && data.ok === false) {
    return { ...data, recargarPuntos: true };
  }
  return data;
}
