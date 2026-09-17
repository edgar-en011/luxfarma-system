import { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { consultarYActualizarComprobante, procesarEmisionSunat, EVT_SUNAT_ESTADOS_ACTUALIZADOS } from '../../services/comprobantesSunat';
import { nubefactCredencialesOk } from '../../services/nubefactService';
import SmartDateInput from '../../components/SmartDateInput';
import { esRolOperativo } from '../../utils/roles';
import {
  claseBadgeEstadoSunat,
  claseBadgeValidacionSunat,
  claseDiasComprobanteSunat,
  contarEstadosSunat,
  etiquetaEstadoEnvio,
  etiquetaFiltroSunat,
  etiquetaValidacionSunat,
  filaPasaFiltroSunat,
  textoDiasComprobanteSunat,
} from '../../utils/estadoSunat';
import { DIAS_PLAZO_LEGAL_RESUMEN } from '../../utils/plazosSunatBoleta';
import { etiquetaComprobanteVisible } from '../../utils/comprobanteVisible';
import './AdminSunat.css';
import UiIcon from '../../components/UiIcon';

const PLAZO_DIAS_LEGAL = DIAS_PLAZO_LEGAL_RESUMEN;

const calcularDiasTranscurridos = (createdAt) =>
  Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);

const claseBadgePlazo = (dias) => {
  if (dias >= PLAZO_DIAS_LEGAL) return 'asu-badge-rojo';
  if (dias >= 5) return 'asu-badge-amarillo';
  return 'asu-badge-verde';
};

