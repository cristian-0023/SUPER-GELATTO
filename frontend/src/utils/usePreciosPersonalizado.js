/**
 * usePreciosPersonalizado — pide los precios y límites del helado personalizado a la base
 * (/api/personalizado/precios) cada vez que se monta la pantalla que lo usa.
 * Devuelve { estado: 'cargando' | 'listo' | 'error', precios, reintentar }.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './api';
import { leerRespuestaPrecios } from './personalizado';

export function usePreciosPersonalizado() {
  const [estado, setEstado] = useState('cargando');
  const [precios, setPrecios] = useState(null);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setEstado('cargando');
    apiFetch('/api/personalizado/precios')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!vigente) return;
        const leidos = leerRespuestaPrecios(data);
        setPrecios(leidos);
        setEstado(leidos ? 'listo' : 'error');
      })
      .catch((err) => {
        if (!vigente) return;
        console.warn('No se pudieron cargar los precios del helado personalizado:', err);
        setPrecios(null);
        setEstado('error');
      });
    return () => { vigente = false; };
  }, [intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);
  return { estado, precios, reintentar };
}
