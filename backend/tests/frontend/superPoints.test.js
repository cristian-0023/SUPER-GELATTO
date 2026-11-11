// Cuentas de Super Points de la página (frontend/src/utils/superPoints.js). Los valores (5 pesos por punto,
// 100 pesos para ganar, niveles y topes) llegan del servidor: aquí se pasan como datos, no están fijos en el código.
import { describe, it, expect } from 'vitest';
import { calcularCanje, puntosAGanar, progresoNivel, describirMovimiento, puntosConSigno } from '../../../frontend/src/utils/superPoints.js';

const niveles = [
  { nombre: 'Lover', min: 0, max: 100, pct: 5 },
  { nombre: 'Fan', min: 101, max: 500, pct: 10 },
  { nombre: 'Pro', min: 501, max: 1000, pct: 15 },
  { nombre: 'Master', min: 1001, max: null, pct: 20 },
];

const base = { subtotal: 20000, saldo: 400, pctMax: 10, valorPunto: 5, puntosElegidos: 400 };

describe('calcularCanje', () => {
  it('ejemplo del diseño: Fan, $20.000 y 400 puntos dan $2.000 de descuento y total $18.000', () => {
    expect(calcularCanje(base)).toEqual({ maximo: 400, puntos: 400, descuento: 2000, total: 18000 });
  });

  it('el máximo es el menor entre el saldo y el tope del nivel', () => {
    expect(calcularCanje({ ...base, saldo: 150, puntosElegidos: 0 }).maximo).toBe(150);
    expect(calcularCanje({ ...base, saldo: 9999, puntosElegidos: 0 }).maximo).toBe(400);
  });

  it('el tope se redondea hacia abajo (nunca pasa del % del nivel)', () => {
    // 10 % de 20.003 = 2.000,3 pesos = 400,06 puntos -> 400
    expect(calcularCanje({ ...base, subtotal: 20003, saldo: 9999, puntosElegidos: 0 }).maximo).toBe(400);
    // 5 % de 99 = 4,95 pesos -> 0 puntos
    expect(calcularCanje({ ...base, subtotal: 99, pctMax: 5, saldo: 50, puntosElegidos: 0 }).maximo).toBe(0);
  });

  it('si se eligen más puntos que el máximo, se recorta al máximo', () => {
    const r = calcularCanje({ ...base, puntosElegidos: 5000 });
    expect(r.puntos).toBe(400);
    expect(r.total).toBe(18000);
  });

  it('puntos decimales se redondean hacia abajo; negativos, texto o vacío cuentan como cero', () => {
    expect(calcularCanje({ ...base, puntosElegidos: 10.9 }).puntos).toBe(10);
    for (const malo of [-5, NaN, undefined, null, 'abc', Infinity]) {
      const r = calcularCanje({ ...base, puntosElegidos: malo });
      expect(r.puntos).toBe(0);
      expect(r.descuento).toBe(0);
      expect(r.total).toBe(20000);
    }
  });

  it('un texto numérico del campo se entiende como número', () => {
    expect(calcularCanje({ ...base, puntosElegidos: '120' }).puntos).toBe(120);
  });

  it('sin reglas o sin saldo no hay canje y el total es el subtotal', () => {
    for (const roto of [{ pctMax: undefined }, { valorPunto: 0 }, { valorPunto: undefined }, { saldo: 0 }, { saldo: undefined }]) {
      const r = calcularCanje({ ...base, ...roto });
      expect(r).toEqual({ maximo: 0, puntos: 0, descuento: 0, total: 20000 });
    }
  });

  it('el descuento nunca deja el total por debajo de cero', () => {
    const r = calcularCanje({ subtotal: 100, saldo: 1000, pctMax: 20, valorPunto: 5, puntosElegidos: 1000 });
    expect(r.total).toBeGreaterThanOrEqual(0);
    expect(r.descuento).toBeLessThanOrEqual(100);
  });

  it('usa el valor del punto que manda el servidor, no uno fijo', () => {
    const r = calcularCanje({ subtotal: 20000, saldo: 100, pctMax: 10, valorPunto: 10, puntosElegidos: 100 });
    expect(r).toEqual({ maximo: 100, puntos: 100, descuento: 1000, total: 19000 });
  });
});

