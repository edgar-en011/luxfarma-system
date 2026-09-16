import { supabase } from '../supabaseClient';
import { ordenarResultadosBusqueda, terminoBusquedaSeguro } from './buscarProductosCatalogo';

/** Búsqueda de productos para Compras (modal agregar + modificar precio). */
export async function buscarProductosCompra(valor) {
  if (valor.length < 2) return [];

  const terminoSeguro = terminoBusquedaSeguro(valor);
  const [resPorNombre, resPorCodigo] = await Promise.all([
    supabase
      .from('productos')
      .select('*, laboratorios(nombre), producto_precios(precio_venta, costo, precio_caja, ganancia)')
      .ilike('descripcion', `%${terminoSeguro}%`)
      .order('descripcion', { ascending: true })
      .limit(50),
    supabase
      .from('productos')
      .select('*, laboratorios(nombre), producto_precios(precio_venta, costo, precio_caja, ganancia)')
      .eq('codigo_barras', valor.trim())
      .limit(10),
  ]);

  const porNombre = resPorNombre.data || [];
  const porCodigo = resPorCodigo.data || [];
  const idsYaIncluidos = new Set(porCodigo.map((p) => p.id_producto));
  const combinados = [...porCodigo, ...porNombre.filter((p) => !idsYaIncluidos.has(p.id_producto))];

  const ids = combinados.map((p) => p.id_producto);
  if (ids.length > 0) {
    const { data: lotesData } = await supabase
      .from('inventario_lotes')
      .select('id_producto, cantidad_actual')
      .in('id_producto', ids)
      .eq('estado', 'VIGENTE')
      .gt('cantidad_actual', 0);

    const stockMap = {};
    (lotesData || []).forEach((l) => {
      stockMap[l.id_producto] = (stockMap[l.id_producto] || 0) + Number(l.cantidad_actual);
    });

    return ordenarResultadosBusqueda(
      combinados.map((p) => ({ ...p, stockTotal: stockMap[p.id_producto] || 0 })),
      valor,
    );
  }

  return ordenarResultadosBusqueda(
    combinados.map((p) => ({ ...p, stockTotal: 0 })),
    valor,
  );
}
