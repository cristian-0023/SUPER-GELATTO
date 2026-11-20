// Revisión del código fuente de GelatoBuilder3D.jsx (el frontend no tiene pruebas de componentes):
//  - No precarga las listas completas de modelos; solo cono y vainilla, vía modelosAPrecargar.
//  - Una sola región role="status" fuera del Canvas, con texto legible (12 px o más).
//  - Cada pieza (base, sabor, topping) va dentro de su propio límite de errores.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const fuente = fs.readFileSync(path.resolve(__dirname, '../../../frontend/src/components/GelatoBuilder3D.jsx'), 'utf8');

describe('GelatoBuilder3D: precarga', () => {
  it('no hace preload sobre las listas completas de modelos', () => {
    expect(fuente).not.toMatch(/\[\s*\.\.\.containers\s*,\s*\.\.\.DEFAULT_SCOOPS/);
    expect(fuente).not.toMatch(/(containers|DEFAULT_SCOOPS|toppingsData)\s*\.forEach\([^)]*\)\s*=>\s*\{?\s*useGLTF\.preload/);
  });

  it('precarga solo la base y el sabor por defecto con modelosAPrecargar', () => {
    expect(fuente).toMatch(/modelosAPrecargar\(\s*containers\s*,\s*'cone'\s*\)/);
    expect(fuente).toMatch(/modelosAPrecargar\(\s*DEFAULT_SCOOPS\s*,\s*'vanilla'\s*\)/);
    expect(fuente).not.toMatch(/modelosAPrecargar\(\s*toppingsData/);
  });
});

describe('GelatoBuilder3D: región de estado accesible', () => {
  it('hay exactamente una región role="status" y está en el componente principal, fuera del Canvas', () => {
    const coincidencias = fuente.match(/role="status"/g) || [];
    expect(coincidencias).toHaveLength(1);
    const posStatus = fuente.indexOf('role="status"');
    expect(posStatus).toBeGreaterThan(fuente.indexOf('const GelatoBuilder3D ='));
    // No puede estar dentro de un <Html> de drei (eso vive dentro del Canvas).
    const antes = fuente.slice(0, posStatus);
    expect(antes.lastIndexOf('<Html')).toBeLessThan(antes.lastIndexOf('</Html>'));
  });

  it('la región usa texto de 12 px o más', () => {
    const posStatus = fuente.indexOf('role="status"');
    const etiqueta = fuente.slice(fuente.lastIndexOf('<', posStatus), fuente.indexOf('>', posStatus) + 1);
    expect(etiqueta).not.toMatch(/text-\[(8|9|10|11)px\]/);
  });
});

describe('GelatoBuilder3D: errores por pieza', () => {
  it('base, sabores y toppings tienen cada uno su límite de errores alrededor del Suspense', () => {
    const limites = fuente.match(/<PiezaSegura\b/g) || [];
    expect(limites.length).toBe(3);
  });
});

// Helado personalizado pagable: la línea del carrito lleva la composición y el precio sale de la base.
const leerFuente = (rel) => fs.readFileSync(path.resolve(__dirname, '../../../frontend/src', rel), 'utf8');

describe('GelatoBuilder3D: helado personalizado pagable', () => {
  it('ya no inventa un producto custom-<fecha> ni calcula el precio con números fijos', () => {
    expect(fuente).not.toMatch(/custom-\$\{Date\.now\(\)\}/);
    expect(fuente).not.toMatch(/basePrice\s*=\s*10000/);
    expect(fuente).not.toMatch(/\*\s*2000/);
  });

  it('arma la línea con armarItemPersonalizado y muestra precios de /api/personalizado/precios', () => {
    expect(fuente).toMatch(/armarItemPersonalizado\(/);
    expect(fuente).toMatch(/precioPersonalizado\(/);
    expect(fuente).toMatch(/['"`]\/api\/personalizado\/precios['"`]/);
  });
});

describe('carrito, checkout y panel muestran la composición', () => {
  it('el carrito limpia los personalizados viejos al cargar', () => {
    expect(leerFuente('context/CartContext.jsx')).toMatch(/limpiarCarritoGuardado\(/);
  });

  it('el carrito y el checkout muestran el detalle del personalizado', () => {
    expect(leerFuente('components/CartDrawer.jsx')).toMatch(/item\.detalle/);
    expect(leerFuente('pages/CheckoutPage.jsx')).toMatch(/item\.detalle/);
  });

  it('el panel pide el detalle de una venta con su composición', () => {
    const panel = leerFuente('pages/AdminDashboard.jsx');
    expect(panel).toMatch(/\/api\/admin\/sales\/\$\{[^}]+\}\/items/);
    expect(panel).toMatch(/describirPersonalizacion\(/);
  });
});
