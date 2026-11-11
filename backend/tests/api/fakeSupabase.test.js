// El cliente Supabase falso debe aceptar las mismas llamadas a rpc que PostgREST: los parámetros con
// `default` en la función SQL se pueden omitir; los demás son obligatorios y no se aceptan inventados.
import { describe, it, expect } from 'vitest';
import { crearFakeSupabase } from '../helpers/fakeSupabase.js';

const RESPUESTA = { data: { id_venta: 1 }, error: null };
const BASE = { p_id_usuario: 1, p_items: [], p_estado: 'Pagado' };

describe('fakeSupabase: firmas de rpc con parámetros opcionales', () => {
  it('registrar_venta acepta la llamada sin p_puntos_usar (tiene default) y con él', async () => {
    const fake = crearFakeSupabase();
    fake.responderRpc('registrar_venta', RESPUESTA);
    expect(await fake.client.rpc('registrar_venta', BASE)).toEqual(RESPUESTA);
    expect(await fake.client.rpc('registrar_venta', { ...BASE, p_puntos_usar: 10 })).toEqual(RESPUESTA);
  });

  it('rechaza (PGRST202) si falta un obligatorio o sobra uno inventado', async () => {
    const fake = crearFakeSupabase();
    fake.responderRpc('registrar_venta', RESPUESTA);
    const { p_estado, ...sinEstado } = BASE;
    expect((await fake.client.rpc('registrar_venta', sinEstado)).error.code).toBe('PGRST202');
    expect((await fake.client.rpc('registrar_venta', { ...BASE, p_total: 1 })).error.code).toBe('PGRST202');
  });

  it('conoce las funciones nuevas de Super Points', async () => {
    const fake = crearFakeSupabase();
    fake.responderRpc('super_points_reglas', { data: {}, error: null });
    fake.responderRpc('super_points_resumen', { data: {}, error: null });
    fake.responderRpc('cambiar_estado_venta', { data: {}, error: null });
    expect((await fake.client.rpc('super_points_reglas')).error).toBeNull();
    expect((await fake.client.rpc('super_points_resumen', { p_id_usuario: 1 })).error).toBeNull();
    expect((await fake.client.rpc('cambiar_estado_venta', { p_id_venta: 1, p_estado: 'Pagado' })).error).toBeNull();
  });
});
