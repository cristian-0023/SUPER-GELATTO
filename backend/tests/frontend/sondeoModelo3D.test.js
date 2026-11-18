// Sondeo del modelo 3D en el panel (frontend/src/utils/sondeoModelo3D.js). Contrato:
//  - Pregunta cada 3 s; mientras el servidor responde "Guardando el modelo…" (copia al bucket), cada 10 s.
//  - Para al llegar "listo" (avisa con el modelo) o "error", y corta con error a los 50 intentos.
//  - Nunca hay dos consultas a la vez (la siguiente se programa cuando termina la anterior).
//  - detener() corta todo, aunque haya una consulta en vuelo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  crearSondeoModelo3D, INTERVALO_MODELO_MS, INTERVALO_GUARDANDO_MS, MAXIMO_INTENTOS_MODELO, MENSAJE_GUARDANDO_MODELO,
} from '../../../frontend/src/utils/sondeoModelo3D.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const crear = (respuestas) => {
  const consultar = vi.fn(async () => (typeof respuestas === 'function' ? respuestas() : respuestas.shift()));
  const alListo = vi.fn();
  const alError = vi.fn();
  const sondeo = crearSondeoModelo3D({ consultar, alListo, alError });
  return { consultar, alListo, alError, sondeo };
};

describe('sondeo del modelo 3D', () => {
  it('usa 3 s normalmente y 10 s mientras el servidor guarda el modelo', () => {
    expect(INTERVALO_MODELO_MS).toBe(3000);
    expect(INTERVALO_GUARDANDO_MS).toBe(10000);
    expect(MENSAJE_GUARDANDO_MODELO).toBe('Guardando el modelo…');
  });

  it('pregunta cada 3 s mientras Tripo genera', async () => {
    const { consultar } = crear(() => ({ estado: 'generando', message: 'Generando estructura 3D en Tripo AI (40%)...' }));
    await vi.advanceTimersByTimeAsync(2999);
    expect(consultar).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('mientras el mensaje es "Guardando el modelo…", espera 10 s entre consultas', async () => {
    const { consultar } = crear(() => ({ estado: 'generando', message: 'Guardando el modelo…' }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9999);
    expect(consultar).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('para y avisa al llegar "listo"', async () => {
    const listo = { estado: 'listo', glb_url: 'https://x.test/m.glb' };
    const { consultar, alListo, alError } = crear([{ estado: 'generando' }, listo]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(alListo).toHaveBeenCalledWith(listo);
    expect(alError).not.toHaveBeenCalled();
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  it('para y avisa al llegar "error"', async () => {
    const { consultar, alError } = crear([{ estado: 'error' }]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(alError).toHaveBeenCalledTimes(1);
    expect(consultar).toHaveBeenCalledTimes(1);
  });

  it('una consulta que falla (red) no corta el sondeo', async () => {
    let n = 0;
    const { consultar, alListo } = crear(() => {
      n++;
      if (n === 1) throw new Error('sin red');
      return n === 1 ? null : { estado: 'listo' };
    });
    await vi.advanceTimersByTimeAsync(6000);
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(alListo).toHaveBeenCalledTimes(1);
  });

  it(`corta con error a los ${50} intentos`, async () => {
    const { consultar, alError } = crear(() => ({ estado: 'generando' }));
    expect(MAXIMO_INTENTOS_MODELO).toBe(50);
    await vi.advanceTimersByTimeAsync(3000 * 60);
    expect(consultar).toHaveBeenCalledTimes(50);
    expect(alError).toHaveBeenCalledTimes(1);
  });

  it('detener() corta el sondeo, aunque haya una consulta en vuelo', async () => {
    let soltar;
    const consultar = vi.fn(() => new Promise((r) => { soltar = r; }));
    const alListo = vi.fn();
    const sondeo = crearSondeoModelo3D({ consultar, alListo, alError: vi.fn() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(consultar).toHaveBeenCalledTimes(1);
    sondeo.detener();
    soltar({ estado: 'listo' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(alListo).not.toHaveBeenCalled();
    expect(consultar).toHaveBeenCalledTimes(1);
  });
});