export default function AdminSunat() {
  const [tab, setTab] = useState('nubefact');
  const [loading, setLoading] = useState(true);
  const [nubefactOk, setNubefactOk] = useState(false);
  const [comprobantes, setComprobantes] = useState([]);
  const [filtroEstado, setFiltroEstado] = useState('vencidos'); // 'vencidos' | 'todos' | 'pendientes' | 'error'

  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [aplicandoRango, setAplicandoRango] = useState(false);
  const [msgRangoFecha, setMsgRangoFecha] = useState(null);
  // Última petición gana — mismo patrón que AdminVentas.jsx, evita que una respuesta
  // obsoleta pise el resultado de una carga más reciente.
  const cargarIdRef = useRef(0);

  const [sucursales, setSucursales] = useState([]);
  const [filtroSucursal, setFiltroSucursal] = useState('todas');
  const [vendedoresActivos, setVendedoresActivos] = useState([]);
  const [filtroVendedor, setFiltroVendedor] = useState('todos');

  const [enviandoId, setEnviandoId] = useState(null);
  const [enviandoTodos, setEnviandoTodos] = useState(false);
  const [confirmarEnviarTodos, setConfirmarEnviarTodos] = useState(false);
  const [msgEnvio, setMsgEnvio] = useState(null);

  const [filasSunat, setFilasSunat] = useState([]);
  const [loadingSunat, setLoadingSunat] = useState(true);
  const [filtroEstadoSunat, setFiltroEstadoSunat] = useState('todos');
  const [consultandoId, setConsultandoId] = useState(null);

  useEffect(() => { cargarComprobantes(); }, [filtroSucursal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargarFilasSunat(); }, [filtroSucursal]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { nubefactCredencialesOk().then(setNubefactOk); }, []);
  useEffect(() => {
    const recargar = () => { cargarFilasSunat(); };
    window.addEventListener(EVT_SUNAT_ESTADOS_ACTUALIZADOS, recargar);
    return () => window.removeEventListener(EVT_SUNAT_ESTADOS_ACTUALIZADOS, recargar);
  }, []);

  const cargarComprobantes = async () => {
    const idLlamada = ++cargarIdRef.current;
    setLoading(true);
    try {
      let queryVentas = supabase
        .from('ventas')
        .select('id_venta, serie, correlativo, total, descuento, created_at, tipo_comprobante, id_sucursal, id_usuario_vendedor, id_cliente, estado_sunat, estado_anulacion, clientes(nombre_razon_social, nombres, apellidos), comprobantes_sunat(serie, numero)')
        .in('estado_sunat', ['PENDIENTE', 'ERROR'])
        .order('created_at', { ascending: true });

      if (fechaDesde) queryVentas = queryVentas.gte('created_at', new Date(fechaDesde + 'T00:00:00-05:00').toISOString());
      if (fechaHasta) queryVentas = queryVentas.lte('created_at', new Date(fechaHasta + 'T23:59:59-05:00').toISOString());
      if (filtroSucursal !== 'todas') queryVentas = queryVentas.eq('id_sucursal', filtroSucursal);

      const [resVentas, resUsuarios, resSucursales] = await Promise.all([
        queryVentas,
        supabase.from('usuarios').select('id_usuario, nombres, apellidos, id_rol, activo'),
        supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
      ]);

      if (idLlamada !== cargarIdRef.current) return;

      const sucursalesData = (resSucursales.data || []).filter(s => String(s.activo) === '1' || s.activo === true);
      const sucursalesActivasIds = new Set(sucursalesData.map(s => s.id_sucursal));
      setSucursales(sucursalesData);
      const usuariosData = resUsuarios.data || [];
      // Todos los vendedores/admins activos del sistema (mismo criterio que
      // AdminVentas.jsx), independientemente de si tienen comprobantes pendientes
      // ahora mismo — para que el filtro muestre siempre la lista completa.
      setVendedoresActivos(
        usuariosData
          .filter(u => esRolOperativo(u.id_rol) && (String(u.activo) === '1' || u.activo === true))
          .map(u => ({ id: u.id_usuario, nombre: `${u.nombres || ''} ${u.apellidos || ''}`.trim() }))
      );

      const ventasData = (resVentas.data || []).filter(v =>
        v.estado_anulacion !== 'ANULADO' && sucursalesActivasIds.has(v.id_sucursal)
      );

      const idsVenta = ventasData.map(v => v.id_venta);
      const { data: comprobantesElec } = idsVenta.length > 0
        ? await supabase.from('comprobantes_electronicos')
            .select('id_venta, cliente_nombre, total_gravada, total_igv')
            .in('id_venta', idsVenta)
        : { data: [] };
      const comprobantesMap = {};
      (comprobantesElec || []).forEach(c => { comprobantesMap[c.id_venta] = c; });

      const filas = ventasData.map(v => {
        const userObj = usuariosData.find(u => u.id_usuario === v.id_usuario_vendedor);
        const vendedor = userObj ? `${userObj.nombres || ''} ${userObj.apellidos || ''}`.trim() : `Vendedor #${v.id_usuario_vendedor}`;
        const elec = comprobantesMap[v.id_venta];
        const total = Number(v.total || 0);
        // Gravado/IGV: se usa el valor ya calculado y guardado en comprobantes_electronicos
        // si existe (venta enviada con Nubefact configurado); si no, se calcula al vuelo
        // desde ventas.total, asumiendo todo gravado (sin exonerados/inafectos) — mismo
        // criterio que ya usa nubefactService.js internamente.
        const gravado = elec ? Number(elec.total_gravada) : Number((total / 1.18).toFixed(2));
        const igv = elec ? Number(elec.total_igv) : Number((total - total / 1.18).toFixed(2));
        // Nombre: 1) denormalizado en comprobante electrónico, 2) cliente enlazado a la
        // venta, 3) "CLIENTE GENERAL" solo si genuinamente no hay nombre (p. ej. backlog
        // antiguo sin id_cliente / sin fila electrónica).
        const cli = v.clientes;
        const nombreDesdeCliente = cli
          ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || (cli.nombre_razon_social || '').trim())
          : '';
        const cliente = (elec?.cliente_nombre || '').trim() || nombreDesdeCliente || 'CLIENTE GENERAL';
        return {
          id_venta: v.id_venta,
          serie: v.serie,
          correlativo: v.correlativo,
          tipo_comprobante: v.tipo_comprobante,
          created_at: v.created_at,
          id_sucursal: v.id_sucursal,
          id_usuario_vendedor: v.id_usuario_vendedor,
          estado_sunat: v.estado_sunat,
          comprobantes_sunat: v.comprobantes_sunat,
          vendedor,
          cliente,
          gravado,
          igv,
          total,
          dias: calcularDiasTranscurridos(v.created_at),
        };
      });

      setComprobantes(filas);
    } catch (error) {
      console.error('Error cargando comprobantes pendientes de SUNAT:', error);
    } finally {
      setLoading(false);
    }
  };

  const cargarFilasSunat = async () => {
    setLoadingSunat(true);
    try {
      const selectFilas = 'id, id_venta, id_sucursal, tipo_comprobante, serie, numero, enlace_pdf, aceptada_por_sunat, estado_envio, mensaje_error, intentos, fecha_envio, fecha_actualizacion, fecha_aceptacion, ventas(total, created_at, clientes(nombres, apellidos, nombre_razon_social))';
      const selectFilasSinAcept = selectFilas.replace('fecha_actualizacion, fecha_aceptacion,', 'fecha_actualizacion,');
      let query = supabase
        .from('comprobantes_sunat')
        .select(selectFilas)
        .order('id', { ascending: false })
        .limit(400);
      if (filtroSucursal !== 'todas') query = query.eq('id_sucursal', filtroSucursal);
      const [resFilas, resSucursales] = await Promise.all([
        query,
        supabase.from('sucursales').select('id_sucursal, nombre_comercial, activo'),
      ]);
      let { data, error } = resFilas;
      if (error && /fecha_aceptacion/i.test(error.message || '')) {
        let q2 = supabase.from('comprobantes_sunat').select(selectFilasSinAcept).order('id', { ascending: false }).limit(400);
        if (filtroSucursal !== 'todas') q2 = q2.eq('id_sucursal', filtroSucursal);
        const retry = await q2;
        data = retry.data;
        error = retry.error;
      }
      if (error) throw error;
      const sucursalesData = (resSucursales.data || []).filter(s => String(s.activo) === '1' || s.activo === true);
      if (sucursalesData.length) setSucursales(sucursalesData);
      setFilasSunat(data || []);
    } catch (error) {
      console.error('Error cargando comprobantes_sunat:', error);
      setFilasSunat([]);
    } finally {
      setLoadingSunat(false);
    }
  };

  const consultarFilaSunat = async (fila) => {
    setConsultandoId(fila.id);
    try {
      const res = await consultarYActualizarComprobante(fila);
      setMsgEnvio({
        ok: res.ok,
        texto: res.ok
          ? `Envío: ${res.estado_envio || 'ENVIADO'} · SUNAT: ${res.data?.aceptada_por_sunat ? 'Aceptada' : 'aún no confirmada'}`
          : (res.error || 'No se pudo consultar el estado.'),
      });
      setTimeout(() => setMsgEnvio(null), 5000);
      await cargarFilasSunat();
    } finally {
      setConsultandoId(null);
    }
  };

  const aplicarRangoManual = async () => {
    // A diferencia de AdminVentas, acá ambas fechas vacías es válido (sin restricción,
    // se ve todo el backlog) — solo es error si se llena una sin la otra, o si el rango
    // viene invertido.
    if ((fechaDesde && !fechaHasta) || (!fechaDesde && fechaHasta)) {
      setMsgRangoFecha('Completa ambas fechas ("Desde" y "Hasta"), o déjalas vacías para ver todo el historial.');
      setTimeout(() => setMsgRangoFecha(null), 4000);
      return;
    }
    if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
      setMsgRangoFecha('La fecha "Desde" no puede ser posterior a "Hasta".');
      setTimeout(() => setMsgRangoFecha(null), 4000);
      return;
    }
    setAplicandoRango(true);
    try {
      await Promise.all([cargarComprobantes(), new Promise(resolve => setTimeout(resolve, 700))]);
    } finally {
      setAplicandoRango(false);
    }
  };

  // Reconstruye y envía un comprobante ya guardado (no recién emitido en el POS) —
  // trae su detalle real de venta_detalle para armar el carrito. El cliente no se
  // reenvía porque no se persiste para ventas de este backlog (ver diagnóstico previo);
  // nubefactService.js ya resuelve cliente=null como "CLIENTE GENERAL" por defecto.
  const enviarUno = async (fila) => {
    setEnviandoId(fila.id_venta);
    // Si la emisión ya salió bien, un fallo POSTERIOR (p. ej. el upsert de
    // comprobantes_electronicos) no debe marcar la venta como ERROR: el comprobante ya
    // está en Nubefact y quedaría ventas.estado_sunat=ERROR contra
    // comprobantes_sunat.estado_envio=ENVIADO — exactamente el desfase que veía el
    // Dashboard en las boletas B003-2 y B003-3.
    let emisionOk = false;
    try {
      const [{ data: detalle }, { data: ventaCompleta }, { data: pagos }, { data: sunatExistente }] = await Promise.all([
        supabase.from('venta_detalle')
          .select('id_producto, cantidad, precio_unitario, subtotal, modo_venta, productos(descripcion)')
          .eq('id_venta', fila.id_venta),
        supabase.from('ventas')
          .select('id_venta, serie, correlativo, total, descuento, tipo_comprobante')
          .eq('id_venta', fila.id_venta)
          .single(),
        supabase.from('pagos_venta')
          .select('metodo, monto')
          .eq('id_venta', fila.id_venta),
        supabase.from('comprobantes_sunat')
          .select('serie, numero, intentos, estado_envio')
          .eq('id_venta', fila.id_venta)
          .maybeSingle(),
      ]);

      const carrito = (detalle || []).map(d => ({
        id_producto: d.id_producto,
        cantidad: d.cantidad,
        precio_unitario: d.precio_unitario,
        subtotal: d.subtotal,
        modo_venta: d.modo_venta,
        descripcion: d.productos?.descripcion,
      }));

      let metodoPagoReenvio = 'Efectivo';
      let mixtoDataReenvio = null;
      if ((pagos || []).length > 1) {
        metodoPagoReenvio = 'Mixto';
        mixtoDataReenvio = {
          metodo1: pagos[0]?.metodo || 'Efectivo',
          metodo2: pagos[1]?.metodo || 'Yape',
          monto1: Number(pagos[0]?.monto || 0),
          monto2: Number(pagos[1]?.monto || 0),
        };
      } else if (pagos?.[0]?.metodo) {
        const m = pagos[0].metodo;
        metodoPagoReenvio = m.charAt(0) + m.slice(1).toLowerCase();
      }

      const respuesta = await procesarEmisionSunat({
        id_venta: fila.id_venta,
        id_sucursal: fila.id_sucursal,
        tipoComprobante: fila.tipo_comprobante,
        carrito,
        cliente: null,
        total: Number(ventaCompleta.total || fila.total || 0),
        metodoPago: metodoPagoReenvio,
        mixtoData: mixtoDataReenvio,
        serieSunat: sunatExistente?.serie || undefined,
        numeroSunat: sunatExistente?.numero || undefined,
        intentosPrevios: sunatExistente?.intentos || 0,
      });

      emisionOk = !!respuesta.ok;
      // procesarEmisionSunat ya actualizó ventas.estado_sunat (incluye POR_CONFIRMAR).

      const payloadElec = {
        serie: respuesta.serie || fila.serie,
        correlativo: respuesta.numero || fila.correlativo,
        tipo_comprobante: fila.tipo_comprobante,
        estado_sunat: respuesta.ok ? 'ENVIADO' : (respuesta.estado_envio || 'ERROR'),
        pdf_url: respuesta.enlace_pdf || null,
        xml_url: respuesta.registro?.enlace_xml || null,
        hash_cdr: respuesta.codigo_hash || respuesta.registro?.key_nubefact || null,
        descripcion_sunat: respuesta.ok ? null : respuesta.error,
        ultimo_error: respuesta.ok ? null : respuesta.error,
        enviado_at: new Date().toISOString(),
        total_gravada: fila.gravado,
        total_igv: fila.igv,
        total: fila.total,
        cliente_nombre: fila.cliente,
        cliente_numero_doc: '00000000',
      };
      const { data: filaExistente } = await supabase
        .from('comprobantes_electronicos').select('id_venta').eq('id_venta', fila.id_venta).maybeSingle();
      if (filaExistente) {
        await supabase.from('comprobantes_electronicos').update(payloadElec).eq('id_venta', fila.id_venta);
      } else {
        await supabase.from('comprobantes_electronicos').insert({ id_venta: fila.id_venta, ...payloadElec });
      }

      return { ok: respuesta.ok };
    } catch (error) {
      console.error('Error enviando comprobante a SUNAT:', error);
      if (!emisionOk) {
        await supabase.from('ventas').update({ estado_sunat: 'ERROR' }).eq('id_venta', fila.id_venta);
      }
      return { ok: emisionOk };
    } finally {
      setEnviandoId(null);
    }
  };

  const enviarTodos = async () => {
    setConfirmarEnviarTodos(false);
    setEnviandoTodos(true);
    setMsgEnvio(null);
    let exitosos = 0, fallidos = 0;
    // Secuencial (no Promise.all) a propósito: evita bombardear la API de Nubefact con
    // decenas de envíos en paralelo, y permite mostrar cuál fila se está enviando ahora.
    for (const fila of comprobantesFiltrados) {
      const resultado = await enviarUno(fila);
      if (resultado?.ok) exitosos++; else fallidos++;
    }
    setMsgEnvio({ ok: fallidos === 0, texto: `Envío en bloque completado: ${exitosos} aceptado(s), ${fallidos} con error.` });
    setTimeout(() => setMsgEnvio(null), 6000);
    setEnviandoTodos(false);
    cargarComprobantes();
  };

  const comprobantesFiltrados = comprobantes.filter(c => {
    if (filtroVendedor !== 'todos' && c.id_usuario_vendedor !== Number(filtroVendedor)) return false;
    if (filtroEstado === 'vencidos') return c.dias >= PLAZO_DIAS_LEGAL;
    if (filtroEstado === 'pendientes') return c.estado_sunat === 'PENDIENTE';
    if (filtroEstado === 'error') return c.estado_sunat === 'ERROR';
    return true;
  });

  const totalVencidos = comprobantes.filter(c => c.dias >= PLAZO_DIAS_LEGAL).length;

  // Mismo conteo que el panel "Estado SUNAT" del Dashboard (contarEstadosSunat), para
  // que el Admin pueda comparar ambas pantallas de un vistazo.
  const conteoSunat = contarEstadosSunat(filasSunat);

  return (
    <div style={{ background: 'var(--lf-bg)', minHeight: '100vh', padding: '2rem 2.5rem' }}>
      <div className="asu-content" style={{ maxWidth: 1400, margin: '0 auto' }}>

        {/* HEADER */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <p style={{ fontSize: '0.78rem', color: 'var(--lf-text-muted)', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', margin: '0 0 0.4rem' }}><UiIcon name="BarChart3" size={15} /> Administración
            </p>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--lf-text)', margin: 0, letterSpacing: '-0.02em' }}>
              Comprobantes SUNAT
            </h1>
            <p style={{ fontSize: '0.95rem', color: 'var(--lf-text-muted)', margin: '0.3rem 0 0' }}>
              {tab === 'nubefact'
                ? `${conteoSunat.total} comprobante${conteoSunat.total === 1 ? '' : 's'} electrónico${conteoSunat.total === 1 ? '' : 's'} · ${conteoSunat.enviados} enviado${conteoSunat.enviados === 1 ? '' : 's'} · ${conteoSunat.pendientes} pendiente${conteoSunat.pendientes === 1 ? '' : 's'} · ${conteoSunat.sin_confirmar} sin confirmar · ${conteoSunat.error} con error · ${conteoSunat.aceptados} aceptado${conteoSunat.aceptados === 1 ? '' : 's'} por SUNAT`
                : `${comprobantes.length} pendiente${comprobantes.length === 1 ? '' : 's'} · ${totalVencidos} vencido${totalVencidos === 1 ? '' : 's'} (≥ ${PLAZO_DIAS_LEGAL} días)`}
            </p>
          </div>
          {tab === 'backlog' && (
          <button
            onClick={() => setConfirmarEnviarTodos(true)}
            disabled={!nubefactOk || enviandoTodos || comprobantesFiltrados.length === 0}
            title={!nubefactOk ? 'Configura las credenciales de Nubefact para habilitar el envío' : undefined}
            className="asu-btn-enviar"
            style={{ padding: '10px 20px', fontSize: '0.88rem' }}
          >
            {enviandoTodos ? (<><span className="row-action-spinner" style={{ borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }}></span> Enviando...</>) : `Enviar todos (${comprobantesFiltrados.length})`}
          </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: '1.25rem' }}>
          <button type="button" className={`asu-chip ${tab === 'nubefact' ? 'active' : ''}`} onClick={() => setTab('nubefact')}>Comprobantes Nubefact</button>
          <button type="button" className={`asu-chip ${tab === 'backlog' ? 'active' : ''}`} onClick={() => setTab('backlog')}>Backlog ventas</button>
        </div>

        {tab === 'nubefact' && (
          <>
            <div className="asu-card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--lf-text-muted)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginRight: 8 }}>Estado</span>
              {['todos', 'PENDIENTE', 'POR_CONFIRMAR', 'ENVIADO', 'SIN_CONFIRMAR', 'ACEPTADO', 'RECHAZADO', 'ERROR', 'REQUIERE_REVISION'].map((k) => (
                <button key={k} type="button" onClick={() => setFiltroEstadoSunat(k)} className={`asu-chip ${filtroEstadoSunat === k ? 'active' : ''}`}>
                  {etiquetaFiltroSunat(k)}
                </button>
              ))}
              <div style={{ marginLeft: 'auto' }}>
                <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)} className="asu-input">
                  <option value="todas">Todas las sedes</option>
                  {sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}
                </select>
              </div>
            </div>
            {conteoSunat.sin_confirmar > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '12px 16px', marginBottom: '1rem', fontSize: '0.85rem', fontWeight: 600, color: '#9a3412' }}>
                <UiIcon name="AlertTriangle" size={15} /> {conteoSunat.sin_confirmar} boleta{conteoSunat.sin_confirmar === 1 ? '' : 's'} sin confirmar en SUNAT. Pueden no estar declaradas: revisalas en Nubefact (resúmenes diarios).
              </div>
            )}
            {msgEnvio && tab === 'nubefact' && (
              <div style={{ background: msgEnvio.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msgEnvio.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 12, padding: '12px 16px', marginBottom: '1.5rem', fontSize: '0.85rem', fontWeight: 600, color: msgEnvio.ok ? '#166534' : '#b91c1c' }}>
                {msgEnvio.texto}
              </div>
            )}
            <div className="asu-card" style={{ overflow: 'hidden' }}>
              {loadingSunat ? (
                <div className="asu-empty">Cargando comprobantes...</div>
              ) : filasSunat.filter(f => filaPasaFiltroSunat(f, filtroEstadoSunat)).length === 0 ? (
                <div className="asu-empty">No hay comprobantes SUNAT para estos filtros. Ejecuta la migración SQL si la tabla aún no existe.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="asu-table">
                    <thead>
                      <tr>
                        <th>Fecha</th>
                        <th>Tipo</th>
                        <th>Serie-Número</th>
                        <th>Cliente</th>
                        <th>Estado envío</th>
                        <th>SUNAT</th>
                        <th>Días</th>
                        <th>Intentos</th>
                        <th>Acciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasSunat.filter(f => filaPasaFiltroSunat(f, filtroEstadoSunat)).map((f) => {
                        const cli = f.ventas?.clientes;
                        const nombre = cli
                          ? (`${cli.nombres || ''} ${cli.apellidos || ''}`.trim() || cli.nombre_razon_social || 'CLIENTE GENERAL')
                          : 'CLIENTE GENERAL';
                        return (
                          <tr key={f.id}>
                            <td>{f.fecha_envio || f.ventas?.created_at ? new Date(f.fecha_envio || f.ventas.created_at).toLocaleDateString('es-PE') : '—'}</td>
                            <td>{f.tipo_comprobante === 1 ? 'Factura' : 'Boleta'}</td>
                            <td>{f.serie && f.numero != null ? `${f.serie}-${f.numero}` : '—'}</td>
                            <td>{nombre}</td>
                            <td><span className={`asu-badge ${claseBadgeEstadoSunat(f.estado_envio)}`}>{etiquetaEstadoEnvio(f.estado_envio)}</span></td>
                            <td><span className={`asu-badge ${claseBadgeValidacionSunat(f)}`}>{etiquetaValidacionSunat(f)}</span></td>
                            <td><span className={claseDiasComprobanteSunat(f)}>{textoDiasComprobanteSunat(f)}</span></td>
                            <td>{f.intentos}</td>
                            <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="asu-btn-enviar"
                                disabled={!nubefactOk || consultandoId === f.id || !f.serie}
                                title={String(f.estado_envio || '').toUpperCase() === 'RECHAZADO' && f.aceptada_por_sunat !== true
                                  ? 'Si SUNAT no lo aceptó, se mantiene el rechazo y el mensaje. Solo se actualiza si ahora figura aceptado.'
                                  : undefined}
                                onClick={() => consultarFilaSunat(f)}
                              >
                                {consultandoId === f.id ? 'Consultando...' : 'Consultar estado'}
                              </button>
                              {f.enlace_pdf && (
                                <a href={f.enlace_pdf} target="_blank" rel="noopener noreferrer" className="asu-btn-enviar" style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>
                                  PDF
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'backlog' && (
        <>
        {!nubefactOk && (
          <div className="asu-banner-token"><UiIcon name="AlertTriangle" size={15} /> Las credenciales de Nubefact no están configuradas en el proceso principal. El listado funciona con normalidad, pero el envío a SUNAT queda deshabilitado.
          </div>
        )}

        {msgEnvio && (
          <div style={{ background: msgEnvio.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${msgEnvio.ok ? '#bbf7d0' : '#fecaca'}`, borderRadius: 12, padding: '12px 16px', marginBottom: '1.5rem', fontSize: '0.85rem', fontWeight: 600, color: msgEnvio.ok ? '#166534' : '#b91c1c' }}>
            {msgEnvio.texto}
          </div>
        )}

        {/* FILTROS */}
        <div className="asu-card" style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--lf-text-muted)', fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', marginRight: 8 }}>
              Estado
            </span>
            {[
              { key: 'vencidos', label: `Vencidos (≥${PLAZO_DIAS_LEGAL} días)`, claseExtra: 'asu-chip-vencidos' },
              { key: 'todos', label: 'Todos' },
              { key: 'pendientes', label: 'Pendientes' },
              { key: 'error', label: 'Con error' },
            ].map(f => (
              <button key={f.key} onClick={() => setFiltroEstado(f.key)} className={`asu-chip ${filtroEstado === f.key ? 'active' : ''} ${f.claseExtra || ''}`}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--lf-text-muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Desde</label>
              <SmartDateInput value={fechaDesde} onChange={(val) => { setFechaDesde(val); setMsgRangoFecha(null); }} className="asu-input" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--lf-text-muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Hasta</label>
              <SmartDateInput value={fechaHasta} onChange={(val) => { setFechaHasta(val); setMsgRangoFecha(null); }} className="asu-input" />
            </div>
            <button
              onClick={aplicarRangoManual}
              disabled={aplicandoRango}
              style={{ padding: '9px 18px', background: 'var(--lf-primary-dark)', color: 'white', border: 'none', borderRadius: 10, fontSize: '0.85rem', fontWeight: 600, cursor: aplicandoRango ? 'default' : 'pointer', height: 38, opacity: aplicandoRango ? 0.75 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            >
              {aplicandoRango ? (<><span className="row-action-spinner" style={{ borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }}></span> Aplicando...</>) : 'Aplicar'}
            </button>
            {msgRangoFecha && (
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#b91c1c', display: 'flex', alignItems: 'center' }}>
                {msgRangoFecha}
              </span>
            )}
            <div style={{ width: 1, height: 38, background: 'var(--lf-border)', margin: '0 0.4rem' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--lf-text-muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Sucursal</label>
              <select value={filtroSucursal} onChange={e => setFiltroSucursal(e.target.value)} className="asu-input">
                <option value="todas">Todas las sedes</option>
                {sucursales.map(s => <option key={s.id_sucursal} value={s.id_sucursal}>{s.nombre_comercial}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.7rem', color: 'var(--lf-text-muted)', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Vendedor</label>
              <select value={filtroVendedor} onChange={e => setFiltroVendedor(e.target.value)} className="asu-input">
                <option value="todos">Todos los vendedores</option>
                {vendedoresActivos.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* TABLA */}
        <div className="asu-card" style={{ overflow: 'hidden' }}>
          {loading ? (
            <div className="asu-empty">Cargando comprobantes...</div>
          ) : comprobantesFiltrados.length === 0 ? (
            <div className="asu-empty">No hay comprobantes {filtroEstado === 'vencidos' ? 'vencidos' : 'pendientes'} para estos filtros.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="asu-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Plazo</th>
                    <th>Documento</th>
                    <th>Serie-Correlativo</th>
                    <th>Cliente</th>
                    <th>Vendedor</th>
                    <th>Gravado</th>
                    <th>IGV</th>
                    <th>Total</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {comprobantesFiltrados.map(c => (
                    <tr key={c.id_venta}>
                      <td>{new Date(c.created_at).toLocaleDateString('es-PE')}</td>
                      <td><span className={`asu-badge ${claseBadgePlazo(c.dias)}`}>{c.dias >= PLAZO_DIAS_LEGAL ? 'VENCIDO' : `${c.dias} día${c.dias === 1 ? '' : 's'}`}</span></td>
                      <td>{c.tipo_comprobante}</td>
                      <td>{etiquetaComprobanteVisible(c)}</td>
                      <td>{c.cliente}</td>
                      <td>{c.vendedor}</td>
                      <td>S/ {c.gravado.toFixed(2)}</td>
                      <td>S/ {c.igv.toFixed(2)}</td>
                      <td>S/ {c.total.toFixed(2)}</td>
                      <td><span className={`asu-badge ${c.estado_sunat === 'ERROR' ? 'asu-badge-estado-error' : 'asu-badge-estado-pendiente'}`}>{c.estado_sunat}</span></td>
                      <td>
                        <button
                          onClick={() => enviarUno(c)}
                          disabled={!nubefactOk || enviandoId === c.id_venta || enviandoTodos}
                          title={!nubefactOk ? 'Configura las credenciales de Nubefact para habilitar el envío' : undefined}
                          className="asu-btn-enviar"
                        >
                          {enviandoId === c.id_venta ? (<><span className="row-action-spinner" style={{ borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' }}></span> Enviando...</>) : 'Enviar'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </>
        )}
      </div>

      {/* MODAL CONFIRMAR ENVIAR TODOS */}
      {confirmarEnviarTodos && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(31, 26, 27, 0.5)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100030, padding: '1rem' }} onClick={() => setConfirmarEnviarTodos(false)}>
          <div style={{ background: 'white', borderRadius: 20, width: '100%', maxWidth: 440, padding: '2rem', boxShadow: '0 25px 80px rgba(0,0,0,0.25)', animation: 'asuSlideUp 0.3s ease' }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}><UiIcon name="Upload" size={16} /></div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--lf-text)', margin: '0 0 4px' }}>Enviar todos a SUNAT</h3>
              <p style={{ fontSize: '0.88rem', color: 'var(--lf-text-muted)', margin: 0 }}>
                Se enviarán {comprobantesFiltrados.length} comprobante{comprobantesFiltrados.length === 1 ? '' : 's'} ({filtroEstado === 'vencidos' ? 'vencidos' : filtroEstado === 'todos' ? 'todos los filtrados' : filtroEstado}).
              </p>
            </div>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 16px', marginBottom: '1.2rem' }}>
              <p style={{ fontSize: '0.82rem', color: '#92400e', margin: 0, fontWeight: 600 }}><UiIcon name="AlertTriangle" size={15} /> Son documentos legales reales una vez enviados. Esta acción no se puede deshacer desde acá.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button onClick={() => setConfirmarEnviarTodos(false)} style={{ flex: 1, padding: '0.85rem', background: 'var(--lf-info-bg)', border: 'none', borderRadius: 12, fontWeight: 600, fontSize: '0.92rem', cursor: 'pointer', color: '#52525B' }}>
                Cancelar
              </button>
              <button onClick={enviarTodos} style={{ flex: 1, padding: '0.85rem', background: 'var(--lf-primary-dark)', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: '0.92rem', cursor: 'pointer', color: 'white' }}>
                Confirmar envío
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
