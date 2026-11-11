// Pedidos de la página a /api/points/rules y /api/me/points (frontend/src/utils/superPointsApi.js).
// Si algo falla, devuelven null: la pantalla sigue funcionando sin los puntos y nunca inventa números.
import { describe, it, expect, vi } from 'vitest';
import { pedirReglas, pedirPuntos } from '../../../frontend/src/utils/superPointsApi.js';

const reglasOk = {
  ok: true,
  pesosPorPunto: 100,
  valorPunto: 5,
  niveles: [
    { nombre: 'Lover', min: 0, max: 100, pct: 5 },
    { nombre: 'Master', min: 1001, max: null, pct: 20 },
  ],
};

const respuesta = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });

describe('pedirReglas', () => {
  it('devuelve las reglas del servidor sin pedir sesión', async () => {
    const fetchFn = vi.fn().mockResolvedValue(respuesta(200, reglasOk));

    const reglas = await pedirReglas({ fetchFn, baseUrl: 'http://api' });

    expect(reglas).toEqual({ pesosPorPunto: 100, valorPunto: 5, niveles: reglasOk.niveles });
    expect(fetchFn).toHaveBeenCalledWith('http://api/api/points/rules');
  });

  it('null si el servidor falla, no responde o manda datos incompletos', async () => {
    expect(await pedirReglas({ fetchFn: vi.fn().mockResolvedValue(respuesta(500, { ok: false })) })).toBeNull();
    expect(await pedirReglas({ fetchFn: vi.fn().mockRejectedValue(new Error('sin red')) })).toBeNull();
    expect(await pedirReglas({ fetchFn: vi.fn().mockResolvedValue(respuesta(200, { ok: true, valorPunto: 5 })) })).toBeNull();
    expect(await pedirReglas({ fetchFn: vi.fn().mockResolvedValue(respuesta(200, { ...reglasOk, niveles: [] })) })).toBeNull();
    expect(await pedirReglas({ fetchFn: vi.fn().mockResolvedValue(respuesta(200, { ...reglasOk, valorPunto: 0 })) })).toBeNull();
  });
});

const puntosOk = {
  ok: true,
  saldo: 400,
  ganados: 450,
  nivel: 'Fan',
  pctMax: 10,
  valorSaldo: 2000,
  puntosParaSiguiente: 51,
  siguienteNivel: 'Pro',
  movimientos: [{ tipo: 'ganado', puntos: 180, fecha: '2026-11-01T10:00:00Z', idVenta: 7 }],
  limit: 20,
  offset: 0,
  hayMas: false,
};

describe('pedirPuntos', () => {
  it('manda el token, la paginación y devuelve el resumen', async () => {
    const fetchFn = vi.fn().mockResolvedValue(respuesta(200, puntosOk));

    const datos = await pedirPuntos({ limit: 20, offset: 40 }, { fetchFn, getTokenFn: () => 'tok', baseUrl: 'http://api' });

    expect(datos).toEqual(puntosOk);
    const [url, opciones] = fetchFn.mock.calls[0];
    expect(url).toBe('http://api/api/me/points?limit=20&offset=40');
    expect(opciones.headers.Authorization).toBe('Bearer tok');
  });

  it('sin token no pide nada', async () => {
    const fetchFn = vi.fn();

    expect(await pedirPuntos({}, { fetchFn, getTokenFn: () => null })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('401, error del servidor, red caída o respuesta incompleta -> null', async () => {
    const con = (fetchFn) => pedirPuntos({}, { fetchFn, getTokenFn: () => 'tok' });

    expect(await con(vi.fn().mockResolvedValue(respuesta(401, { ok: false })))).toBeNull();
    expect(await con(vi.fn().mockResolvedValue(respuesta(500, { ok: false })))).toBeNull();
    expect(await con(vi.fn().mockRejectedValue(new Error('sin red')))).toBeNull();
    expect(await con(vi.fn().mockResolvedValue(respuesta(200, { ok: true })))).toBeNull();
    expect(await con(vi.fn().mockResolvedValue(respuesta(200, { ...puntosOk, movimientos: 'x' })))).toBeNull();
  });
});
