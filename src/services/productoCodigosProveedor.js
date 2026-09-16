import { supabase } from '../supabaseClient';
import { fetchAllRows } from '../utils/supabasePage';

export { fetchAllRows };

const PRODUCTO_SELECT =
  'id_producto, codigo_barras, descripcion, laboratorios(nombre), producto_precios(precio_venta, costo)';

export async function listarCatalogoProductosXml() {
  return fetchAllRows(() =>
    supabase.from('productos').select(PRODUCTO_SELECT).order('descripcion', { ascending: true }),
  );
}

export async function buscarProductoPorCodigoBarras(valor) {
  const codigo = String(valor ?? '').trim().replace(/\s+/g, '').replace(/\.+$/, '');
  if (!codigo) return null;
  const intentos = [codigo];
  if (codigo !== String(valor ?? '').trim()) intentos.push(String(valor).trim());
  if (!codigo.endsWith('.')) intentos.push(`${codigo}.`);
  for (const cand of intentos) {
    const { data, error } = await supabase
      .from('productos')
      .select(PRODUCTO_SELECT)
      .eq('codigo_barras', cand)
      .limit(5);
    if (error) return null;
    const hit = (data || []).find((p) => String(p.codigo_barras ?? '').trim().replace(/\.+$/, '') === codigo)
      || data?.[0];
    if (hit) return hit;
  }
  return null;
}

export async function listarCodigosProveedor() {
  return fetchAllRows(() =>
    supabase
      .from('producto_codigos_proveedor')
      .select('id, codigo_proveedor, id_producto, id_proveedor, productos(id_producto, descripcion, codigo_barras, laboratorios(nombre)), proveedores(id_proveedor, razon_social, ruc)')
      .order('id_proveedor', { ascending: true }),
  );
}

/**
 * Si ya existe (proveedor + código), actualiza id_producto.
 * Si no, inserta. Evita duplicados aunque el upsert de PostgREST falle.
 */
export async function guardarVinculoCodigoProveedor(idProveedor, idProducto, codigo) {
  if (!idProveedor || !idProducto || !codigo) {
    return { ok: false, error: new Error('Faltan datos del vínculo.') };
  }
  const payload = {
    id_producto: Number(idProducto),
    id_proveedor: Number(idProveedor),
    codigo_proveedor: String(codigo).trim(),
  };
  if (!payload.codigo_proveedor) {
    return { ok: false, error: new Error('El código de proveedor está vacío.') };
  }

  const { data: existente, error: errSel } = await supabase
    .from('producto_codigos_proveedor')
    .select('id')
    .eq('id_proveedor', payload.id_proveedor)
    .eq('codigo_proveedor', payload.codigo_proveedor)
    .maybeSingle();
  if (errSel) return { ok: false, error: errSel };

  if (existente?.id) {
    const { error } = await supabase
      .from('producto_codigos_proveedor')
      .update({ id_producto: payload.id_producto })
      .eq('id', existente.id);
    if (error) return { ok: false, error };
    return { ok: true, updated: true };
  }

  const { error } = await supabase.from('producto_codigos_proveedor').insert(payload);
  if (error) return { ok: false, error };
  return { ok: true, updated: false };
}

export async function actualizarVinculoCodigoProveedor(id, idProducto) {
  const { error } = await supabase
    .from('producto_codigos_proveedor')
    .update({ id_producto: Number(idProducto) })
    .eq('id', id);
  if (error) return { ok: false, error };
  return { ok: true };
}

export async function eliminarVinculoCodigoProveedor(id) {
  const { error } = await supabase.from('producto_codigos_proveedor').delete().eq('id', id);
  if (error) return { ok: false, error };
  return { ok: true };
}
