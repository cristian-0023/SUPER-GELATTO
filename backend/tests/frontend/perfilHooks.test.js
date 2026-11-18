// Reglas de los hooks en ProfilePage.jsx: React exige llamar los hooks siempre en el mismo orden, así que
// ningún useState / useEffect / useRef puede quedar después del `return <Navigate` (la salida temprana
// para quien no tiene sesión). Si no, al pasar de "sin sesión" a "con sesión" React se rompe.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ruta = fileURLToPath(new URL('../../../frontend/src/pages/ProfilePage.jsx', import.meta.url));
const codigo = readFileSync(ruta, 'utf8');

describe('ProfilePage: reglas de los hooks', () => {
  it('tiene la salida temprana a /register', () => {
    expect(codigo).toMatch(/return <Navigate/);
  });

  it('no llama hooks después de `return <Navigate`', () => {
    const despues = codigo.slice(codigo.indexOf('return <Navigate'));
    expect(despues).not.toMatch(/\buse(State|Effect|Ref)\s*\(/);
  });
});
