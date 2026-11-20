// La altura de la barra superior fija vive en un solo lugar (frontend/src/utils/layout.js) y la leen
// tanto Navbar.jsx como el panel de Gelbot. Si alguien vuelve a escribir "80px" a mano en la barra,
// el panel del chat podría quedar debajo de ella: esta prueba lo detecta.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALTO_NAVBAR } from '../../../frontend/src/utils/layout.js';
import { ALTO_NAVBAR as ALTO_EN_PANEL } from '../../../frontend/src/utils/panelGelbot.js';

const navbar = readFileSync(fileURLToPath(new URL('../../../frontend/src/components/Navbar.jsx', import.meta.url)), 'utf8');

describe('altura de la barra superior', () => {
  it('es un número positivo', () => {
    expect(Number.isInteger(ALTO_NAVBAR) && ALTO_NAVBAR > 0).toBe(true);
  });
  it('el panel de Gelbot usa la misma constante', () => {
    expect(ALTO_EN_PANEL).toBe(ALTO_NAVBAR);
  });
  it('Navbar.jsx importa la constante y no tiene la altura escrita a mano', () => {
    expect(navbar).toMatch(/import\s*\{[^}]*\bALTO_NAVBAR\b[^}]*\}\s*from\s*['"]\.\.\/utils\/layout['"]/);
    expect(navbar).not.toMatch(/h-\[\d+px\]/);
    expect(navbar).not.toMatch(/calc\(100vh\s*-\s*\d+px\)/);
  });
});
