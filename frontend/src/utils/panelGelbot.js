// Tamaño y posición del panel del chat Gelbot según la ventana.
// - Escritorio: panel compacto abajo a la derecha que nunca sube hasta la barra superior fija.
// - Celular (< 640 px): ocupa toda la pantalla debajo de la barra; con el teclado abierto usa el
//   alto visible (visualViewport) para que el campo de texto quede encima del teclado.

export const ALTO_NAVBAR = 80;      // Navbar.jsx: h-[80px]
export const ANCHO_MOVIL = 640;     // mismo corte que "sm" de Tailwind
export const ANCHO_PANEL = 380;
export const ALTO_MAX_PANEL = 640;
export const ALTO_MIN_PANEL = 240;
export const MARGEN_PANEL = 16;     // aire entre el panel y la barra / los bordes
export const ABAJO_PANEL = 24;      // distancia al borde inferior en escritorio
const PISO_SEGURIDAD = 120;

const numeroPositivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function esPantallaMovil(ancho) {
  return numeroPositivo(ancho) && ancho < ANCHO_MOVIL;
}

export function medidasPanel({ ancho, alto, altoVisible, altoNavbar = ALTO_NAVBAR } = {}) {
  const altoVentana = numeroPositivo(alto) ? alto : 800;
  const barra = numeroPositivo(altoNavbar) ? altoNavbar : ALTO_NAVBAR;

  if (esPantallaMovil(ancho)) {
    const visible = numeroPositivo(altoVisible) && altoVisible < altoVentana ? altoVisible : altoVentana;
    return { modo: 'movil', arriba: barra, alto: Math.max(ALTO_MIN_PANEL, Math.round(visible - barra)) };
  }

  // No tapar la barra gana sobre el alto mínimo cómodo; solo en ventanas absurdas se usa un piso de seguridad.
  const disponible = altoVentana - barra - MARGEN_PANEL - ABAJO_PANEL;
  return {
    modo: 'escritorio',
    ancho: ANCHO_PANEL,
    abajo: ABAJO_PANEL,
    altoMax: Math.round(Math.max(PISO_SEGURIDAD, Math.min(ALTO_MAX_PANEL, disponible))),
  };
}
