// Edición rápida de productos del panel (frontend/src/utils/edicionRapida.js).
import { describe, it, expect } from 'vitest';
import { leerEntero, decidirTrasGuardar, cambiarProducto } from '../../../frontend/src/utils/edicionRapida.js';

describe('leerEntero (sin truncar decimales)', () => {
  it.each([['5000', 5000], [5000, 5000], [' 12 ', 12], ['0', 0]])('%j -> %j', (valor, esperado) => {
    expect(leerEntero(valor, 0)).toEqual({ valor: esperado });
  });
  it.each(['1.5', 2.5, '12abc', 'abc', '', '   ', null, undefined, true, [5]])('%j -> "Debe ser un número entero"', (valor) => {
    const r = leerEntero(valor, 0);
    expect(r.valor).toBeUndefined();
    expect(r.error).toMatch(/^Debe ser un número entero/);
  });
  it('respeta el mínimo (precio desde 1, stock desde 0)', () => {
    expect(leerEntero('0', 1).error).toMatch(/^Debe ser un número entero/);
    expect(leerEntero('-1', 0).error).toMatch(/^Debe ser un número entero/);
    expect(leerEntero('1', 1)).toEqual({ valor: 1 });
  });
});

describe('decidirTrasGuardar', () => {
  it('respuesta OK -> "ok"', () => expect(decidirTrasGuardar({ ok: true, status: 200 })).toBe('ok'));
  it('401 -> "sesion" (sesión vencida: se revierte y se pide verificar de nuevo)', () => {
    expect(decidirTrasGuardar({ ok: false, status: 401 })).toBe('sesion');
  });
  it.each([400, 404, 500])('%i -> "revertir"', (status) => expect(decidirTrasGuardar({ ok: false, status })).toBe('revertir'));
  it('sin respuesta (error de conexión) -> "revertir"', () => expect(decidirTrasGuardar(null)).toBe('revertir'));
});

describe('cambiarProducto', () => {
  const PRODUCTOS = [{ id: 1, precio: 5000, price: 5000 }, { id: 2, precio: 7000, price: 7000 }];
  it('cambia solo el producto indicado (el id puede venir como texto) sin mutar la lista', () => {
    const nuevos = cambiarProducto(PRODUCTOS, '2', { precio: 8000, price: 8000 });
    expect(nuevos).toEqual([{ id: 1, precio: 5000, price: 5000 }, { id: 2, precio: 8000, price: 8000 }]);
    expect(PRODUCTOS[1].precio).toBe(7000);
  });
  it('lista vacía o ausente -> lista vacía', () => {
    expect(cambiarProducto(undefined, 1, { precio: 1 })).toEqual([]);
  });
});
