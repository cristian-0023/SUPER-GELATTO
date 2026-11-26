// Cambios rápidos del panel con varios PUT en vuelo (frontend/src/utils/cambiosEnCurso.js) y aviso que
// sobrevive al salir del panel (frontend/src/utils/avisoPendiente.js).
import { describe, it, expect } from 'vitest';
import { crearPendientes, revertirSiNoCambio, resolverCambioVisibilidad, focoTrasOcultar } from '../../../frontend/src/utils/cambiosEnCurso.js';
import { CLAVE_AVISO_PENDIENTE, guardarAvisoPendiente, tomarAvisoPendiente } from '../../../frontend/src/utils/avisoPendiente.js';

const LISTA = [{ id: 1, name: 'A', estado: true }, { id: 2, name: 'B', estado: true }, { id: 3, name: 'C', estado: false }];
const estadoDe = (lista, id) => lista.find((p) => p.id === id).estado;

describe('crearPendientes: un solo PUT en curso por producto', () => {
  it('el segundo clic sobre el mismo producto se ignora hasta que termina el primero', () => {
    const pendientes = crearPendientes();
    expect(pendientes.empezar(1)).toBe(true);
    expect(pendientes.enCurso('1')).toBe(true); // el id puede venir como texto
    expect(pendientes.empezar('1')).toBe(false);
    pendientes.terminar(1);
    expect(pendientes.enCurso(1)).toBe(false);
    expect(pendientes.empezar(1)).toBe(true);
  });
  it('productos distintos pueden cambiar a la vez', () => {
    const pendientes = crearPendientes();
    expect(pendientes.empezar(1)).toBe(true);
    expect(pendientes.empezar(2)).toBe(true);
  });
});

describe('revertirSiNoCambio: la reversión no pisa un valor más nuevo', () => {
  it('si el producto sigue con el valor optimista -> vuelve al anterior', () => {
    const lista = [{ id: 1, estado: false }];
    expect(revertirSiNoCambio(lista, 1, 'estado', false, true)).toEqual([{ id: 1, estado: true }]);
  });
  it('si ya tiene otro valor (llegó uno más nuevo) -> no se toca', () => {
    const lista = [{ id: 1, precio: 9000 }];
    expect(revertirSiNoCambio(lista, 1, 'precio', 8000, 7000)).toEqual([{ id: 1, precio: 9000 }]);
  });
  it('no muta la lista original', () => {
    const lista = [{ id: 1, estado: false }];
    revertirSiNoCambio(lista, 1, 'estado', false, true);
    expect(lista[0].estado).toBe(false);
  });
});

