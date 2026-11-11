/**
 * PuntosSelector.jsx — Elegir cuántos Super Points usar al pagar.
 * Solo muestra y pide; el servidor valida y decide el total final. Recibe las cuentas ya hechas.
 */
import React, { useId } from 'react';
import { Star } from 'lucide-react';
import { formatPrice } from '../context/CartContext';

const numero = new Intl.NumberFormat('es-CO');

const PuntosSelector = ({ resumen, calculo, elegidos, onChange, puntosAGanar, disabled = false }) => {
  const id = useId();
  const { maximo, puntos, descuento } = calculo;

  return (
    <section aria-labelledby={`${id}-titulo`} className="rounded-2xl border border-gold-premium/20 bg-gold-premium/[0.04] p-4 space-y-3 text-left">
      <div className="flex items-center justify-between gap-3">
        <h4 id={`${id}-titulo`} className="text-sm font-bold flex items-center gap-2">
          <Star size={14} className="text-gold-premium fill-gold-premium" /> Paga con tus puntos
        </h4>
        <span className="text-xs font-bold text-gold-premium tabular-nums">{numero.format(resumen.saldo)} pts</span>
      </div>

      {maximo === 0 ? (
        <p className="text-xs text-white/50 leading-relaxed">
          {resumen.saldo === 0
            ? 'Aún no tienes puntos para canjear.'
            : `Con tu nivel ${resumen.nivel} esta compra es muy pequeña para canjear puntos.`}
          {puntosAGanar > 0 && <> Con esta compra ganarás <strong className="text-white">+{numero.format(puntosAGanar)}</strong>.</>}
        </p>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <label htmlFor={`${id}-input`} className="text-[11px] font-bold text-white/40 uppercase tracking-wider">
                Puntos a usar
              </label>
              <input
                id={`${id}-input`}
                type="number"
                inputMode="numeric"
                min={0}
                max={maximo}
                step={1}
                disabled={disabled}
                value={elegidos}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => onChange(String(puntos))}
                className="input-field tabular-nums"
              />
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(String(maximo))}
              className="px-4 min-h-[44px] rounded-xl text-xs font-bold border border-gold-premium/30 text-gold-premium hover:bg-gold-premium/10 transition-colors disabled:opacity-40"
            >
              Usar el máximo
            </button>
          </div>

          <input
            type="range"
            min={0}
            max={maximo}
            step={1}
            disabled={disabled}
            value={puntos}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Puntos a usar"
            className="w-full accent-[#d4af37]"
          />

          <p className="text-xs text-white/50 leading-relaxed">
            Puedes usar hasta <strong className="text-white tabular-nums">{numero.format(maximo)}</strong> puntos
            {resumen.pctMax ? <> (tu nivel {resumen.nivel} permite pagar {resumen.pctMax} % de la compra con puntos)</> : null}.
          </p>

          {puntos > 0 && (
            <p className="text-sm font-bold text-green-400 tabular-nums" aria-live="polite">
              Descuento por puntos: −{formatPrice(descuento)}
            </p>
          )}
          {puntosAGanar > 0 && (
            <p className="text-xs text-white/40">Con esta compra ganarás +{numero.format(puntosAGanar)} puntos.</p>
          )}
        </>
      )}
    </section>
  );
};

export default PuntosSelector;
