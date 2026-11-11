/**
 * superPointsApi.js — Pedidos de la página a las reglas y al saldo de Super Points.
 * Si algo falla devuelven null: la pantalla sigue sin los puntos y nunca muestra números inventados.
 * Se usa fetch directo (con getToken) y no apiFetch: con un 401 apiFetch saca al cliente a /login,
 * y un saldo que no carga no justifica expulsarlo de la página (el pago ya explica la sesión vencida).
 */
import { getToken } from './api';

const BASE_URL = import.meta.env.VITE_API_URL || '';

const esPositivo = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const esNumero = (n) => typeof n === 'number' && Number.isFinite(n);

/** Reglas públicas del programa: {pesosPorPunto, valorPunto, niveles} o null. */
export async function pedirReglas({ fetchFn = (...a) => fetch(...a), baseUrl = BASE_URL } = {}) {
  try {
    const res = await fetchFn(`${baseUrl}/api/points/rules`);
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.ok !== true) return null;
    if (!esPositivo(d.pesosPorPunto) || !esPositivo(d.valorPunto)) return null;
    if (!Array.isArray(d.niveles) || d.niveles.length === 0) return null;
    return { pesosPorPunto: d.pesosPorPunto, valorPunto: d.valorPunto, niveles: d.niveles };
  } catch {
    return null;
  }
}

/** Saldo, nivel e historial (paginado) de la sesión actual, o null si no hay sesión o algo falla. */
export async function pedirPuntos(
  { limit = 20, offset = 0 } = {},
  { fetchFn = (...a) => fetch(...a), getTokenFn = getToken, baseUrl = BASE_URL } = {}
) {
  const token = getTokenFn();
  if (!token) return null;
  try {
    const res = await fetchFn(`${baseUrl}/api/me/points?limit=${limit}&offset=${offset}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.ok !== true || !esNumero(d.saldo) || !esNumero(d.ganados) || !Array.isArray(d.movimientos)) return null;
    return d;
  } catch {
    return null;
  }
}
