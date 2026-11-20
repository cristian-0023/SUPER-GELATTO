/**
 * api.js — Centralized API helper for Super Gelatto frontend.
 *
 * Automatically attaches the Authorization: Bearer <token> header to every
 * request. On 401 responses it clears the session and redirects to /login,
 * preventing stale/expired tokens from leaving the user in a broken state.
 */

import { borrarSesion } from './sesion';

const BASE_URL = import.meta.env.VITE_API_URL || '';

/**
 * Retrieve the stored JWT token from sessionStorage.
 */
export function getToken() {
  return localStorage.getItem('superGelatto_token') || sessionStorage.getItem('superGelatto_token') || null;
}

/**
 * Remove session data (token + user) and redirect to the login page.
 * Called automatically on 401 responses.
 */
export function clearSessionAndRedirect() {
  borrarSesion();
  // Use window.location so it works outside React component tree too
  window.location.href = '/login';
}

/**
 * Drop-in replacement for fetch() that:
 *  - Prepends BASE_URL to relative paths
 *  - Adds `Content-Type: application/json` by default
 *  - Attaches `Authorization: Bearer <token>` when a token exists
 *  - Calls clearSessionAndRedirect() on 401 responses only (a 403 is returned to the caller)
 *
 * @param {string} path  - API path (e.g. '/api/admin/dashboard')
 * @param {RequestInit} options - Standard fetch options
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // Solo 401 significa sesión vencida o inválida. Un 403 es "no tienes permiso para esto": la sesión
  // sigue y la respuesta vuelve a quien llamó para que muestre el mensaje del servidor.
  if (response.status === 401) {
    clearSessionAndRedirect();
  }

  return response;
}
