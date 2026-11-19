// Regla del selector de rol del panel (frontend/src/utils/permisosUsuarios.js), igual que el servidor
// (SEC-001): solo el super admin cambia roles, y nadie toca el rol de la cuenta del super admin.
import { describe, it, expect } from 'vitest';
import { puedeEditarRol } from '../../../frontend/src/utils/permisosUsuarios.js';

describe('puedeEditarRol', () => {
  it('admin normal NO puede ascender a un cliente', () => {
    expect(puedeEditarRol({ esObjetivoSuperAdmin: false, soySuperAdmin: false })).toBe(false);
  });

  it('admin normal NO puede bajar a otro admin', () => {
    expect(puedeEditarRol({ esObjetivoSuperAdmin: false, soySuperAdmin: false })).toBe(false);
  });

  it('super admin puede cambiar el rol de un cliente y de un admin', () => {
    expect(puedeEditarRol({ esObjetivoSuperAdmin: false, soySuperAdmin: true })).toBe(true);
    expect(puedeEditarRol({ esObjetivoSuperAdmin: false, soySuperAdmin: true })).toBe(true);
  });

  it('nadie cambia el rol de la cuenta del super admin, ni él mismo', () => {
    expect(puedeEditarRol({ esObjetivoSuperAdmin: true, soySuperAdmin: true })).toBe(false);
    expect(puedeEditarRol({ esObjetivoSuperAdmin: true, soySuperAdmin: false })).toBe(false);
  });

  it('sin datos (valores ausentes) no habilita el selector', () => {
    expect(puedeEditarRol({})).toBe(false);
  });
});
