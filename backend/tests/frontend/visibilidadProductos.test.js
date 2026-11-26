// Ocultar / Mostrar en la tienda desde el panel (frontend/src/utils/visibilidadProductos.js).
import { describe, it, expect } from 'vitest';
import {
  MENSAJE_BORRADO_CON_VENTAS, estaVisible, textoBotonVisibilidad, filtrarProductosPanel, contarOcultos, avisoTrasBorrar,
} from '../../../frontend/src/utils/visibilidadProductos.js';

const VISIBLE = { id: 1, name: 'Fresa', estado: true };
const OCULTO = { id: 13, name: 'Pistacho', estado: false };
const RECIEN_CREADO = { id: 20, name: 'Nuevo' }; // el alta no trae estado: la base lo crea visible (default true)

describe('estaVisible', () => {
  it('estado true -> visible; estado false -> oculto', () => {
    expect(estaVisible(VISIBLE)).toBe(true);
    expect(estaVisible(OCULTO)).toBe(false);
  });
  it('sin estado (producto recién creado) -> visible', () => expect(estaVisible(RECIEN_CREADO)).toBe(true));
  it('sin producto -> false', () => expect(estaVisible(undefined)).toBe(false));
});

describe('textoBotonVisibilidad', () => {
  it('visible -> "Ocultar de la tienda"', () => expect(textoBotonVisibilidad(VISIBLE)).toBe('Ocultar de la tienda'));
  it('oculto -> "Mostrar en la tienda"', () => expect(textoBotonVisibilidad(OCULTO)).toBe('Mostrar en la tienda'));
});

describe('filtrarProductosPanel y contarOcultos', () => {
  const LISTA = [VISIBLE, OCULTO, RECIEN_CREADO];
  it('con "mostrar ocultos" -> todos, en el mismo orden', () => expect(filtrarProductosPanel(LISTA, true)).toEqual(LISTA));
  it('sin "mostrar ocultos" -> solo los visibles', () => expect(filtrarProductosPanel(LISTA, false)).toEqual([VISIBLE, RECIEN_CREADO]));
  it('lista ausente -> vacía', () => {
    expect(filtrarProductosPanel(undefined, false)).toEqual([]);
    expect(contarOcultos(undefined)).toBe(0);
  });
  it('cuenta los ocultos', () => expect(contarOcultos(LISTA)).toBe(1));
});

describe('avisoTrasBorrar: un producto con ventas ofrece ocultarlo', () => {
  it('409 por ventas -> texto con la salida y botón "Ocultar"', () => {
    const aviso = avisoTrasBorrar(409, { ok: false, message: 'Este producto tiene ventas registradas y no se puede borrar.' });
    expect(aviso).toEqual({ texto: MENSAJE_BORRADO_CON_VENTAS, ofrecerOcultar: true });
    expect(MENSAJE_BORRADO_CON_VENTAS).toBe('Este producto tiene ventas registradas y no se puede borrar. Puedes ocultarlo de la tienda.');
  });
  it('409 por ventas de un producto que YA está oculto -> lo dice, sin botón', () => {
    const aviso = avisoTrasBorrar(409, { message: 'Este producto tiene ventas registradas y no se puede borrar.' }, false);
    expect(aviso).toEqual({ texto: 'Este producto tiene ventas registradas y no se puede borrar. Ya está oculto de la tienda.', ofrecerOcultar: false });
  });
  it('409 por otro motivo (personalizado) -> su mensaje, sin botón', () => {
    expect(avisoTrasBorrar(409, { message: 'El helado personalizado no se edita desde el panel.' }))
      .toEqual({ texto: 'El helado personalizado no se edita desde el panel.', ofrecerOcultar: false });
  });
  it.each([[404, { message: 'El producto no existe.' }, 'El producto no existe.'], [500, {}, 'Error al eliminar producto'], [500, null, 'Error al eliminar producto']])(
    '%i -> mensaje del servidor o el de siempre, sin botón', (status, data, texto) => {
      expect(avisoTrasBorrar(status, data)).toEqual({ texto, ofrecerOcultar: false });
    });
});
