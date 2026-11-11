/**
 * SuperPointsContext.jsx — Única fuente de las reglas y del saldo de Super Points para toda la página.
 * Las reglas se piden una sola vez; el saldo, al iniciar sesión y cada vez que alguien llama a `refrescar()`
 * (por ejemplo después de pagar). Si algo no carga, `reglas`/`puntos` quedan en null y las pantallas
 * se muestran sin números de puntos.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { pedirReglas, pedirPuntos } from '../utils/superPointsApi';

const SuperPointsContext = createContext({
  reglas: null,
  cargandoReglas: false,
  puntos: null,
  cargandoPuntos: false,
  refrescar: async () => null,
});

export const useSuperPoints = () => useContext(SuperPointsContext);

export const SuperPointsProvider = ({ user, children }) => {
  const userId = user?.id;
  const [reglas, setReglas] = useState(null);
  const [cargandoReglas, setCargandoReglas] = useState(true);
  const [puntos, setPuntos] = useState(null);
  const [cargandoPuntos, setCargandoPuntos] = useState(false);
  const pedidoActual = useRef(0);

  useEffect(() => {
    let vivo = true;
    pedirReglas().then((r) => {
      if (!vivo) return;
      setReglas(r);
      setCargandoReglas(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  // Devuelve el resumen (primera página del historial) o null. Un pedido viejo no pisa a uno más nuevo.
  const refrescar = useCallback(async () => {
    const numero = ++pedidoActual.current;
    if (!userId) {
      setPuntos(null);
      setCargandoPuntos(false);
      return null;
    }
    setCargandoPuntos(true);
    const datos = await pedirPuntos({ limit: 20, offset: 0 });
    if (numero !== pedidoActual.current) return datos;
    setPuntos(datos);
    setCargandoPuntos(false);
    return datos;
  }, [userId]);

  useEffect(() => {
    setPuntos(null);
    refrescar();
  }, [refrescar]);

  const valor = useMemo(
    () => ({ reglas, cargandoReglas, puntos, cargandoPuntos, refrescar }),
    [reglas, cargandoReglas, puntos, cargandoPuntos, refrescar]
  );

  return <SuperPointsContext.Provider value={valor}>{children}</SuperPointsContext.Provider>;
};
