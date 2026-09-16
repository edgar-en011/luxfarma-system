/**
 * Única escritura del catálogo de productos (alta y edición).
 *
 * ProductoFormModal (Compras e Inventario/Productos) llama acá. No hay un segundo
 * guardado en AdminProductos: si se agrega un campo, se agrega una sola vez.
 *
 * Después de escribir, relée la fila con las relaciones que pinta Compras
 * (laboratorios.nombre, producto_precios). Si el embed del laboratorio no llega,
 * resuelve el nombre por id — así el modal de compra no puede quedarse con el
 * nombre viejo aunque el id nuevo sí se haya guardado.
 */

import { assertEscritura, filasAfectadas } from './supaWrite.js'
import { parsePrecio } from './precioExacto.js'
import { redondearCosto } from './costoPromedioPonderado.js'

export const PRODUCTO_SELECT_COMPLETO =
  '*, laboratorios(nombre), producto_precios(precio_venta, costo, precio_caja, ganancia)'

export function armarPayloadProducto(formProd) {
  const codigoBarras = String(formProd?.codigo_barras || '').trim()
  return {
    codigo_barras: codigoBarras || null,
    descripcion: String(formProd?.descripcion || '').toUpperCase(),
    id_familia: formProd?.id_familia ? Number(formProd.id_familia) : null,
    id_laboratorio: formProd?.id_laboratorio ? Number(formProd.id_laboratorio) : null,
    id_presentacion: formProd?.id_presentacion ? Number(formProd.id_presentacion) : null,
    principio_activo: formProd?.principio_activo || null,
    fraccion: formProd?.fraccion ? Number(formProd.fraccion) : 0,
    dolencias: formProd?.dolencias || null,
    stock_minimo: formProd?.stock_minimo ? Number(formProd.stock_minimo) : 0,
    rotar: !!formProd.rotar,
    cod_digemid: formProd?.cod_digemid || null,
    tipo_item: formProd?.tipo_item || 'PRODUCTO',
    ubicacion: formProd?.ubicacion || null,
    inafecto: !!formProd.inafecto,
    requiere_receta: !!formProd.requiere_receta,
  }
}

/** Nombre de laboratorio aunque PostgREST devuelva objeto, array o nada. */
export function nombreLaboratorioDeProducto(prod, fallback = null) {
  const labs = prod?.laboratorios
  if (labs && !Array.isArray(labs) && labs.nombre) return labs.nombre
  if (Array.isArray(labs) && labs[0]?.nombre) return labs[0].nombre
  return fallback
}

export async function hidratarProductoCatalogo(supabase, idProducto) {
  const { data, error } = await supabase
    .from('productos')
    .select(PRODUCTO_SELECT_COMPLETO)
    .eq('id_producto', idProducto)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null

  let nombreLab = nombreLaboratorioDeProducto(data)
  if (!nombreLab && data.id_laboratorio) {
    const { data: lab } = await supabase
      .from('laboratorios')
      .select('id_laboratorio, nombre')
      .eq('id_laboratorio', data.id_laboratorio)
      .maybeSingle()
    if (lab?.nombre) {
      nombreLab = lab.nombre
      data.laboratorios = { nombre: lab.nombre }
    }
  }
  return { ...data, nombreLaboratorio: nombreLab || null }
}

async function upsertPrecios(supabase, prodId, { costoNum, precioVentaNum }) {
  let { data: precioUpd, error: errPrecio } = await supabase
    .from('producto_precios')
    .update({ costo: costoNum, precio_venta: precioVentaNum })
    .eq('id_producto', prodId)
    .select('id_producto')
  if (!errPrecio && filasAfectadas(precioUpd) < 1) {
    const { data: maxPrecio } = await supabase
      .from('producto_precios')
      .select('id_precio')
      .order('id_precio', { ascending: false })
      .limit(1)
      .maybeSingle()
    const ins = await supabase.from('producto_precios').upsert({
      id_precio: (maxPrecio?.id_precio || 0) + 1,
      id_producto: prodId,
      costo: costoNum,
      precio_venta: precioVentaNum,
    }, { onConflict: 'id_producto' }).select('id_producto')
    precioUpd = ins.data
    errPrecio = ins.error
  }
  assertEscritura(precioUpd, errPrecio, `No se actualizaron los precios del producto #${prodId}.`)
}

