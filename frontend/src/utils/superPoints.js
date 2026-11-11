/**
 * superPoints.js — Cuentas de Super Points de la página (solo para mostrar).
 * Las reglas (pesos por punto, valor del punto, niveles y topes) llegan del servidor por /api/points/rules:
 * aquí no hay ningún número de negocio fijo. El servidor es quien decide el total final al pagar.
 */

const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);

// Cantidad de puntos que escribió el cliente -> entero >= 0 (texto numérico vale; basura vale 0).
function aEnteroNoNegativo(valor) {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  return esNumero(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Cuánto se puede canjear y cómo queda el total.
 * máximo = menor entre el saldo y piso(subtotal × % del nivel ÷ valor del punto).
 */
export function calcularCanje({ subtotal, saldo, pctMax, valorPunto, puntosElegidos }) {
  const sinCanje = { maximo: 0, puntos: 0, descuento: 0, total: esNumero(subtotal) ? subtotal : 0 };
  if (!esNumero(subtotal) || subtotal <= 0 || !esNumero(saldo) || saldo <= 0) return sinCanje;
  if (!esNumero(pctMax) || pctMax <= 0 || !esNumero(valorPunto) || valorPunto <= 0) return sinCanje;

  const topePorNivel = Math.floor((subtotal * pctMax) / (100 * valorPunto));
  const maximo = Math.max(0, Math.min(Math.floor(saldo), topePorNivel));
  const puntos = Math.min(aEnteroNoNegativo(puntosElegidos), maximo);
  const descuento = puntos * valorPunto;
  return { maximo, puntos, descuento, total: subtotal - descuento };
}

/** Puntos que dará una compra: 1 por cada `pesosPorPunto` pagados, hacia abajo. null si no se puede saber. */
export function puntosAGanar(total, pesosPorPunto) {
  if (!esNumero(total) || total < 0 || !esNumero(pesosPorPunto) || pesosPorPunto <= 0) return null;
  return Math.floor(total / pesosPorPunto);
}

/**
 * Nivel actual, siguiente y avance (0-100) dentro del nivel, según los puntos GANADOS en toda la historia.
 * `niveles` viene ordenado de menor a mayor: [{nombre, min, max, pct}], con max null en el último.
 */
export function progresoNivel(ganados, niveles) {
  if (!Array.isArray(niveles) || niveles.length === 0) return { actual: null, siguiente: null, porcentaje: 0 };
  const g = esNumero(ganados) && ganados > 0 ? ganados : 0;

  let indice = 0;
  niveles.forEach((nivel, i) => {
    if (g >= nivel.min) indice = i;
  });
  const actual = niveles[indice];
  const siguiente = niveles[indice + 1] || null;
  if (!siguiente) return { actual, siguiente: null, porcentaje: 100 };

  const tramo = siguiente.min - actual.min;
  const avance = tramo > 0 ? Math.floor(((g - actual.min) / tramo) * 100) : 0;
  return { actual, siguiente, porcentaje: Math.min(100, Math.max(0, avance)) };
}

const numeroCO = new Intl.NumberFormat('es-CO');

/** Puntos con signo para el historial: +180, −400 (signo menos real) o 0. */
export function puntosConSigno(puntos) {
  if (!esNumero(puntos) || puntos === 0) return '0';
  return `${puntos > 0 ? '+' : '−'}${numeroCO.format(Math.abs(puntos))}`;
}

/** Texto en español de un movimiento de la libreta: {titulo, detalle}. */
export function describirMovimiento({ tipo, puntos, idVenta } = {}) {
  const compra = idVenta !== null && idVenta !== undefined ? `Compra #${idVenta}` : 'Compra';
  switch (tipo) {
    case 'ganado':
      return { titulo: 'Puntos ganados', detalle: compra };
    case 'canjeado':
      return { titulo: 'Puntos canjeados', detalle: `Descuento en la ${compra.toLowerCase()}` };
    case 'devuelto':
      return { titulo: 'Puntos devueltos', detalle: `${compra} cancelada` };
    case 'revertido':
      return { titulo: puntos === 0 ? 'Sin puntos que retirar' : 'Puntos retirados', detalle: `${compra} cancelada` };
    default:
      return { titulo: 'Movimiento', detalle: compra };
  }
}
