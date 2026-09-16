/**
 * Descarga catálogo desde Supabase y lo guarda en el store offline
 * (SQLite en Electron / IndexedDB en web).
 */

import { supabase } from '../supabaseClient'
import { filaProductoPrecios } from './productoPrecios'
import { nombreLaboratorioProducto } from './buscarProductosCatalogo'
import {
  guardarCatalogoLocal,
  buscarProductosOffline,
  catalogoTieneDatos,
  ensureOfflineReady,
} from './offlineStore'

export { buscarProductosOffline, catalogoTieneDatos }

// ─── Descargar y guardar catálogo completo con progreso ───────
// onProgreso({ descargados, total, fase }) fase: productos | formas | stock | guardando | listo
export async function descargarCatalogo(id_sucursal, onProgreso) {
  try {
    await ensureOfflineReady()

    // FASE 1: Productos
    let offset = 0
    const limite = 500
    const todosLosProductos = []
    let totalEstimado = 4000

    onProgreso?.({ descargados: 0, total: totalEstimado, fase: 'productos' })

    while (true) {
      const { data, error } = await supabase
        .from('productos')
        .select(`
          id_producto, codigo_barras, descripcion, fraccion, activo,
          laboratorios(nombre),
          producto_precios (precio_venta, precio_caja, costo),
          producto_fraccionado_config (unidades_por_caja)
        `)
        .eq('activo', 1)
        .range(offset, offset + limite - 1)

      if (error) throw error
      if (!data || data.length === 0) break
      todosLosProductos.push(...data)
      offset += limite

      if (data.length < limite) totalEstimado = todosLosProductos.length

      onProgreso?.({
        descargados: todosLosProductos.length,
        total: totalEstimado,
        fase: 'productos',
      })

      if (data.length < limite) break
    }

    // FASE 1b: Unidades de medida
    const { data: unidadesData } = await supabase
      .from('unidades_medida')
      .select('id_medida, nombre, activo')
      .eq('activo', 1)
    const unidades = unidadesData || []

    // FASE 1c: Formas de venta (chunks por producto)
    onProgreso?.({ descargados: 0, total: Math.max(todosLosProductos.length, 1), fase: 'formas' })
    const ids = todosLosProductos.map((p) => p.id_producto)
    const formas = []
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const { data: formasChunk, error: errFormas } = await supabase
        .from('producto_formas_venta')
        .select('id_forma, id_producto, id_medida, factor, precio_venta, p_compra, activo, orden, unidades_medida(id_medida, nombre)')
        .in('id_producto', chunk)
        .eq('activo', true)
      if (errFormas) throw errFormas
      for (const f of (formasChunk || [])) {
        formas.push({
          ...f,
          medida_nombre: f.unidades_medida?.nombre || 'UNIDAD',
          unidades_medida: f.unidades_medida || { id_medida: f.id_medida, nombre: 'UNIDAD' },
        })
      }
      onProgreso?.({
        descargados: Math.min(i + chunk.length, ids.length),
        total: ids.length,
        fase: 'formas',
      })
    }

    // FASE 2: Stock / lotes
    let lotesData = []
    const totalChunks = Math.ceil(ids.length / 200) || 1

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200)
      const chunkActual = Math.floor(i / 200) + 1

      onProgreso?.({
        descargados: chunkActual,
        total: totalChunks,
        fase: 'stock',
      })

      let q = supabase
        .from('inventario_lotes')
        .select('id_lote, id_producto, id_sucursal, nro_lote, fecha_vencimiento, cantidad_actual, estado')
        .in('id_producto', chunk)
        .eq('estado', 'VIGENTE')
        .gt('cantidad_actual', 0)

      if (id_sucursal) {
        q = q.or(`id_sucursal.eq.${id_sucursal},id_sucursal.is.null`)
      }

      const { data: lotes } = await q
      if (lotes) lotesData.push(...lotes)
    }

    // FASE 3: Cruzar y guardar
    onProgreso?.({ descargados: 0, total: todosLosProductos.length, fase: 'guardando' })

    const lotesMap = {}
    lotesData.forEach((l) => {
      if (!lotesMap[l.id_producto]) lotesMap[l.id_producto] = []
      lotesMap[l.id_producto].push(l)
    })

    const productosConStock = todosLosProductos.map((prod) => {
      const lotes = (lotesMap[prod.id_producto] || [])
        .sort((a, b) => new Date(a.fecha_vencimiento) - new Date(b.fecha_vencimiento))
      const loteActual = lotes[0] || null
      const totalStock = lotes.reduce((s, l) => s + Number(l.cantidad_actual), 0)
      let fechaVenceStr = ''
      if (loteActual?.fecha_vencimiento) {
        const [year, month] = loteActual.fecha_vencimiento.split('-')
        fechaVenceStr = `${month}/${year}`
      }

      const fraccionDB = Number(
        prod.producto_fraccionado_config?.[0]?.unidades_por_caja || prod.fraccion,
      )
      const matchNombre = prod.descripcion?.match(/\s[Xx]\s+(\d+)/)
      const fraccionNombre = matchNombre ? Number(matchNombre[1]) : 1
      const fraccionCaja = fraccionDB > 1 ? fraccionDB : (fraccionNombre > 1 ? fraccionNombre : 1)

      return {
        id_producto: prod.id_producto,
        codigo_barras: prod.codigo_barras || '',
        descripcion: prod.descripcion || '',
        laboratorio: nombreLaboratorioProducto(prod),
        fraccion: prod.fraccion,
        fraccionCaja,
        activo: prod.activo,
        precio_venta: Number(filaProductoPrecios(prod.producto_precios)?.precio_venta || 0),
        precio_caja: Number(filaProductoPrecios(prod.producto_precios)?.precio_caja || 0),
        costo: Number(filaProductoPrecios(prod.producto_precios)?.costo || 0),
        totalStock,
        loteActual: loteActual ? {
          nro_lote: loteActual.nro_lote,
          fecha_vencimiento: loteActual.fecha_vencimiento,
        } : null,
        fechaVenceStr,
        ultima_actualizacion: new Date().toISOString(),
      }
    })

    await guardarCatalogoLocal({
      id_sucursal,
      productos: productosConStock,
      formas,
      unidades,
      lotes: lotesData,
    })

    limpiarCatalogoStaleFlag()
    onProgreso?.({ descargados: productosConStock.length, total: productosConStock.length, fase: 'listo' })
    console.log(`[CatálogoCache] ${productosConStock.length} productos + ${formas.length} formas guardados offline`)
    return { ok: true, total: productosConStock.length, formas: formas.length }
  } catch (err) {
    console.error('[CatálogoCache] Error al descargar:', err)
    return { ok: false, error: err.message }
  }
}

