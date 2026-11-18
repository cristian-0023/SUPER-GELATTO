// Lógica pura de la foto de perfil (frontend/src/utils/fotoPerfil.js). La foto se guarda en el usuario y en
// localStorage (cupo de ~5 MB), así que antes de guardarla se achica a 256x256 como máximo:
//  - validarFotoPerfil: solo imágenes (JPEG, PNG, WebP o GIF) de hasta 5 MB; si no, un aviso claro.
//  - medidasAchicadas: medidas que caben en 256x256 manteniendo la proporción, sin agrandar las pequeñas.
import { describe, it, expect } from 'vitest';
import {
  validarFotoPerfil,
  medidasAchicadas,
  LADO_MAXIMO_FOTO,
  TAMANO_MAXIMO_FOTO,
  CALIDAD_FOTO,
} from '../../../frontend/src/utils/fotoPerfil.js';

const archivo = (type, size) => ({ type, size, name: 'foto' });

describe('validarFotoPerfil', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])('acepta %s', (tipo) => {
    expect(validarFotoPerfil(archivo(tipo, 200 * 1024))).toEqual({ ok: true });
  });

  it('acepta justo 5 MB', () => {
    expect(validarFotoPerfil(archivo('image/png', TAMANO_MAXIMO_FOTO)).ok).toBe(true);
    expect(TAMANO_MAXIMO_FOTO).toBe(5 * 1024 * 1024);
  });

  it('rechaza más de 5 MB con un aviso que dice el límite', () => {
    const r = validarFotoPerfil(archivo('image/jpeg', TAMANO_MAXIMO_FOTO + 1));
    expect(r.ok).toBe(false);
    expect(r.mensaje).toMatch(/5 MB/);
  });

  it.each([
    ['un PDF', 'application/pdf'],
    ['un SVG', 'image/svg+xml'],
    ['un video', 'video/mp4'],
    ['sin tipo', ''],
  ])('rechaza %s', (_, tipo) => {
    const r = validarFotoPerfil(archivo(tipo, 1000));
    expect(r.ok).toBe(false);
    expect(typeof r.mensaje).toBe('string');
    expect(r.mensaje.length).toBeGreaterThan(0);
  });

  it('rechaza un archivo vacío o ausente', () => {
    expect(validarFotoPerfil(archivo('image/png', 0)).ok).toBe(false);
    expect(validarFotoPerfil(null).ok).toBe(false);
    expect(validarFotoPerfil(undefined).ok).toBe(false);
  });
});

describe('medidasAchicadas', () => {
  it('valores por defecto: 256 px y calidad 0,8', () => {
    expect(LADO_MAXIMO_FOTO).toBe(256);
    expect(CALIDAD_FOTO).toBe(0.8);
  });

  it('foto horizontal grande -> 256 de ancho y alto proporcional', () => {
    expect(medidasAchicadas(4000, 3000)).toEqual({ ancho: 256, alto: 192 });
  });

  it('foto vertical grande -> 256 de alto y ancho proporcional', () => {
    expect(medidasAchicadas(1080, 1920)).toEqual({ ancho: 144, alto: 256 });
  });

  it('foto cuadrada -> 256x256', () => {
    expect(medidasAchicadas(1024, 1024)).toEqual({ ancho: 256, alto: 256 });
  });

  it('foto más pequeña que el máximo -> no se agranda', () => {
    expect(medidasAchicadas(120, 80)).toEqual({ ancho: 120, alto: 80 });
  });

  it('foto muy alargada -> el lado corto nunca queda en 0', () => {
    expect(medidasAchicadas(10000, 10)).toEqual({ ancho: 256, alto: 1 });
  });

  it('devuelve números enteros', () => {
    const { ancho, alto } = medidasAchicadas(1000, 333);
    expect(Number.isInteger(ancho)).toBe(true);
    expect(Number.isInteger(alto)).toBe(true);
  });

  it('acepta otro lado máximo', () => {
    expect(medidasAchicadas(800, 400, 100)).toEqual({ ancho: 100, alto: 50 });
  });

  it.each([[0, 100], [100, 0], [NaN, 100], [-5, 10], [undefined, undefined]])(
    'medidas no válidas (%s x %s) -> null',
    (a, b) => {
      expect(medidasAchicadas(a, b)).toBeNull();
    },
  );
});
