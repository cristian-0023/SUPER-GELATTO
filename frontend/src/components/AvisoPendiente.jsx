import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { tomarAvisoPendiente } from '../utils/avisoPendiente';

// Muestra, en la página a la que se llegó, el aviso que dejó la anterior antes de irse (por ejemplo, el panel
// de admin cuando la cuenta ya no tiene permisos). Se lee una sola vez y se cierra solo a los 8 s.
const AvisoPendiente = () => {
  const location = useLocation();
  const [texto, setTexto] = useState(null);
  const temporizador = useRef(null);

  useEffect(() => {
    const pendiente = tomarAvisoPendiente();
    if (!pendiente) return;
    setTexto(pendiente);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setTexto(null), 8000);
  }, [location.key]);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  if (!texto) return null;
  return (
    <div
      role="alert"
      className="fixed z-[300] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md flex items-start gap-3 p-4 text-left rounded-2xl border border-red-500/40 bg-[#111116] shadow-[0_12px_32px_rgba(0,0,0,0.55)] animate-in fade-in slide-in-from-bottom-4 duration-300"
    >
      <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="flex-1 min-w-0 text-sm text-white/90 leading-snug">{texto}</p>
      <button
        type="button"
        onClick={() => setTexto(null)}
        aria-label="Cerrar aviso"
        className="shrink-0 -m-2 w-11 h-11 inline-flex items-center justify-center rounded-xl text-white/50 hover:text-white hover:bg-white/10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold-premium"
      >
        <X size={16} />
      </button>
    </div>
  );
};

export default AvisoPendiente;