const CATALOGO_STALE_KEY = 'saludFutura_catalogo_stale'
const EVENTO_PRODUCTOS = 'saludfutura:productos-changed'

/** Marca el catálogo offline como obsoleto (crear/editar producto) y notifica a POS. */
export function marcarCatalogoOfflineStale() {
  try { localStorage.setItem(CATALOGO_STALE_KEY, '1') } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENTO_PRODUCTOS))
  }
}

export function catalogoMarcadoStale() {
  try { return localStorage.getItem(CATALOGO_STALE_KEY) === '1' } catch { return false }
}

export function limpiarCatalogoStaleFlag() {
  try { localStorage.removeItem(CATALOGO_STALE_KEY) } catch { /* ignore */ }
}

export function suscribirProductosChanged(callback) {
  if (typeof window === 'undefined') return () => {}
  const handler = () => { callback?.() }
  window.addEventListener(EVENTO_PRODUCTOS, handler)
  return () => window.removeEventListener(EVENTO_PRODUCTOS, handler)
}

// ─── Actualizar solo el stock (más rápido) — re-descarga catálogo ligero vía stock ─
export async function actualizarStock(id_sucursal) {
  // En Electron/SQLite el replace completo con lotes es más seguro que patches parciales IDB.
  // Reutilizamos descargarCatalogo sin UI si se llama en background.
  return descargarCatalogo(id_sucursal, null)
}
