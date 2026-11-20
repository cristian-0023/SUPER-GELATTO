/**
 * personalizado.js — Lógica pura del helado personalizado 3D.
 * El precio que se COBRA lo calcula la base (registrar_venta con la tabla componente_personalizado).
 * Aquí solo se calcula el precio que se MUESTRA, con los precios y nombres que entrega
 * /api/personalizado/precios. Sin esos datos no se arma ninguna línea (no hay precios inventados).
 */

export const NOMBRE_PERSONALIZADO = 'Helado personalizado 3D';

// Límites del armador solo mientras cargan los de la base (o si fallaron: igual no se puede agregar).
export const LIMITES_MIENTRAS_CARGA = { maxSabores: 3, maxToppings: 3 };

const esLimite = (n, minimo) => Number.isInteger(n) && n >= minimo && n <= 20;

// Respuesta de /api/personalizado/precios -> { componentes, maxSabores, maxToppings } o null si no sirve.
export function leerRespuestaPrecios(data) {
  if (!data || data.ok !== true || !Array.isArray(data.componentes) || data.componentes.length === 0) return null;
  if (!esLimite(data.maxSabores, 1) || !esLimite(data.maxToppings, 0)) return null;
  return { componentes: data.componentes, maxSabores: data.maxSabores, maxToppings: data.maxToppings };
}

export function limitesArmador(precios) {
  return precios ? { maxSabores: precios.maxSabores, maxToppings: precios.maxToppings } : LIMITES_MIENTRAS_CARGA;
}

// Estado del botón "agregar al carrito" según la carga de precios ('cargando' | 'error' | 'listo').
export function estadoAgregar({ estado, precio }) {
  if (estado === 'cargando') return { puede: false, mensaje: 'Cargando precios…', reintentar: false };
  if (estado !== 'listo') return { puede: false, mensaje: 'No pudimos cargar los precios, reintenta', reintentar: true };
  if (precio === null || precio === undefined) {
    return { puede: false, mensaje: 'Esta combinación no está disponible. Elige otras piezas.', reintentar: false };
  }
  return { puede: true, mensaje: '', reintentar: false };
}

const buscar = (componentes, id, tipo) =>
  (Array.isArray(componentes) ? componentes : []).find((c) => c.id === id && c.tipo === tipo);

// Las piezas elegidas, cada una con su tipo, en orden: envase, sabores, toppings.
const piezas = ({ envase, sabores = [], toppings = [] }) => [
  { id: envase, tipo: 'envase' },
  ...sabores.map((id) => ({ id, tipo: 'sabor' })),
  ...toppings.map((id) => ({ id, tipo: 'topping' })),
];

// Precio a mostrar. null si no hay precios o alguna pieza no está en la lista.
export function precioPersonalizado(seleccion, componentes) {
  if (!Array.isArray(componentes) || componentes.length === 0) return null;
  let total = 0;
  for (const p of piezas(seleccion)) {
    const c = buscar(componentes, p.id, p.tipo);
    if (!c) return null;
    total += Number(c.precio);
  }
  return total;
}

// La misma composición es la misma línea del carrito; otra composición, otra línea.
export function idLineaPersonalizada({ envase, sabores = [], toppings = [] }) {
  return `pers:${envase}|${sabores.join(',')}|${toppings.join(',')}`;
}

// "Cono · Vainilla, Mora · Toppings: Cereza"
function unirDescripcion(envase, sabores, toppings) {
  const partes = [envase, sabores.join(', ')];
  if (toppings.length > 0) partes.push(`Toppings: ${toppings.join(', ')}`);
  return partes.filter(Boolean).join(' · ');
}

// Solo nombres de la base: una pieza sin nombre se omite (nunca se muestra el id interno).
export function describirSeleccion({ envase, sabores = [], toppings = [] }, componentes) {
  const nombre = (id, tipo) => buscar(componentes, id, tipo)?.nombre || '';
  const nombres = (lista, tipo) => lista.map((id) => nombre(id, tipo)).filter(Boolean);
  return unirDescripcion(nombre(envase, 'envase'), nombres(sabores, 'sabor'), nombres(toppings, 'topping'));
}

// Composición guardada por la base: {envase:{nombre}, sabores:[{nombre}], toppings:[{nombre}]}.
export function describirPersonalizacion(p) {
  if (!p || typeof p !== 'object') return '';
  const nombres = (lista) => (Array.isArray(lista) ? lista : []).map((c) => c && c.nombre).filter(Boolean);
  return unirDescripcion(p.envase?.nombre, nombres(p.sabores), nombres(p.toppings));
}

// Todas las piezas están en la base y con nombre.
const piezasCompletas = (seleccion, componentes) =>
  piezas(seleccion).every((p) => Boolean(buscar(componentes, p.id, p.tipo)?.nombre));

// Línea del carrito armada desde la selección del armador (con los ids que ya usa).
// null si faltan precios o alguna pieza (o su nombre) no está en la base.
export function armarItemPersonalizado({ seleccion, componentes, imagen = null, extra = {} }) {
  const limpia = { envase: seleccion.envase, sabores: [...(seleccion.sabores || [])], toppings: [...(seleccion.toppings || [])] };
  const precio = precioPersonalizado(limpia, componentes);
  if (precio === null || !piezasCompletas(limpia, componentes)) return null;
  return {
    ...extra,
    id: idLineaPersonalizada(limpia),
    tipo: 'personalizado',
    ...limpia,
    nombre: NOMBRE_PERSONALIZADO,
    precio,
    image: imagen,
    isCustom: true,
    categoria: 'Personalizado',
    detalle: describirSeleccion(limpia, componentes),
  };
}

// Checkout: recalcula precio y descripción de los personalizados con los precios recién pedidos.
// Devuelve { cart, subtotal, invalidos, confirmado }:
//   confirmado = false si hay personalizados y no hubo precios (el total final lo confirma el servidor);
//   invalidos  = líneas con una pieza que ya no está en la base (marcadas noDisponible).
export function recalcularCarrito(cart, componentes) {
  const lista = Array.isArray(cart) ? cart : [];
  const hayPersonalizados = lista.some((i) => i.tipo === 'personalizado');
  const hayPrecios = Array.isArray(componentes) && componentes.length > 0;
  let invalidos = 0;
  const nuevo = !hayPrecios ? lista : lista.map((item) => {
    if (item.tipo !== 'personalizado') return item;
    const precio = precioPersonalizado(item, componentes);
    if (precio === null || !piezasCompletas(item, componentes)) {
      invalidos += 1;
      return { ...item, noDisponible: true };
    }
    return { ...item, precio, detalle: describirSeleccion(item, componentes), noDisponible: false };
  });
  const subtotal = nuevo.reduce((suma, i) => suma + (i.noDisponible ? 0 : (Number(i.precio || i.price) || 0) * i.quantity), 0);
  return { cart: nuevo, subtotal, invalidos, confirmado: !hayPersonalizados || hayPrecios };
}

// Lo que va al servidor por un personalizado: SOLO composición y cantidad (ni precio ni foto).
export function lineaParaPago(item) {
  return { tipo: 'personalizado', envase: item.envase, sabores: item.sabores, toppings: item.toppings, quantity: item.quantity };
}

// Los personalizados viejos ("custom-<fecha>", sin composición) el servidor ya no los acepta:
// se quitan al cargar el carrito guardado para que no bloqueen el pago.
export function limpiarCarritoGuardado(guardado) {
  if (!Array.isArray(guardado)) return [];
  return guardado.filter((item) => !(item && typeof item.id === 'string' && item.id.startsWith('custom-') && item.tipo !== 'personalizado'));
}
