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
  debeCerrarConEscape,
  hayPropuestaPendiente,
  debeDevolverFoco,
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
  it('390x844 sin teclado: top = barra y bottom = 0 (sin alto en px calculado en JS); es modal', () => {
    const m = medidasPanel({ ancho: 390, alto: 844 });
    expect(m).toEqual({ modo: 'movil', modal: true, arriba: ALTO_NAVBAR, abajo: 0 });
  });

  it('teclado abierto (Android, offsetTop 0): el borde de abajo es el del área visible', () => {
    const m = medidasPanel({ ancho: 390, alto: 844, altoVisible: 500, desplazamientoVisible: 0 });
    expect(m).toEqual({ modo: 'movil', modal: true, arriba: ALTO_NAVBAR, alto: 500 - ALTO_NAVBAR });
  });

  it('teclado abierto (iOS, la vista se desplaza): suma visualViewport.offsetTop', () => {
    const m = medidasPanel({ ancho: 390, alto: 844, altoVisible: 500, desplazamientoVisible: 20 });
    // Área visible: de 20 a 520. El panel sigue empezando en la barra y termina en 520.
    expect(m.arriba).toBe(ALTO_NAVBAR);
    expect(m.arriba + m.alto).toBe(520);
  });

  it('iOS con mucho desplazamiento: el encabezado baja hasta el borde visible (no queda fuera de vista)', () => {
    const m = medidasPanel({ ancho: 390, alto: 844, altoVisible: 450, desplazamientoVisible: 300 });
    expect(m.arriba).toBe(300);
    expect(m.arriba + m.alto).toBe(750);
  });

  it('alto visible inválido o igual/mayor a la ventana: sin teclado (top/bottom)', () => {
    for (const altoVisible of [NaN, 0, 844, 2000, undefined]) {
      const m = medidasPanel({ ancho: 390, alto: 844, altoVisible });
      expect(m.abajo).toBe(0);
      expect(m.alto).toBeUndefined();
    }
  });

  it('desplazamiento inválido se toma como 0', () => {
    const m = medidasPanel({ ancho: 390, alto: 844, altoVisible: 500, desplazamientoVisible: -40 });
    expect(m.arriba + m.alto).toBe(500);
  });

  it('con teclado nunca da un alto negativo', () => {
    expect(medidasPanel({ ancho: 390, alto: 844, altoVisible: 60 }).alto).toBeGreaterThan(0);
  });

  it('escritorio no es modal', () => {
    expect(medidasPanel({ ancho: 1366, alto: 636 }).modal).toBe(false);
  });
});

describe('hayPropuestaPendiente', () => {
  it('true si algún mensaje tiene una confirmación de admin pendiente', () => {
    expect(hayPropuestaPendiente([{ id: 1 }, { id: 2, propuesta: { estado: 'pendiente' } }])).toBe(true);
  });
  it('false si están resueltas, no hay o la lista es inválida', () => {
    expect(hayPropuestaPendiente([{ id: 2, propuesta: { estado: 'resuelta' } }, { id: 3, propuesta: null }])).toBe(false);
    expect(hayPropuestaPendiente([])).toBe(false);
    expect(hayPropuestaPendiente(undefined)).toBe(false);
  });
});

describe('debeCerrarConEscape', () => {
  const esc = (extra = {}) => ({ key: 'Escape', defaultPrevented: false, ...extra });
  it('Escape sin nada pendiente cierra', () => {
    expect(debeCerrarConEscape(esc(), [{ id: 1 }])).toBe(true);
  });
  it('otra tecla no cierra', () => {
    expect(debeCerrarConEscape(esc({ key: 'Enter' }), [])).toBe(false);
  });
  it('no cierra si otro diálogo ya atendió el Escape (defaultPrevented)', () => {
    expect(debeCerrarConEscape(esc({ defaultPrevented: true }), [])).toBe(false);
  });
  it('no cierra con una confirmación de admin pendiente', () => {
    expect(debeCerrarConEscape(esc(), [{ id: 1, propuesta: { estado: 'pendiente' } }])).toBe(false);
  });
  it('evento inválido no cierra', () => {
    expect(debeCerrarConEscape(null, [])).toBe(false);
  });
});

describe('debeDevolverFoco (al cerrar, el foco vuelve al botón solo si estaba en el panel)', () => {
  const body = { nombre: 'body' };
  const dentro = { nombre: 'input' };
  const fuera = { nombre: 'buscador' };
  const panel = { contains: (el) => el === dentro };
  it('foco dentro del panel -> sí', () => {
    expect(debeDevolverFoco({ activo: dentro, panel, body })).toBe(true);
  });
  it('foco en otra parte de la página (por ejemplo, tras el auto-cierre) -> no', () => {
    expect(debeDevolverFoco({ activo: fuera, panel, body })).toBe(false);
  });
  it('foco perdido (body o nada, como al tocar en Safari) -> sí, para no dejarlo perdido', () => {
    expect(debeDevolverFoco({ activo: body, panel, body })).toBe(true);
    expect(debeDevolverFoco({ activo: null, panel, body })).toBe(true);
  });
  it('sin panel (ya desmontado) y foco en otra parte -> no', () => {
    expect(debeDevolverFoco({ activo: fuera, panel: null, body })).toBe(false);
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