describe('puntosAGanar', () => {
  it('1 punto por cada $100 pagados, hacia abajo', () => {
    expect(puntosAGanar(9000, 100)).toBe(90);
    expect(puntosAGanar(18000, 100)).toBe(180);
    expect(puntosAGanar(199, 100)).toBe(1);
  });

  it('menos de $100 no da puntos', () => {
    expect(puntosAGanar(99, 100)).toBe(0);
    expect(puntosAGanar(0, 100)).toBe(0);
  });

  it('usa los pesos por punto del servidor', () => {
    expect(puntosAGanar(9000, 200)).toBe(45);
  });

  it('sin reglas o con datos raros devuelve null (para no mostrar un número inventado)', () => {
    expect(puntosAGanar(9000, undefined)).toBeNull();
    expect(puntosAGanar(9000, 0)).toBeNull();
    expect(puntosAGanar(9000, null)).toBeNull();
    expect(puntosAGanar(NaN, 100)).toBeNull();
    expect(puntosAGanar(-5, 100)).toBeNull();
  });
});

describe('progresoNivel', () => {
  const nivelDe = (g) => progresoNivel(g, niveles);

  it('fronteras de nivel: 100 es Lover, 101 es Fan, 500 Fan, 501 Pro, 1000 Pro, 1001 Master', () => {
    expect(nivelDe(100).actual.nombre).toBe('Lover');
    expect(nivelDe(101).actual.nombre).toBe('Fan');
    expect(nivelDe(500).actual.nombre).toBe('Fan');
    expect(nivelDe(501).actual.nombre).toBe('Pro');
    expect(nivelDe(1000).actual.nombre).toBe('Pro');
    expect(nivelDe(1001).actual.nombre).toBe('Master');
  });

  it('el siguiente nivel es el que sigue en la lista, y en Master no hay', () => {
    expect(nivelDe(0).siguiente.nombre).toBe('Fan');
    expect(nivelDe(500).siguiente.nombre).toBe('Pro');
    expect(nivelDe(5000).siguiente).toBeNull();
  });

  it('el porcentaje avanza dentro del nivel y va de 0 a 100', () => {
    expect(nivelDe(0).porcentaje).toBe(0);
    expect(nivelDe(101).porcentaje).toBe(0);
    expect(nivelDe(100).porcentaje).toBeLessThan(100);
    expect(nivelDe(301).porcentaje).toBe(50); // mitad entre 101 y 501
    expect(nivelDe(500).porcentaje).toBeLessThan(100);
  });

  it('Master está al 100 %', () => {
    expect(nivelDe(1001).porcentaje).toBe(100);
    expect(nivelDe(99999).porcentaje).toBe(100);
  });

  it('sin niveles o con datos raros no inventa nada', () => {
    expect(progresoNivel(50, undefined)).toEqual({ actual: null, siguiente: null, porcentaje: 0 });
    expect(progresoNivel(50, [])).toEqual({ actual: null, siguiente: null, porcentaje: 0 });
    expect(progresoNivel(NaN, niveles).porcentaje).toBe(0);
    expect(progresoNivel(-10, niveles).actual.nombre).toBe('Lover');
  });
});

describe('describirMovimiento', () => {
  it('cada tipo del servidor tiene un texto claro y menciona la compra', () => {
    expect(describirMovimiento({ tipo: 'ganado', puntos: 180, idVenta: 7 })).toEqual({ titulo: 'Puntos ganados', detalle: 'Compra #7' });
    expect(describirMovimiento({ tipo: 'canjeado', puntos: -400, idVenta: 7 })).toEqual({ titulo: 'Puntos canjeados', detalle: 'Descuento en la compra #7' });
    expect(describirMovimiento({ tipo: 'devuelto', puntos: 400, idVenta: 7 })).toEqual({ titulo: 'Puntos devueltos', detalle: 'Compra #7 cancelada' });
    expect(describirMovimiento({ tipo: 'revertido', puntos: -180, idVenta: 7 })).toEqual({ titulo: 'Puntos retirados', detalle: 'Compra #7 cancelada' });
  });

  it('un revertido de 0 puntos se explica (no había nada que retirar)', () => {
    expect(describirMovimiento({ tipo: 'revertido', puntos: 0, idVenta: 7 }).titulo).toBe('Sin puntos que retirar');
  });

  it('sin número de compra o con un tipo desconocido no se rompe', () => {
    expect(describirMovimiento({ tipo: 'ganado', puntos: 5, idVenta: null }).detalle).toBe('Compra');
    expect(describirMovimiento({ tipo: 'otro', puntos: 5 }).titulo).toBe('Movimiento');
  });
});

describe('puntosConSigno', () => {
  it('muestra + para sumas, − para restas y 0 sin signo', () => {
    expect(puntosConSigno(180)).toBe('+180');
    expect(puntosConSigno(-400)).toBe('−400');
    expect(puntosConSigno(0)).toBe('0');
  });

  it('separa los miles al estilo colombiano', () => {
    expect(puntosConSigno(1500)).toBe('+1.500');
  });
});
