/**
 * Auditoría campo por campo de "Modificar Producto" (ProductoFormModal / Compras).
 *
 * Cada campo se escribe SOLO, se relée de Supabase, y se confirma que cambió.
 * Laboratorio además simula el merge viejo de AdminCompras (el que dejaba el
 * nombre anterior) frente al reemplazo nuevo.
 *
 *   node scripts/auditar-modificar-producto.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import {
  guardarProductoCatalogo,
  nombreLaboratorioDeProducto,
} from '../src/utils/guardarProductoCatalogo.js'
import { filaProductoPrecios } from '../src/utils/productoPrecios.js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

let fallos = 0
const check = (cond, msg) => {
  if (cond) console.log(`OK ${msg}`)
  else { console.error(`FALLO ${msg}`); fallos++ }
}

const [{ data: labs }, { data: fams }, { data: pres }, { data: medidas }] = await Promise.all([
  supabase.from('laboratorios').select('id_laboratorio, nombre').order('id_laboratorio').limit(5),
  supabase.from('familias').select('idfamilia, nombre').order('idfamilia').limit(5),
  supabase.from('presentaciones').select('id_presentacion, nombre').order('id_presentacion').limit(5),
  supabase.from('unidades_medida').select('id_medida, nombre').eq('activo', 1).order('id_medida').limit(1),
])
if ((labs || []).length < 2) throw new Error('se necesitan 2 laboratorios')
if ((fams || []).length < 2) throw new Error('se necesitan 2 familias')
if ((pres || []).length < 2) throw new Error('se necesitan 2 presentaciones')
if (!medidas?.length) throw new Error('se necesita una unidad de medida')

const INICIAL = {
  codigo_barras: '9900000000101',
  descripcion: 'ZZZ AUDIT MOD INICIAL',
  id_familia: fams[0].idfamilia,
  id_laboratorio: labs[0].id_laboratorio,
  id_presentacion: pres[0].id_presentacion,
  principio_activo: 'PA INICIAL',
  fraccion: 10,
  dolencias: 'DOLENCIA INICIAL',
  stock_minimo: 5,
  rotar: false,
  cod_digemid: 'DIG-INI',
  tipo_item: 'PRODUCTO',
  ubicacion: 'ESTANTE INICIAL',
  inafecto: false,
  requiere_receta: false,
  costo: 1.5,
  precio_venta: 3.5,
}

const CAMBIOS = [
  { campo: 'descripcion', tabla: 'productos.descripcion', valor: 'ZZZ AUDIT MOD NOMBRE', leer: (p) => p.descripcion },
  { campo: 'codigo_barras', tabla: 'productos.codigo_barras', valor: '9900000000102', leer: (p) => p.codigo_barras },
  { campo: 'principio_activo', tabla: 'productos.principio_activo', valor: 'PA MODIFICADO', leer: (p) => p.principio_activo },
  { campo: 'id_familia', tabla: 'productos.id_familia', valor: fams[1].idfamilia, leer: (p) => Number(p.id_familia) },
  { campo: 'id_laboratorio', tabla: 'productos.id_laboratorio', valor: labs[1].id_laboratorio, leer: (p) => Number(p.id_laboratorio) },
  { campo: 'id_presentacion', tabla: 'productos.id_presentacion', valor: pres[1].id_presentacion, leer: (p) => Number(p.id_presentacion) },
  { campo: 'fraccion', tabla: 'productos.fraccion', valor: 24, leer: (p) => Number(p.fraccion) },
  { campo: 'dolencias', tabla: 'productos.dolencias', valor: 'DOLENCIA MODIFICADA', leer: (p) => p.dolencias },
  { campo: 'stock_minimo', tabla: 'productos.stock_minimo', valor: 9, leer: (p) => Number(p.stock_minimo) },
  { campo: 'cod_digemid', tabla: 'productos.cod_digemid', valor: 'DIG-MOD', leer: (p) => p.cod_digemid },
  { campo: 'tipo_item', tabla: 'productos.tipo_item', valor: 'SERVICIO', leer: (p) => p.tipo_item },
  { campo: 'ubicacion', tabla: 'productos.ubicacion', valor: 'ESTANTE MODIFICADO', leer: (p) => p.ubicacion },
  { campo: 'rotar', tabla: 'productos.rotar', valor: true, leer: (p) => !!p.rotar },
  { campo: 'inafecto', tabla: 'productos.inafecto', valor: true, leer: (p) => !!p.inafecto },
  { campo: 'requiere_receta', tabla: 'productos.requiere_receta', valor: true, leer: (p) => !!p.requiere_receta },
  { campo: 'costo', tabla: 'producto_precios.costo', valor: 7.25, leer: (p) => Number(filaProductoPrecios(p.producto_precios)?.costo) },
  { campo: 'precio_venta', tabla: 'producto_precios.precio_venta', valor: 12.8, leer: (p) => Number(filaProductoPrecios(p.producto_precios)?.precio_venta) },
]

let idProducto = null
const formActual = { ...INICIAL }

async function leerProducto() {
  const { data, error } = await supabase
    .from('productos')
    .select('*, laboratorios(nombre), producto_precios(precio_venta, costo)')
    .eq('id_producto', idProducto)
    .single()
  if (error) throw new Error(error.message)
  return data
}

async function limpiar() {
  if (idProducto == null) return
  await supabase.from('producto_formas_venta').delete().eq('id_producto', idProducto)
  await supabase.from('producto_precios').delete().eq('id_producto', idProducto)
  await supabase.from('productos').delete().eq('id_producto', idProducto)
}

try {
  const creado = await guardarProductoCatalogo(supabase, { modo: 'nuevo', formProd: INICIAL })
  idProducto = creado.id_producto
  formActual.id_producto = idProducto
  console.log(`OK producto de prueba #${idProducto} creado`)

  const { data: maxForma } = await supabase
    .from('producto_formas_venta')
    .select('id_forma')
    .order('id_forma', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { error: errForma } = await supabase.from('producto_formas_venta').insert({
    id_forma: (maxForma?.id_forma || 0) + 1,
    id_producto: idProducto,
    id_medida: medidas[0].id_medida,
    factor: 1,
    p_compra: INICIAL.costo,
    precio_venta: INICIAL.precio_venta,
    activo: true,
    orden: 1,
  })
  if (errForma) throw new Error(`forma unidad: ${errForma.message}`)

  console.log('\n=== Un campo a la vez (guardar → releer de Supabase) ===')
  for (const cambio of CAMBIOS) {
    formActual[cambio.campo] = cambio.valor
    const { producto } = await guardarProductoCatalogo(supabase, {
      modo: 'editar',
      formProd: { ...formActual },
    })
    const leido = await leerProducto()
    const real = cambio.leer(leido)
    const ok = String(real) === String(cambio.valor)
    check(ok, `${cambio.campo} → ${cambio.tabla}: ${JSON.stringify(cambio.valor)} (leído ${JSON.stringify(real)})`)
    if (cambio.campo === 'id_laboratorio') {
      check(
        nombreLaboratorioDeProducto(producto) === labs[1].nombre,
        `laboratorio nombre hidratado = ${labs[1].nombre} (fue ${nombreLaboratorioDeProducto(producto)})`,
      )
      check(
        leido.laboratorios?.nombre === labs[1].nombre,
        `releer laboratorios(nombre) = ${leido.laboratorios?.nombre}`,
      )

      const seleccionadoViejo = {
        id_producto: idProducto,
        descripcion: INICIAL.descripcion,
        id_laboratorio: labs[0].id_laboratorio,
        laboratorios: { nombre: labs[0].nombre },
      }
      const mergeViejo = { ...seleccionadoViejo, ...{ id_producto: idProducto, id_laboratorio: labs[1].id_laboratorio } }
      check(
        mergeViejo.laboratorios?.nombre === labs[0].nombre,
        `repro: merge viejo se queda con "${labs[0].nombre}" aunque el id ya es ${labs[1].id_laboratorio}`,
      )
      const reemplazo = { ...producto }
      check(
        nombreLaboratorioDeProducto(reemplazo) === labs[1].nombre,
        `fix: reemplazar el objeto muestra "${labs[1].nombre}"`,
      )
    }
    if (cambio.campo === 'precio_venta' || cambio.campo === 'costo') {
      const { data: forma } = await supabase
        .from('producto_formas_venta')
        .select('precio_venta, p_compra, factor')
        .eq('id_producto', idProducto)
        .eq('activo', true)
        .maybeSingle()
      if (cambio.campo === 'precio_venta') {
        check(Number(forma?.precio_venta) === cambio.valor, `precio_venta también en producto_formas_venta (${forma?.precio_venta})`)
      } else {
        check(Number(forma?.p_compra) === cambio.valor, `costo también en producto_formas_venta.p_compra (${forma?.p_compra})`)
      }
    }
  }

  const final = await leerProducto()
  console.log('\n=== Estado final releído (equivalente a cerrar y reabrir el modal) ===')
  console.log(JSON.stringify({
    id_producto: final.id_producto,
    descripcion: final.descripcion,
    laboratorio_id: final.id_laboratorio,
    laboratorio_nombre: final.laboratorios?.nombre,
    precio_venta: filaProductoPrecios(final.producto_precios)?.precio_venta,
    costo: filaProductoPrecios(final.producto_precios)?.costo,
    ubicacion: final.ubicacion,
  }))
} finally {
  await limpiar()
  if (idProducto != null) {
    const { data: queda } = await supabase.from('productos').select('id_producto').eq('id_producto', idProducto)
    console.log(queda?.length === 0
      ? `\nOK producto de prueba #${idProducto} revertido/borrado`
      : `\nAVISO quedó el producto #${idProducto}`)
  }
  console.log(fallos === 0 ? 'OK auditoría sin fallos' : `FALLO ${fallos} verificación(es)`)
  process.exit(fallos === 0 ? 0 : 1)
}