async function sincronizarFormaUnidad(supabase, prodId, { costoNum, precioVentaNum }) {
  const { data: formasBase, error } = await supabase
    .from('producto_formas_venta')
    .select('id_forma, factor')
    .eq('id_producto', prodId)
    .eq('activo', true)
  if (error) throw error
  for (const f of formasBase || []) {
    const factor = Number(f.factor) || 1
    const patch = { p_compra: redondearCosto(costoNum * factor) }
    if (factor === 1) patch.precio_venta = precioVentaNum
    const { data: formaUpd, error: errForma } = await supabase
      .from('producto_formas_venta')
      .update(patch)
      .eq('id_forma', f.id_forma)
      .select('id_forma')
    assertEscritura(formaUpd, errForma, `No se actualizó la forma de venta #${f.id_forma}.`)
  }
}

/**
 * @param {{ modo: 'nuevo'|'editar', formProd: object }} args
 * @returns {Promise<{ id_producto: number, producto: object }>}
 */
export async function guardarProductoCatalogo(supabase, { modo, formProd }) {
  const modoEdicion = modo === 'editar'
  const costoNum = parsePrecio(formProd.costo)
  const precioVentaNum = parsePrecio(formProd.precio_venta)
  let prodId = formProd.id_producto
  const codigoBarras = String(formProd.codigo_barras || '').trim()
  const payloadProducto = armarPayloadProducto(formProd)

  if (codigoBarras) {
    let qDup = supabase
      .from('productos')
      .select('id_producto, descripcion, codigo_barras')
      .eq('codigo_barras', codigoBarras)
      .eq('activo', 1)
    if (modoEdicion && prodId != null) qDup = qDup.neq('id_producto', prodId)
    const { data: dupCodigo, error: errDup } = await qDup.limit(1).maybeSingle()
    if (errDup) throw new Error(errDup.message)
    if (dupCodigo) {
      const err = new Error(
        `Ya existe un producto activo con el código de barras "${codigoBarras}" (${dupCodigo.descripcion || `#${dupCodigo.id_producto}`}). No se puede duplicar.`,
      )
      err.codigo = 'CODIGO_DUPLICADO'
      throw err
    }
  }

  if (!modoEdicion) {
    const { data: maxData } = await supabase
      .from('productos')
      .select('id_producto')
      .order('id_producto', { ascending: false })
      .limit(1)
      .single()
    prodId = (maxData?.id_producto || 0) + 1
    const { data: prodIns, error: errProd } = await supabase
      .from('productos')
      .insert({ id_producto: prodId, ...payloadProducto, activo: 1 })
      .select('id_producto')
    assertEscritura(prodIns, errProd, 'No se pudo crear el producto.')
    const { data: maxPrecio } = await supabase
      .from('producto_precios')
      .select('id_precio')
      .order('id_precio', { ascending: false })
      .limit(1)
      .single()
    const { data: precioUps, error: errPrecio } = await supabase
      .from('producto_precios')
      .upsert({
        id_precio: (maxPrecio?.id_precio || 0) + 1,
        id_producto: prodId,
        costo: costoNum,
        precio_venta: precioVentaNum,
      }, { onConflict: 'id_producto' })
      .select('id_producto')
    assertEscritura(precioUps, errPrecio, 'No se pudo guardar el precio del producto nuevo.')
  } else {
    const { data: prodUpd, error: errProd } = await supabase
      .from('productos')
      .update(payloadProducto)
      .eq('id_producto', prodId)
      .select('id_producto, id_laboratorio')
    assertEscritura(prodUpd, errProd, `No se actualizó el producto #${prodId}.`)
    const filaProd = Array.isArray(prodUpd) ? prodUpd[0] : prodUpd
    const labGuardado = Number(filaProd?.id_laboratorio)
    if (payloadProducto.id_laboratorio && labGuardado !== payloadProducto.id_laboratorio) {
      throw new Error(
        `El laboratorio no quedó guardado (se envió ${payloadProducto.id_laboratorio}, en la base quedó ${labGuardado}).`,
      )
    }
    await upsertPrecios(supabase, prodId, { costoNum, precioVentaNum })
    await sincronizarFormaUnidad(supabase, prodId, { costoNum, precioVentaNum })
  }

  const producto = await hidratarProductoCatalogo(supabase, prodId)
  if (!producto) {
    return {
      id_producto: prodId,
      producto: {
        id_producto: prodId,
        ...payloadProducto,
        producto_precios: [{ costo: costoNum, precio_venta: precioVentaNum }],
        laboratorios: null,
        nombreLaboratorio: null,
      },
    }
  }
  return { id_producto: prodId, producto }
}