describe('resolverCambioVisibilidad: reversión optimista con su aviso', () => {
  const ocultoA = LISTA.map((p) => (p.id === 1 ? { ...p, estado: false } : p)); // ya se aplicó el cambio optimista

  it('servidor OK -> queda el cambio y avisa que se ocultó', () => {
    const r = resolverCambioVisibilidad(ocultoA, 1, false, { ok: true, status: 200 });
    expect(r.decision).toBe('ok');
    expect(estadoDe(r.productos, 1)).toBe(false);
    expect(r.aviso).toEqual({ texto: 'Producto oculto: la tienda y Gelbot ya no lo ofrecen.', tipo: 'success' });
  });
  it('servidor OK al mostrar -> avisa que se muestra', () => {
    const r = resolverCambioVisibilidad(LISTA, 3, true, { ok: true, status: 200 });
    expect(r.aviso).toEqual({ texto: 'El producto ya se muestra en la tienda.', tipo: 'success' });
  });
  it('el servidor falla (500) -> la pantalla vuelve al valor anterior con el mensaje del servidor', () => {
    const r = resolverCambioVisibilidad(ocultoA, 1, false, { ok: false, status: 500 }, 'Error al cambiar la visibilidad del producto.');
    expect(r.decision).toBe('revertir');
    expect(estadoDe(r.productos, 1)).toBe(true);
    expect(r.aviso).toEqual({ texto: 'Error al cambiar la visibilidad del producto.', tipo: 'error' });
  });
  it('el servidor falla sin mensaje -> texto por defecto', () => {
    const r = resolverCambioVisibilidad(ocultoA, 1, false, { ok: false, status: 404 });
    expect(r.aviso).toEqual({ texto: 'No se pudo cambiar la visibilidad del producto.', tipo: 'error' });
  });
  it('sin conexión -> vuelve atrás y lo dice', () => {
    const r = resolverCambioVisibilidad(ocultoA, 1, false, null);
    expect(estadoDe(r.productos, 1)).toBe(true);
    expect(r.aviso).toEqual({ texto: 'Error de conexión al cambiar la visibilidad del producto.', tipo: 'error' });
  });
  it('401 -> vuelve atrás, decisión "sesion" y sin aviso (se pide verificar de nuevo)', () => {
    const r = resolverCambioVisibilidad(ocultoA, 1, false, { ok: false, status: 401 });
    expect(r.decision).toBe('sesion');
    expect(estadoDe(r.productos, 1)).toBe(true);
    expect(r.aviso).toBeNull();
  });

  it('A y B en vuelo, respuestas en desorden: B falla primero, A sale bien -> solo B vuelve atrás', () => {
    const pendientes = crearPendientes();
    let pantalla = LISTA;
    // Clic en A y en B: cambio optimista de los dos
    expect(pendientes.empezar(1)).toBe(true);
    pantalla = pantalla.map((p) => (p.id === 1 ? { ...p, estado: false } : p));
    expect(pendientes.empezar(2)).toBe(true);
    pantalla = pantalla.map((p) => (p.id === 2 ? { ...p, estado: false } : p));
    // Un segundo clic en A mientras sigue en vuelo se ignora
    expect(pendientes.empezar(1)).toBe(false);

    // Llega primero la respuesta de B (falla)
    pantalla = resolverCambioVisibilidad(pantalla, 2, false, { ok: false, status: 500 }).productos;
    pendientes.terminar(2);
    expect(estadoDe(pantalla, 1)).toBe(false); // A no se toca
    expect(estadoDe(pantalla, 2)).toBe(true);

    // Después la de A (bien)
    pantalla = resolverCambioVisibilidad(pantalla, 1, false, { ok: true, status: 200 }).productos;
    pendientes.terminar(1);
    expect(estadoDe(pantalla, 1)).toBe(false);
    expect(estadoDe(pantalla, 2)).toBe(true);
    expect(pendientes.enCurso(1)).toBe(false);
    expect(pendientes.enCurso(2)).toBe(false);
  });

  it('si mientras tanto el producto cambió (por ejemplo, una recarga trajo otro valor), la falla no lo pisa', () => {
    const recargado = LISTA.map((p) => (p.id === 1 ? { ...p, estado: true } : p));
    const r = resolverCambioVisibilidad(recargado, 1, false, { ok: false, status: 500 });
    expect(estadoDe(r.productos, 1)).toBe(true);
    expect(r.decision).toBe('revertir');
  });
});

describe('focoTrasOcultar: a dónde va el foco si la fila desaparece', () => {
  it('a la fila siguiente', () => expect(focoTrasOcultar([1, 2, 3], 2)).toBe(3));
  it('si era la última, a la anterior', () => expect(focoTrasOcultar([1, 2, 3], 3)).toBe(2));
  it('si era la única, a ninguna (el título)', () => expect(focoTrasOcultar([7], 7)).toBeNull());
  it('ids como texto o número dan igual', () => expect(focoTrasOcultar(['1', '2'], 1)).toBe('2'));
});

describe('aviso pendiente: el mensaje sobrevive al salir del panel', () => {
  const almacenFalso = () => {
    const datos = new Map();
    return { getItem: (k) => (datos.has(k) ? datos.get(k) : null), setItem: (k, v) => datos.set(k, String(v)), removeItem: (k) => datos.delete(k), datos };
  };
  it('se guarda, se lee una sola vez y se borra', () => {
    const almacen = almacenFalso();
    guardarAvisoPendiente('Tu cuenta ya no tiene permisos de administrador.', almacen);
    expect(CLAVE_AVISO_PENDIENTE).toBeTruthy();
    expect(almacen.datos.has(CLAVE_AVISO_PENDIENTE)).toBe(true);
    expect(tomarAvisoPendiente(almacen)).toBe('Tu cuenta ya no tiene permisos de administrador.');
    expect(tomarAvisoPendiente(almacen)).toBeNull();
  });
  it('sin aviso -> null', () => expect(tomarAvisoPendiente(almacenFalso())).toBeNull());
  it('almacén bloqueado (modo privado) -> no lanza error', () => {
    const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };
    expect(() => guardarAvisoPendiente('x', roto)).not.toThrow();
    expect(tomarAvisoPendiente(roto)).toBeNull();
  });
  it('texto vacío o demasiado largo no se guarda entero', () => {
    const almacen = almacenFalso();
    guardarAvisoPendiente('', almacen);
    expect(tomarAvisoPendiente(almacen)).toBeNull();
    guardarAvisoPendiente('a'.repeat(1000), almacen);
    expect(tomarAvisoPendiente(almacen).length).toBe(300);
  });
});
