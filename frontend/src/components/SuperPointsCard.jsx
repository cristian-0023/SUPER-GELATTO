/**
 * SuperPointsCard.jsx — Tarjeta VIP del perfil: saldo real, valor en plata, nivel, avance al siguiente
 * nivel e historial paginado. Todo viene del servidor (contexto de Super Points); nada está fijo aquí.
 */
import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Crown, Sparkles, ChevronRight, ChevronDown, Loader2, PlusCircle, MinusCircle, Undo2, XCircle, Star } from 'lucide-react';
import { formatPrice } from '../context/CartContext';
import { useSuperPoints } from '../context/SuperPointsContext';
import { pedirPuntos } from '../utils/superPointsApi';
import { progresoNivel, describirMovimiento, puntosConSigno } from '../utils/superPoints';

const numero = new Intl.NumberFormat('es-CO');
const ICONO_MOVIMIENTO = {
  ganado: { Icono: PlusCircle, color: 'text-green-400' },
  canjeado: { Icono: MinusCircle, color: 'text-gold-premium' },
  devuelto: { Icono: Undo2, color: 'text-cyan-400' },
  revertido: { Icono: XCircle, color: 'text-red-400' },
};

const formatoFecha = (iso) => {
  const f = new Date(iso);
  return Number.isNaN(f.getTime()) ? '' : f.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
};

const FondoVip = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, scale: 0.98 }}
    animate={{ opacity: 1, scale: 1 }}
    transition={{ duration: 0.5 }}
    className="relative overflow-hidden rounded-[24px] sm:rounded-[32px] p-6 sm:p-10 bg-gradient-to-br from-[#1a1c29] via-[#11121a] to-[#0a0b10] border border-white/5 shadow-2xl text-left"
  >
    <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-gold-premium/5 blur-[120px] rounded-full pointer-events-none" />
    <div className="absolute bottom-0 left-0 w-[300px] h-[300px] bg-pastel-pink/5 blur-[100px] rounded-full pointer-events-none" />
    <div className="relative z-10">{children}</div>
  </motion.div>
);

