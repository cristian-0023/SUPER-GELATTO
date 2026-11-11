// Sondeo de la página (frontend/src/utils/sondeo.js): pedir datos cada cierto tiempo SIN saturar el servidor.
//  - Intervalo razonable (30 s por defecto), no cada 2-3 s.
//  - Pausa mientras la pestaña está oculta y refresca al volver.
//  - Nunca dos peticiones iguales a la vez (si una está en curso, se reutiliza).
//  - urlSinCache: el panel de admin pide la lista saltándose la caché del CDN para ver sus cambios al instante.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearSondeo, unaALaVez, urlSinCache, INTERVALO_SONDEO_MS } from '../../../frontend/src/utils/sondeo.js';

// Documento falso: solo lo que usa el sondeo (visibilityState y el evento visibilitychange).
function documentoFalso() {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  doc.cambiarVisibilidad = (estado) => {
    doc.visibilityState = estado;
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return doc;
}

// Promesa que se resuelve a mano, para simular una petición lenta.
function diferida() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('INTERVALO_SONDEO_MS', () => {
  it('es de 30 segundos', () => {
    expect(INTERVALO_SONDEO_MS).toBe(30000);
  });
});

describe('unaALaVez', () => {
  it('si ya hay una petición en curso, la reutiliza en vez de lanzar otra', async () => {
    const lenta = diferida();
    const tarea = vi.fn(() => lenta.promesa);
    const pedir = unaALaVez(tarea);

    const a = pedir();
    const b = pedir();
    expect(tarea).toHaveBeenCalledTimes(1);
    lenta.resolver('datos');
    expect(await a).toBe('datos');
    expect(await b).toBe('datos');
  });

  it('cuando la anterior terminó (bien o mal), la siguiente sí sale', async () => {
    const tarea = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValueOnce('ok');
    const pedir = unaALaVez(tarea);

    await expect(pedir()).rejects.toThrow('sin red');
    expect(await pedir()).toBe('ok');
    expect(tarea).toHaveBeenCalledTimes(2);
  });

  it('pasa los argumentos a la tarea', async () => {
    const tarea = vi.fn(async (x) => x * 2);
    expect(await unaALaVez(tarea)(21)).toBe(42);
  });
});

describe('crearSondeo', () => {
  it('pide al iniciar y luego cada 30 s (no cada 2-3 s)', async () => {
    const tarea = vi.fn(async () => {});
    const sondeo = crearSondeo(tarea, { documento: documentoFalso() });

    sondeo.iniciar();
    expect(tarea).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29999);
    expect(tarea).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tarea).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30000);
    expect(tarea).toHaveBeenCalledTimes(3);
    sondeo.detener();
  });

  it('se pausa con la pestaña oculta y refresca al volver', async () => {
    const doc = documentoFalso();
    const tarea = vi.fn(async () => {});
    const sondeo = crearSondeo(tarea, { documento: doc });
    sondeo.iniciar();
    tarea.mockClear();

    doc.cambiarVisibilidad('hidden');
    await vi.advanceTimersByTimeAsync(5 * 60000);
    expect(tarea).not.toHaveBeenCalled();

    doc.cambiarVisibilidad('visible');
    expect(tarea).toHaveBeenCalledTimes(1); // refresco inmediato al volver
    await vi.advanceTimersByTimeAsync(30000);
    expect(tarea).toHaveBeenCalledTimes(2); // y sigue el ritmo normal
    sondeo.detener();
  });

  it('si la pestaña ya está oculta al iniciar, no pide hasta que se vea', async () => {
    const doc = documentoFalso();
    doc.visibilityState = 'hidden';
    const tarea = vi.fn(async () => {});
    const sondeo = crearSondeo(tarea, { documento: doc });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(60000);
    expect(tarea).not.toHaveBeenCalled();

    doc.cambiarVisibilidad('visible');
    expect(tarea).toHaveBeenCalledTimes(1);
    sondeo.detener();
  });

  it('nunca lanza una petición mientras otra igual está en curso', async () => {
    const lenta = diferida();
    const tarea = vi.fn(() => lenta.promesa);
    const sondeo = crearSondeo(tarea, { intervaloMs: 1000, documento: documentoFalso() });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(5000); // 5 "tics" con la primera sin terminar
    sondeo.refrescar();
    expect(tarea).toHaveBeenCalledTimes(1);

    lenta.resolver();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tarea).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('un error en la tarea no rompe el sondeo', async () => {
    const tarea = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue('ok');
    const sondeo = crearSondeo(tarea, { intervaloMs: 1000, documento: documentoFalso() });

    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tarea).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });

  it('detener corta el intervalo y deja de escuchar la visibilidad', async () => {
    const doc = documentoFalso();
    const tarea = vi.fn(async () => {});
    const sondeo = crearSondeo(tarea, { documento: doc });
    sondeo.iniciar();
    tarea.mockClear();

    sondeo.detener();
    await vi.advanceTimersByTimeAsync(120000);
    doc.cambiarVisibilidad('hidden');
    doc.cambiarVisibilidad('visible');
    expect(tarea).not.toHaveBeenCalled();
  });

  it('refrescar pide en el momento (por ejemplo, tras guardar un cambio)', async () => {
    const tarea = vi.fn(async () => 'x');
    const sondeo = crearSondeo(tarea, { documento: documentoFalso() });
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(0);
    tarea.mockClear();

    expect(await sondeo.refrescar()).toBe('x');
    expect(tarea).toHaveBeenCalledTimes(1);
    sondeo.detener();
  });

  it('funciona sin documento (por ejemplo, fuera del navegador)', async () => {
    const tarea = vi.fn(async () => {});
    const sondeo = crearSondeo(tarea, { intervaloMs: 1000, documento: null });
    sondeo.iniciar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(tarea).toHaveBeenCalledTimes(2);
    sondeo.detener();
  });
});

describe('urlSinCache', () => {
  it('agrega un parámetro único para saltarse la caché del CDN', () => {
    expect(urlSinCache('/api/products', 123)).toBe('/api/products?_=123');
    expect(urlSinCache('http://api/api/products?x=1', 456)).toBe('http://api/api/products?x=1&_=456');
  });

  it('por defecto usa la hora actual (dos llamadas en momentos distintos dan URLs distintas)', () => {
    vi.setSystemTime(1000);
    const a = urlSinCache('/api/products');
    vi.setSystemTime(2000);
    expect(urlSinCache('/api/products')).not.toBe(a);
  });
});
