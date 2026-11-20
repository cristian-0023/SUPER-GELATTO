// Tamaño y posición del panel del chat Gelbot (frontend/src/utils/panelGelbot.js).
// El panel nunca debe quedar debajo de la barra superior fija (80 px) y en el celular ocupa toda la
// pantalla que queda debajo de la barra, respetando el teclado (alto visible de la ventana).
import { describe, it, expect } from 'vitest';
import {
  esPantallaMovil,
  medidasPanel,
  ALTO_NAVBAR,
  ANCHO_PANEL,
  ALTO_MAX_PANEL,
  MARGEN_PANEL,
  ALTO_MIN_PANEL,
} from '../../../frontend/src/utils/panelGelbot.js';

describe('esPantallaMovil', () => {
  it.each([[320, true], [390, true], [639, true], [640, false], [1366, false], [1920, false]])('%s px -> %s', (ancho, esperado) => {
    expect(esPantallaMovil(ancho)).toBe(esperado);
  });
  it.each([[undefined], [null], [NaN], [-5], ['abc']])('ancho inválido (%s) -> escritorio', (ancho) => {
    expect(esPantallaMovil(ancho)).toBe(false);
  });
});

describe('constantes', () => {
  it('alto de la barra = 80 px (Navbar.jsx usa h-[80px])', () => {
    expect(ALTO_NAVBAR).toBe(80);
  });
  it('panel compacto de escritorio de 380 px de ancho', () => {
    expect(ANCHO_PANEL).toBe(380);
  });
});

describe('medidasPanel en escritorio', () => {
  it('1366x636 (captura del usuario): el panel empieza debajo de la barra con margen', () => {
    const m = medidasPanel({ ancho: 1366, alto: 636 });
    expect(m.modo).toBe('escritorio');
    expect(m.ancho).toBe(ANCHO_PANEL);
    // El borde de arriba del panel (alto - abajo - altoMax) nunca toca la barra.
    expect(636 - m.abajo - m.altoMax).toBeGreaterThanOrEqual(ALTO_NAVBAR + MARGEN_PANEL);
    expect(m.altoMax).toBe(636 - ALTO_NAVBAR - MARGEN_PANEL - m.abajo);
  });

  it('1920x1080: el alto máximo tiene tope (panel compacto, no gigante)', () => {
    const m = medidasPanel({ ancho: 1920, alto: 1080 });
    expect(m.altoMax).toBe(ALTO_MAX_PANEL);
    expect(1080 - m.abajo - m.altoMax).toBeGreaterThan(ALTO_NAVBAR);
  });

  it('ventana muy baja: no tapa la barra aunque quede más bajo que el mínimo cómodo', () => {
    const m = medidasPanel({ ancho: 1024, alto: 300 });
    expect(300 - m.abajo - m.altoMax).toBeGreaterThanOrEqual(ALTO_NAVBAR + MARGEN_PANEL);
    expect(m.altoMax).toBeLessThan(ALTO_MIN_PANEL);
    expect(m.altoMax).toBeGreaterThan(0);
  });

  it('ventana absurda (más baja que la barra): alto mínimo de seguridad, nunca negativo', () => {
    expect(medidasPanel({ ancho: 1024, alto: 90 }).altoMax).toBeGreaterThan(0);
  });

  it('respeta un alto de barra distinto', () => {
    const m = medidasPanel({ ancho: 1366, alto: 700, altoNavbar: 100 });
    expect(700 - m.abajo - m.altoMax).toBeGreaterThanOrEqual(100 + MARGEN_PANEL);
  });

  it('ventana angosta (pero no celular): el panel conserva su ancho y cabe con margen', () => {
    const m = medidasPanel({ ancho: 640, alto: 800 });
    expect(m.modo).toBe('escritorio');
    expect(m.ancho).toBe(ANCHO_PANEL);
    expect(m.ancho + 2 * MARGEN_PANEL).toBeLessThanOrEqual(640);
  });
});

describe('medidasPanel en celular', () => {
  it('390x844: pantalla completa debajo de la barra', () => {
    const m = medidasPanel({ ancho: 390, alto: 844 });
    expect(m).toEqual({ modo: 'movil', arriba: ALTO_NAVBAR, alto: 844 - ALTO_NAVBAR });
  });

  it('con el teclado abierto usa el alto visible (el input queda encima del teclado)', () => {
    const m = medidasPanel({ ancho: 390, alto: 844, altoVisible: 500 });
    expect(m.alto).toBe(500 - ALTO_NAVBAR);
  });

  it('alto visible inválido o mayor a la ventana: usa el alto de la ventana', () => {
    expect(medidasPanel({ ancho: 390, alto: 844, altoVisible: NaN }).alto).toBe(844 - ALTO_NAVBAR);
    expect(medidasPanel({ ancho: 390, alto: 844, altoVisible: 0 }).alto).toBe(844 - ALTO_NAVBAR);
    expect(medidasPanel({ ancho: 390, alto: 844, altoVisible: 2000 }).alto).toBe(844 - ALTO_NAVBAR);
  });

  it('nunca da un alto negativo ni ridículo', () => {
    expect(medidasPanel({ ancho: 390, alto: 120 }).alto).toBe(ALTO_MIN_PANEL);
  });
});

describe('medidasPanel con datos inválidos', () => {
  it('sin medidas: escritorio con valores por defecto seguros', () => {
    const m = medidasPanel({});
    expect(m.modo).toBe('escritorio');
    expect(m.ancho).toBe(ANCHO_PANEL);
    expect(m.altoMax).toBeGreaterThanOrEqual(ALTO_MIN_PANEL);
    expect(m.altoMax).toBeLessThanOrEqual(ALTO_MAX_PANEL);
  });
  it('sin argumento no falla', () => {
    expect(() => medidasPanel()).not.toThrow();
  });
});