const SuperPointsCard = () => {
  const { reglas, puntos, cargandoPuntos, refrescar } = useSuperPoints();
  const [extra, setExtra] = useState([]);
  const [hayMasExtra, setHayMasExtra] = useState(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState(false);
  const [historialAbierto, setHistorialAbierto] = useState(true);

  // El saldo puede haber cambiado desde que se inició sesión (compras, cancelaciones): se pide al entrar.
  useEffect(() => {
    refrescar();
  }, [refrescar]);

  // Cuando llega un resumen nuevo, el historial vuelve a empezar desde la primera página.
  useEffect(() => {
    setExtra([]);
    setHayMasExtra(null);
    setErrorMas(false);
  }, [puntos]);

  if (!puntos) {
    return (
      <FondoVip>
        <h3 className="text-3xl sm:text-4xl font-playfair font-bold text-white flex items-center gap-3 mb-4">
          SuperPoints <Sparkles className="text-pastel-pink" size={24} />
        </h3>
        {cargandoPuntos ? (
          <p className="text-white/50 text-sm flex items-center gap-2" role="status">
            <Loader2 size={16} className="animate-spin" /> Cargando tus puntos...
          </p>
        ) : (
          <div className="space-y-4">
            <p className="text-white/60 text-sm" role="alert">No pudimos cargar tus SuperPoints. Tus compras y tu saldo están a salvo.</p>
            <button
              type="button"
              onClick={refrescar}
              className="px-5 min-h-[44px] rounded-full text-xs font-bold bg-white/10 border border-white/10 hover:bg-white/15 transition-colors"
            >
              Intentar de nuevo
            </button>
          </div>
        )}
      </FondoVip>
    );
  }

  const movimientos = [...puntos.movimientos, ...extra];
  const hayMas = hayMasExtra ?? puntos.hayMas;
  const progreso = reglas ? progresoNivel(puntos.ganados, reglas.niveles) : null;
  const esMaster = !puntos.siguienteNivel;

  const verMas = async () => {
    setCargandoMas(true);
    setErrorMas(false);
    const pagina = await pedirPuntos({ limit: 20, offset: movimientos.length });
    if (pagina) {
      setExtra((previos) => [...previos, ...pagina.movimientos]);
      setHayMasExtra(pagina.hayMas);
    } else {
      setErrorMas(true);
    }
    setCargandoMas(false);
  };

  return (
    <FondoVip>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 sm:mb-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-gold-premium/10 rounded-full border border-gold-premium/20 mb-4">
            <Crown size={14} className="text-gold-premium" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-gold-premium">Membresía Elite</span>
          </div>
          <h3 className="text-3xl sm:text-4xl font-playfair font-bold text-white flex items-center gap-3 mb-2">
            SuperPoints <Sparkles className="text-pastel-pink animate-pulse" size={24} />
          </h3>
          <p className="text-white/40 text-sm">
            Nivel actual: <span className="text-white font-bold italic bg-white/5 px-3 py-1 rounded-lg ml-2 border border-white/5">{puntos.nivel}</span>
          </p>
        </div>

        <div className="bg-black/40 p-5 sm:p-6 rounded-[24px] backdrop-blur-xl border border-white/10 shadow-xl w-full md:w-auto">
          <p className="text-[10px] text-white/50 uppercase tracking-widest font-bold mb-2">Tu saldo</p>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl sm:text-5xl font-bold text-gold-premium tabular-nums">{numero.format(puntos.saldo)}</span>
            <span className="text-white/40 text-sm font-medium">pts</span>
          </div>
          <p className="text-sm text-white/60 mt-2 tabular-nums">
            Equivale a <strong className="text-white">{formatPrice(puntos.valorSaldo)}</strong> de descuento
          </p>
        </div>
      </div>

      {/* Avance al siguiente nivel */}
      <div className="mb-8 sm:mb-10">
        {esMaster ? (
          <p className="text-sm text-white/60">Estás en el nivel más alto. Gracias por ser parte del club.</p>
        ) : (
          <>
            <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold text-white/50 mb-3 mx-1">
              <span>{puntos.nivel}</span>
              <span className="text-gold-premium/80">{puntos.siguienteNivel}</span>
            </div>
            {progreso && (
              <div
                className="h-5 w-full bg-black/50 rounded-full overflow-hidden p-1 border border-white/5"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progreso.porcentaje}
                aria-label={`Avance hacia el nivel ${puntos.siguienteNivel}`}
              >
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progreso.porcentaje}%` }}
                  transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
                  className="h-full rounded-full bg-gradient-to-r from-pastel-pink via-gold-premium to-yellow-200"
                />
              </div>
            )}
            <p className="text-white/50 text-xs sm:text-sm mt-4">
              Te faltan <strong className="text-gold-premium tabular-nums">{numero.format(puntos.puntosParaSiguiente)} puntos</strong> para el nivel {puntos.siguienteNivel}.
            </p>
          </>
        )}
        <p className="text-white/50 text-xs sm:text-sm mt-2">
          Al pagar puedes cubrir hasta <strong className="text-white">{puntos.pctMax} %</strong> de tu compra con puntos.
        </p>
      </div>

      {/* Historial */}
      <div className="border-t border-white/10 pt-6">
        <button
          type="button"
          onClick={() => setHistorialAbierto((abierto) => !abierto)}
          aria-expanded={historialAbierto}
          aria-controls="historial-puntos"
          className="text-white/60 hover:text-white transition-colors flex items-center gap-1.5 font-bold uppercase text-[10px] tracking-widest min-h-[44px]"
        >
          Historial de puntos <ChevronDown size={12} className={`transition-transform ${historialAbierto ? 'rotate-180' : ''}`} />
        </button>

        {historialAbierto && (
          <div id="historial-puntos">
            {movimientos.length === 0 ? (
              <p className="text-white/50 text-sm py-4 leading-relaxed">
                Todavía no tienes movimientos.
                {reglas ? ` Por cada $${numero.format(reglas.pesosPorPunto)} que pagues en una compra ganas 1 punto.` : ''}
              </p>
            ) : (
              <ul className="divide-y divide-white/5">
                {movimientos.map((m, i) => {
                  const { titulo, detalle } = describirMovimiento(m);
                  const { Icono, color } = ICONO_MOVIMIENTO[m.tipo] || { Icono: Star, color: 'text-white/50' };
                  return (
                    <li key={`${m.tipo}-${m.idVenta}-${i}`} className="flex items-center gap-3 py-3">
                      <Icono size={18} className={`${color} flex-shrink-0`} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{titulo}</p>
                        <p className="text-xs text-white/50 truncate">{detalle}{formatoFecha(m.fecha) && ` · ${formatoFecha(m.fecha)}`}</p>
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${m.puntos > 0 ? 'text-green-400' : m.puntos < 0 ? 'text-gold-premium' : 'text-white/50'}`}>
                        {puntosConSigno(m.puntos)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {errorMas && <p className="text-xs text-red-300/80 py-2" role="alert">No pudimos cargar más movimientos. Intenta de nuevo.</p>}
            {hayMas && (
              <button
                type="button"
                onClick={verMas}
                disabled={cargandoMas}
                className="mt-3 px-5 min-h-[44px] rounded-full text-xs font-bold bg-white/5 border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {cargandoMas && <Loader2 size={14} className="animate-spin" />} Ver más
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        <Link
          to="/productos"
          className="flex items-center justify-center gap-2 py-3.5 sm:py-4 bg-gradient-to-r from-gold-premium to-yellow-500 text-background-dark hover:shadow-[0_0_25px_rgba(212,175,55,0.3)] transition-all rounded-[18px] text-xs sm:text-sm font-bold min-h-[48px]"
        >
          Usar mis puntos en una compra <ChevronRight size={18} />
        </Link>
      </div>
    </FondoVip>
  );
};

export default SuperPointsCard;
