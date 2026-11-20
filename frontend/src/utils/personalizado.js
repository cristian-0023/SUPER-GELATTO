/**
 * personalizado.js — Lógica pura del helado personalizado 3D.
 * El precio que se COBRA lo calcula la base (registrar_venta con la tabla componente_personalizado).
 * Aquí solo se calcula el precio que se MUESTRA, con los precios que entrega /api/personalizado/precios.
 */

export const NOMBRE_PERSONALIZADO = 'Helado personalizado 3D';

// Respaldo mientras cargan los precios (o si no cargan): igual a la semilla de la base.
// Envase $8.000 + $2.000 por sabor + $1.000 por topping.
export const PRECIOS_RESPALDO = [
  ...['cone', 'cup', 'glass'].map((id) => ({ id, tipo: 'envase', precio: 8000 })),
  ...['vanilla', 'chocolate', 'fresa', 'mango', 'menta', 'mora'].map((id) => ({ id, tipo: 'sabor', precio: 2000 })),
  ...['cherry', 'chips', 'coco', 'cream', 'gummies', 'nuts', 'sprinkles', 'syrup'].map((id) => ({ id, tipo: 'topping', precio: 1000 })),
];

const listaDe = (componentes) => (Array.isArray(componentes) && componentes.length > 0 ? componentes : PRECIOS_RESPALDO);
const buscar = (componentes, id, tipo) => listaDe(componentes).find((c) => c.id === id && c.tipo === tipo);

// Las piezas elegidas, cada una con su tipo, en orden: envase, sabores, toppings.
const piezas = ({ envase, sabores = [], toppings = [] }) => [
  { id: envase, tipo: 'envase' },
  ...sabores.map((id) => ({ id, tipo: 'sabor' })),
  ...toppings.map((id) => ({ id, tipo: 'topping' })),
];

// Precio a mostrar. null si alguna pieza no está en la lista (no se inventa un precio).
export function precioPersonalizado(seleccion, componentes) {
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

export function describirSeleccion({ envase, sabores = [], toppings = [] }, componentes) {
  const nombre = (id, tipo) => buscar(componentes, id, tipo)?.nombre || id;
  return unirDescripcion(nombre(envase, 'envase'), sabores.map((id) => nombre(id, 'sabor')), toppings.map((id) => nombre(id, 'topping')));
}

// Composición guardada por la base: {envase:{nombre}, sabores:[{nombre}], toppings:[{nombre}]}.
export function describirPersonalizacion(p) {
  if (!p || typeof p !== 'object') return '';
  const nombres = (lista) => (Array.isArray(lista) ? lista : []).map((c) => c && c.nombre).filter(Boolean);
  return unirDescripcion(p.envase?.nombre, nombres(p.sabores), nombres(p.toppings));
}

// Línea del carrito armada desde la selección del armador (con los ids que ya usa).
export function armarItemPersonalizado({ seleccion, componentes, imagen = null, extra = {} }) {
  const sabores = [...(seleccion.sabores || [])];
  const toppings = [...(seleccion.toppings || [])];
  const limpia = { envase: seleccion.envase, sabores, toppings };
  return {
    ...extra,
    id: idLineaPersonalizada(limpia),
    tipo: 'personalizado',
    ...limpia,
    nombre: NOMBRE_PERSONALIZADO,
    precio: precioPersonalizado(limpia, componentes),
    image: imagen,
    isCustom: true,
    categoria: 'Personalizado',
    detalle: describirSeleccion(limpia, componentes),
  };
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
