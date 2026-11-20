// Tamaño y posición del panel del chat Gelbot según la ventana.
// - Escritorio: panel compacto abajo a la derecha que nunca sube hasta la barra superior fija.
// - Celular (< 640 px): ocupa toda la pantalla debajo de la barra (top = barra, bottom = 0, lo resuelve CSS).
//   Solo con el teclado abierto se calcula en JS: el panel termina en el borde de abajo del área visible
//   (visualViewport.offsetTop + height), y en iOS, si la vista se desplazó, el encabezado baja con ella.

import { ALTO_NAVBAR } from './layout.js';

export { ALTO_NAVBAR };              // misma constante que usa Navbar.jsx
export const ANCHO_MOVIL = 640;     // mismo corte que "sm" de Tailwind
export const ANCHO_PANEL = 380;
export const ALTO_MAX_PANEL = 640;
export const ALTO_MIN_PANEL = 240;
export const MARGEN_PANEL = 16;     // aire entre el panel y la barra / los bordes
export const ABAJO_PANEL = 24;      // distancia al borde inferior en escritorio
const PISO_SEGURIDAD = 120;
const PISO_TECLADO = 96;           // encabezado + campo de texto, como mínimo

const numeroPositivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function esPantallaMovil(ancho) {
  return numeroPositivo(ancho) && ancho < ANCHO_MOVIL;
}

export function medidasPanel({ ancho, alto, altoVisible, desplazamientoVisible, altoNavbar = ALTO_NAVBAR } = {}) {
  const altoVentana = numeroPositivo(alto) ? alto : 800;
  const barra = numeroPositivo(altoNavbar) ? altoNavbar : ALTO_NAVBAR;

  if (esPantallaMovil(ancho)) {
    const conTeclado = numeroPositivo(altoVisible) && altoVisible < altoVentana;
    if (!conTeclado) return { modo: 'movil', modal: true, arriba: barra, abajo: 0 };
    const desplazado = numeroPositivo(desplazamientoVisible) ? desplazamientoVisible : 0;
    const arriba = Math.round(Math.max(barra, desplazado));
    const bordeVisible = Math.round(desplazado + altoVisible);
    return { modo: 'movil', modal: true, arriba, alto: Math.max(PISO_TECLADO, bordeVisible - arriba) };
  }

  // No tapar la barra gana sobre el alto mínimo cómodo; solo en ventanas absurdas se usa un piso de seguridad.
  const disponible = altoVentana - barra - MARGEN_PANEL - ABAJO_PANEL;
  return {
    modo: 'escritorio',
    modal: false,
    ancho: ANCHO_PANEL,
    abajo: ABAJO_PANEL,
    altoMax: Math.round(Math.max(PISO_SEGURIDAD, Math.min(ALTO_MAX_PANEL, disponible))),
  };
}

// Hay una confirmación de admin esperando Confirmar/Cancelar.
export function hayPropuestaPendiente(mensajes) {
  return Array.isArray(mensajes) && mensajes.some((m) => m?.propuesta?.estado === 'pendiente');
}

// Escape cierra el panel, salvo que otro diálogo ya lo haya atendido o haya una confirmación pendiente.
export function debeCerrarConEscape(evento, mensajes) {
  if (!evento || evento.key !== 'Escape' || evento.defaultPrevented) return false;
  return !hayPropuestaPendiente(mensajes);
}

// Al cerrar, el foco vuelve al botón flotante solo si estaba dentro del panel (o se había perdido en
// el body). Si el usuario ya está en otra parte de la página (por ejemplo, tras el auto-cierre), no se toca.
export function debeDevolverFoco({ activo, panel, body } = {}) {
  if (!activo || activo === body) return true;
  return !!panel && typeof panel.contains === 'function' && panel.contains(activo);
}
