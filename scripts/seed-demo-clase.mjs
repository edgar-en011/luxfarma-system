/**
 * Carga de demostración: stock en lotes + 50 ventas vía sincronizar_venta_offline.
 * Uso: node scripts/seed-demo-clase.mjs
 * No toca .env. Lee VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.VITE_SUPABASE_ANON_KEY;
const VENTAS_OBJETIVO = 50;
const PRODUCTOS_STOCK = 40;
const UNIDADES_POR_LOTE = 400;
const LOTE_DEMO = 'DEMO-CLASE';

if (!URL || !KEY) {
  console.error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const supabase = createClient(URL, KEY, { auth: { persistSession: false } });

function precioDe(prod) {
  const filas = Array.isArray(prod.producto_precios) ? prod.producto_precios : [];
  const p = Number(filas[0]?.precio_venta || 0);
  return p > 0 ? p : 5.5;
}

function formaDe(prod) {
  const formas = (prod.producto_formas_venta || []).filter((f) => f.activo !== false);
  const unidad = formas.find((f) => Number(f.factor) === 1) || formas[0];
  return {
    factor: Number(unidad?.factor) || 1,
    id_medida: unidad?.id_medida || null,
    modo: Number(unidad?.factor) > 1 ? 'CAJA' : 'UNIDAD',
  };
}

async function main() {
  const { data: sucursales, error: errSuc } = await supabase
    .from('sucursales')
    .select('id_sucursal, nombre_comercial')
    .order('id_sucursal')
    .limit(5);
  if (errSuc) throw errSuc;
  if (!sucursales?.length) throw new Error('No hay sucursales.');
  const sucursal = sucursales[0];
  const idSucursal = sucursal.id_sucursal;
  console.log('Sucursal:', idSucursal, sucursal.nombre_comercial);

  const { data: usuarios, error: errUsu } = await supabase
    .from('usuarios')
    .select('id_usuario, nombres, apellidos, id_sucursal, activo')
    .eq('activo', 1)
    .order('id_usuario')
    .limit(20);
  if (errUsu) throw errUsu;
  const usuario = (usuarios || []).find((u) => Number(u.id_sucursal) === Number(idSucursal))
    || (usuarios || [])[0];
  if (!usuario) throw new Error('No hay usuarios activos.');
  const idUsuario = usuario.id_usuario;
  console.log('Vendedor:', idUsuario, usuario.nombres, usuario.apellidos);

  let { data: turno } = await supabase
    .from('caja_turnos')
    .select('id_turno, estado')
    .eq('id_sucursal', idSucursal)
    .eq('estado', 'ABIERTO')
    .order('id_turno', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!turno?.id_turno) {
    const { data: nuevo, error: errTurno } = await supabase
      .from('caja_turnos')
      .insert({
        id_sucursal: idSucursal,
        id_usuario_vendedor: idUsuario,
        monto_apertura: 100,
        estado: 'ABIERTO',
      })
      .select('id_turno')
      .single();
    if (errTurno) throw errTurno;
    turno = nuevo;
    console.log('Turno abierto:', turno.id_turno);
  } else {
    console.log('Turno existente:', turno.id_turno);
  }

  const { data: productos, error: errProd } = await supabase
    .from('productos')
    .select(`
      id_producto, descripcion, activo,
      producto_precios (precio_venta),
      producto_formas_venta (factor, activo, id_medida)
    `)
    .eq('activo', 1)
    .order('descripcion')
    .limit(PRODUCTOS_STOCK);
  if (errProd) throw errProd;
  if (!productos?.length) throw new Error('No hay productos activos.');

  let lotesCreados = 0;
  for (const prod of productos) {
    const { data: existente } = await supabase
      .from('inventario_lotes')
      .select('id_lote, cantidad_actual')
      .eq('id_producto', prod.id_producto)
      .eq('id_sucursal', idSucursal)
      .eq('nro_lote', LOTE_DEMO)
      .maybeSingle();
    if (existente?.id_lote) {
      const { error } = await supabase
        .from('inventario_lotes')
        .update({ cantidad_actual: UNIDADES_POR_LOTE, estado: 'VIGENTE', fecha_vencimiento: '2027-12-31' })
        .eq('id_lote', existente.id_lote);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('inventario_lotes').insert({
        id_sucursal: idSucursal,
        id_producto: prod.id_producto,
        nro_lote: LOTE_DEMO,
        cantidad_actual: UNIDADES_POR_LOTE,
        costo_unitario_lote: 0,
        fecha_vencimiento: '2027-12-31',
        estado: 'VIGENTE',
      });
      if (error) throw error;
    }
    await supabase.from('kardex_movimientos').insert({
      id_sucursal: idSucursal,
      id_producto: prod.id_producto,
      tipo: 'ENTRADA',
      cantidad: UNIDADES_POR_LOTE,
      saldo: UNIDADES_POR_LOTE,
      id_lote: LOTE_DEMO,
      id_usuario: idUsuario,
      observacion: 'Carga demo clase',
    });
    lotesCreados += 1;
  }
  console.log(`Stock listo en ${lotesCreados} productos (lote ${LOTE_DEMO}).`);

  const metodos = ['EFECTIVO', 'EFECTIVO', 'YAPE', 'PLIN', 'TARJETA'];
  let ok = 0;
  const idsVenta = [];
  for (let i = 0; i < VENTAS_OBJETIVO; i += 1) {
    const nItems = 1 + (i % 3);
    const items = [];
    let total = 0;
    for (let j = 0; j < nItems; j += 1) {
      const prod = productos[(i * 3 + j) % productos.length];
      const forma = formaDe(prod);
      const cantidad = 1 + (i % 2);
      const precio = precioDe(prod);
      const subtotal = Number((cantidad * precio).toFixed(2));
      total += subtotal;
      items.push({
        id_producto: prod.id_producto,
        modo_venta: forma.factor === 1 ? 'UNIDAD' : forma.modo,
        cantidad,
        precio_unitario: precio,
        subtotal,
        factor: forma.factor,
        id_medida: forma.id_medida,
        lote: LOTE_DEMO,
        nombre: prod.descripcion,
      });
    }
    total = Number(total.toFixed(2));
    const metodo = metodos[i % metodos.length];
    const payload = {
      uuid_venta: randomUUID(),
      id_sucursal: idSucursal,
      id_turno: turno.id_turno,
      id_usuario: idUsuario,
      tipo_comprobante: 'NOTA DE VENTA',
      serie: 'NV01',
      total,
      vuelto: 0,
      monto_recibido: total,
      estado_sunat: 'NO_APLICA',
      cliente: {
        ventaSinDoc: true,
        tipoDoc: 'SIN_DOC',
        nombres: 'Cliente',
        apellidos: `Demo ${String(i + 1).padStart(2, '0')}`,
        nombreRazonSocial: `Cliente Demo ${String(i + 1).padStart(2, '0')}`,
      },
      items,
      pagos: [{ metodo, monto: total }],
    };

    const { data, error } = await supabase.rpc('sincronizar_venta_offline', { p_payload: payload });
    if (error) throw new Error(`Venta ${i + 1}: ${error.message}`);
    const row = typeof data === 'string' ? JSON.parse(data) : (data || {});
    if (!row.ok) throw new Error(`Venta ${i + 1}: ${row.error || 'falló'}`);
    idsVenta.push(row.id_venta);
    ok += 1;
    process.stdout.write(`\rVentas registradas: ${ok}/${VENTAS_OBJETIVO}`);
  }
  console.log('');

  const inicio = new Date('2026-10-24T13:00:00.000Z');
  for (let i = 0; i < idsVenta.length; i += 1) {
    const created = new Date(inicio.getTime() + i * 12 * 60 * 1000);
    await supabase.from('ventas').update({ created_at: created.toISOString() }).eq('id_venta', idsVenta[i]);
  }

  const { count: ventasHoy } = await supabase
    .from('ventas')
    .select('id_venta', { count: 'exact', head: true })
    .gte('created_at', '2026-10-24T05:00:00.000Z');
  const { count: lotes } = await supabase
    .from('inventario_lotes')
    .select('id_lote', { count: 'exact', head: true })
    .eq('nro_lote', LOTE_DEMO)
    .eq('estado', 'VIGENTE');

  console.log(`Listo. ${ok} ventas (NV01) · lotes vigentes ${LOTE_DEMO}: ${lotes} · ventas desde hoy: ${ventasHoy}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
