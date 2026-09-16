import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import SmartDateInput from '../../components/SmartDateInput';
import SearchableSelect from '../../components/SearchableSelect';
import { hoyLocal } from '../../utils/fechas';
import { assertEscritura } from '../../utils/supaWrite';
import { fetchProveedores, suscribirProveedoresChanged } from '../../utils/proveedoresCatalogo';
import './AdminCuentas.css';
import UiIcon from '../../components/UiIcon';

export default function AdminCuentas() {
  const { user } = useAuth();
  const [comprasCredito, setComprasCredito] = useState([]);
  const [cargando, setCargando] = useState(true);

  // Filtros
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('TODOS');
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('');
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('');
  const [filtroProveedorId, setFiltroProveedorId] = useState('');
  const [dbProveedores, setDbProveedores] = useState([]);

  // Modal de Pago
  const [showModalPago, setShowModalPago] = useState(false);
  const [compraAPagar, setCompraAPagar] = useState(null);
  const [montoAbono, setMontoAbono] = useState('');
  const [metodoPago, setMetodoPago] = useState('Efectivo');
  const [referenciaPago, setReferenciaPago] = useState('');
  const [observacionPago, setObservacionPago] = useState('');
  const [procesandoPago, setProcesandoPago] = useState(false);

  // Modal de Historial / Detalle de compra
  const [showModalDetalle, setShowModalDetalle] = useState(false);
  const [compraDetalle, setCompraDetalle] = useState(null);
  const [itemsDetalle, setItemsDetalle] = useState([]);
  const [historialPagos, setHistorialPagos] = useState([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  // Alerta inline
  const [alertaInline, setAlertaInline] = useState(null);
  const mostrarAlerta = (mensaje, tipo = 'info') => {
    setAlertaInline({ mensaje, tipo });
    setTimeout(() => setAlertaInline(null), 4000);
  };

  const abrirDetalle = async (compra) => {
    setCompraDetalle(compra);
    setItemsDetalle([]);
    setHistorialPagos([]);
    setShowModalDetalle(true);
    setCargandoDetalle(true);
    try {
      const [resDetalle, resPagos] = await Promise.all([
        supabase
          .from('compra_detalle')
          .select('*, productos(descripcion, codigo_barras)')
          .eq('id_compra', compra.id_compra)
          .order('id_compra_det', { ascending: true }),
        supabase
          .from('pagos_compra')
          .select('*')
          .eq('id_compra', compra.id_compra)
          .order('created_at', { ascending: true }),
      ]);
      if (resDetalle.error) throw resDetalle.error;
      setItemsDetalle(resDetalle.data || []);
      setHistorialPagos(resPagos.data || []);
    } catch (err) {
      mostrarAlerta('Error al cargar el detalle: ' + err.message, 'error');
    } finally {
      setCargandoDetalle(false);
    }
  };

  const cargarCuentasPorPagar = async () => {
    setCargando(true);
    try {
      const { data, error } = await supabase
        .from('compras')
        .select(`*, proveedores (ruc, razon_social)`)
        .not('forma_pago', 'ilike', 'contado')
        .order('fecha_vencimiento', { ascending: true });

      if (error) throw error;
      const dataValida = (data || []).filter(c => c.forma_pago && c.forma_pago.toUpperCase().includes('CR'));
      setComprasCredito(dataValida);
    } catch (error) {
      console.error('Error al cargar cuentas:', error);
      mostrarAlerta('Error al cargar las cuentas por pagar.', 'error');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarCuentasPorPagar(); }, []);

  // Catálogo de proveedores — se refresca al crear uno nuevo en Compras (bus de eventos).
  useEffect(() => {
    const cargar = async () => {
      try {
        const data = await fetchProveedores();
        setDbProveedores((data || []).map(p => ({ id_proveedor: p.id_proveedor, razon_social: p.razon_social })));
      } catch { /* ignore */ }
    };
    cargar();
    return suscribirProveedoresChanged(cargar);
  }, []);

  // Procesamiento (días, saldos, estados) — esAnulada se calcula una sola vez acá y se
  // usa en todos lados de acá en adelante (KPIs, filtros, tabla) para que ninguna compra
  // anulada vuelva a colarse en un cálculo de deuda por descuido.
  const datosProcesados = useMemo(() => {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    return comprasCredito.map(compra => {
      const esAnulada = compra.estado_anulacion === 'ANULADO';
      const total   = Number(compra.total_compra || 0);
      const pagado  = Number(compra.monto_pagado || 0);
      const saldo   = total - pagado;
      const fVenc   = new Date(compra.fecha_vencimiento); fVenc.setHours(0,0,0,0);
      const diasRestantes = Math.ceil((fVenc - hoy) / 86400000);

      let estadoDinamico = 'POR VENCER';
      if (esAnulada)          estadoDinamico = 'ANULADA';
      else if (saldo <= 0)        estadoDinamico = 'PAGADO';
      else if (diasRestantes < 0) estadoDinamico = 'VENCIDO';

      return { ...compra, esAnulada, saldo, diasRestantes, estadoDinamico };
    });
  }, [comprasCredito]);

  // Filtros — las anuladas quedan EXCLUIDAS de todas las vistas normales (Todos,
  // Urgentes, Vencidos, Por vencer, Pagados); solo aparecen si se elige explícitamente
  // el pill "Anuladas", para poder auditarlas sin que se mezclen con la deuda real.
  const datosFiltrados = useMemo(() => {
    return datosProcesados.filter(c => {
      const matchBusqueda =
        (c.proveedores?.razon_social || '').toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.nro_documento || '').toLowerCase().includes(busqueda.toLowerCase());

      let matchEstado = true;
      if (filtroEstado === 'ANULADAS') {
        matchEstado = c.esAnulada;
      } else {
        if (c.esAnulada) return false;
        if (filtroEstado === 'VENCIDOS')   matchEstado = c.estadoDinamico === 'VENCIDO';
        if (filtroEstado === 'POR_VENCER') matchEstado = c.estadoDinamico === 'POR VENCER';
        if (filtroEstado === 'PAGADOS')    matchEstado = c.estadoDinamico === 'PAGADO';
        if (filtroEstado === 'URGENTES')   matchEstado = c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 2;
      }

      let matchFecha = true;
      if (filtroFechaDesde || filtroFechaHasta) {
        const fCompra = new Date(c.fecha_compra); fCompra.setHours(0,0,0,0);
        if (filtroFechaDesde) matchFecha = matchFecha && fCompra >= new Date(filtroFechaDesde + 'T00:00:00');
        if (filtroFechaHasta) matchFecha = matchFecha && fCompra <= new Date(filtroFechaHasta + 'T00:00:00');
      }

      const matchProveedor = !filtroProveedorId || String(c.id_proveedor) === String(filtroProveedorId);

      return matchBusqueda && matchEstado && matchFecha && matchProveedor;
    });
  }, [datosProcesados, busqueda, filtroEstado, filtroFechaDesde, filtroFechaHasta, filtroProveedorId]);

  // KPIs — todas excluyen explícitamente las anuladas (!c.esAnulada), nunca deben sumar
  // a ningún total de deuda.
  const kpiDeudaTotal    = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO').reduce((s,c) => s+c.saldo, 0);
  const facturasActivas  = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO').length;
  const facturasVencidas = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico === 'VENCIDO').length;
  const kpiVenceSemana   = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 7).reduce((s,c) => s+c.saldo, 0);
  const qtyVenceSemana   = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 7).length;
  const kpiVenceMes      = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 30).reduce((s,c) => s+c.saldo, 0);
  const qtyVenceMes      = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 30).length;
  // "Pagado hoy" — compara por fecha LOCAL del perú (no por string UTC)
  const hoyLocalStr = new Date().toLocaleDateString('es-PE'); // ej: "20/4/2026"
  const kpiPagadoHoy   = comprasCredito.filter(c => {
    if (c.estado_anulacion === 'ANULADO' || c.estado_pago !== 'PAGADO' || !c.updated_at) return false;
    const fechaLocal = new Date(c.updated_at).toLocaleDateString('es-PE');
    return fechaLocal === hoyLocalStr;
  }).reduce((s,c) => s + Number(c.monto_pagado||0), 0);
  const qtyPagadoHoy   = comprasCredito.filter(c => {
    if (c.estado_anulacion === 'ANULADO' || c.estado_pago !== 'PAGADO' || !c.updated_at) return false;
    return new Date(c.updated_at).toLocaleDateString('es-PE') === hoyLocalStr;
  }).length;
  const qtyUrgentes      = datosProcesados.filter(c => !c.esAnulada && c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 2).length;

  // Modal pago
  const abrirModalPago = (compra) => {
    setCompraAPagar(compra);
    setMontoAbono(compra.saldo.toFixed(2));
    setMetodoPago('Efectivo');
    setReferenciaPago('');
    setObservacionPago('');
    setShowModalPago(true);
  };

  const handleRegistrarPago = async (e) => {
    e.preventDefault();
    const abonoNum = Number(montoAbono);
    if (abonoNum <= 0 || abonoNum > compraAPagar.saldo)
      return mostrarAlerta('Monto inválido. Debe ser mayor a 0 y no superar el saldo.', 'warning');
    setProcesandoPago(true);
    try {
      const nuevoPagado = Number(compraAPagar.monto_pagado) + abonoNum;
      const nuevoEstado = nuevoPagado >= compraAPagar.total_compra ? 'PAGADO' : 'PENDIENTE';

      // 1️⃣ Actualizar totales en la factura
      const { data: compraUpd, error } = await supabase.from('compras')
        .update({ monto_pagado: nuevoPagado, estado_pago: nuevoEstado })
        .eq('id_compra', compraAPagar.id_compra)
        .select('id_compra');
      assertEscritura(compraUpd, error, 'No se actualizó la compra al registrar el abono.');

      // 2️⃣ Registrar el abono en el historial de pagos
      const { data: pagoIns, error: errPago } = await supabase.from('pagos_compra').insert({
        id_compra:   compraAPagar.id_compra,
        monto:       abonoNum,
        fecha_pago:  hoyLocal(),
        metodo_pago: metodoPago,
        referencia:  referenciaPago || null,
        observacion: observacionPago || null,
        id_usuario:  user?.id_usuario || null,
      }).select();
      assertEscritura(pagoIns, errPago, 'No se registró el abono en el historial de pagos.');

      mostrarAlerta(`Pago de S/ ${abonoNum.toFixed(2)} registrado correctamente.`, 'success');
      setShowModalPago(false);
      cargarCuentasPorPagar();
    } catch (error) {
      mostrarAlerta('Error al procesar el pago: ' + error.message, 'error');
    } finally {
      setProcesandoPago(false);
    }
  };

  if (cargando) return <div style={{padding:'3rem',textAlign:'center',color:'#64748b'}}>Cargando estado de cuenta...</div>;

  return (
    <div className="cxp-container">

      {/* ALERTA INLINE */}
      {alertaInline && (
        <div className={`cxp-alert-inline cxp-alert-${alertaInline.tipo}`}>
          {alertaInline.mensaje}
          <button onClick={() => setAlertaInline(null)}><UiIcon name="X" size={16} /></button>
        </div>
      )}

      {/* BANNER URGENTE si hay deudas ≤2 días */}
      {qtyUrgentes > 0 && (
        <div className="cxp-urgente-banner" onClick={() => setFiltroEstado('URGENTES')}><UiIcon name="Siren" size={16} /><strong>{qtyUrgentes} deuda{qtyUrgentes > 1 ? 's' : ''} vence{qtyUrgentes === 1 ? '' : 'n'} en ≤2 días.</strong>
          &nbsp;Haz clic para verlas.
        </div>
      )}

      {/* MODAL DE PAGO */}
      {showModalPago && compraAPagar && (
        <div className="modal-overlay-strict">
          <div className="cxp-modal-card">
            <div className="cxp-modal-header">
              <div>
                <h3><UiIcon name="CreditCard" size={15} /> Registrar Pago a Proveedor</h3>
                <p className="cxp-modal-subtitle">Factura: {compraAPagar.nro_documento} — {compraAPagar.proveedores?.razon_social}</p>
              </div>
              <button className="cxp-modal-close" onClick={() => setShowModalPago(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <form onSubmit={handleRegistrarPago} className="cxp-modal-body">
              <div className="cxp-modal-grid">
                <div className="cxp-info-box">
                  <label>Deuda Total Original</label>
                  <span>S/ {Number(compraAPagar.total_compra).toFixed(2)}</span>
                </div>
                <div className="cxp-info-box warning">
                  <label>Saldo Pendiente</label>
                  <span style={{color:'#b91c1c',fontWeight:800}}>S/ {compraAPagar.saldo.toFixed(2)}</span>
                </div>
              </div>

              {/* Monto */}
              <div className="cxp-input-group">
                <label>Monto a abonar (S/) *</label>
                <input
                  type="number" step="0.01" min="0.01" max={compraAPagar.saldo} required
                  value={montoAbono} onChange={e => setMontoAbono(e.target.value)}
                />
                <small>Máximo: S/ {compraAPagar.saldo.toFixed(2)}. Puedes hacer abonos parciales.</small>
              </div>

              {/* Método de pago */}
              <div className="cxp-input-group">
                <label>Método de pago *</label>
                <select value={metodoPago} onChange={e => setMetodoPago(e.target.value)} style={{width:'100%',padding:'0.55rem 0.7rem',border:'1.5px solid #e2e8f0',borderRadius:'8px',fontSize:'0.9rem'}}>
                  <option value="Efectivo">Efectivo</option>
                  <option value="Transferencia">Transferencia bancaria</option>
                  <option value="Yape">Yape / Plin</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Otro">Otro</option>
                </select>
              </div>

              {/* Referencia */}
              <div className="cxp-input-group">
                <label>N° de operación / referencia <span style={{color:'#94a3b8',fontWeight:400}}>(opcional)</span></label>
                <input
                  type="text" placeholder="Ej: 0012345678 o cheque #001"
                  value={referenciaPago} onChange={e => setReferenciaPago(e.target.value)}
                />
              </div>

              {/* Observación */}
              <div className="cxp-input-group">
                <label>Observación <span style={{color:'#94a3b8',fontWeight:400}}>(opcional)</span></label>
                <input
                  type="text" placeholder="Ej: Pago parcial acordado con el proveedor"
                  value={observacionPago} onChange={e => setObservacionPago(e.target.value)}
                />
              </div>

              <div className="cxp-modal-footer">
                <button type="button" className="btn-cxp-cancel" data-enter-skip="true" tabIndex={-1} onClick={() => setShowModalPago(false)}>Cancelar</button>
                <button type="submit" className="btn-cxp-pay" disabled={procesandoPago}>
                  {procesandoPago ? 'Procesando...' : 'Confirmar Pago'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL HISTORIAL / DETALLE DE COMPRA */}
      {showModalDetalle && compraDetalle && (
        <div className="modal-overlay-strict" style={{zIndex:100031}}>
          <div className="cxp-modal-card" style={{maxWidth:'780px',width:'100%'}}>
            <div className="cxp-modal-header" style={{background:'linear-gradient(135deg,#0f172a,#1e293b)',color:'white'}}>
              <div>
                <h3 style={{color:'white'}}><UiIcon name="ClipboardList" size={15} /> Detalle de Compra</h3>
                <p className="cxp-modal-subtitle" style={{color:'#94a3b8'}}>
                  Factura: <strong style={{color:'#60a5fa'}}>{compraDetalle.nro_documento}</strong> — {compraDetalle.proveedores?.razon_social}
                </p>
              </div>
              <button className="cxp-modal-close" style={{color:'white',background:'rgba(255,255,255,0.1)'}} onClick={() => setShowModalDetalle(false)}><UiIcon name="X" size={16} /></button>
            </div>
            <div className="cxp-modal-body">
              {/* Resumen de la factura */}
              <div className="cxp-modal-grid" style={{marginBottom:'1rem'}}>
                <div className="cxp-info-box">
                  <label>F. Compra</label>
                  <span>{new Date(compraDetalle.fecha_compra).toLocaleDateString('es-PE')}</span>
                </div>
                <div className="cxp-info-box">
                  <label>Total Factura</label>
                  <span style={{color:'#0f172a',fontWeight:800}}>S/ {Number(compraDetalle.total_compra).toFixed(2)}</span>
                </div>
                <div className="cxp-info-box">
                  <label>Pagado</label>
                  <span style={{color:'#16a34a',fontWeight:700}}>S/ {Number(compraDetalle.monto_pagado||0).toFixed(2)}</span>
                </div>
                <div className="cxp-info-box" style={{background: compraDetalle.saldo > 0 ? '#fef2f2':'#f0fdf4'}}>
                  <label>Saldo</label>
                  <span style={{color: compraDetalle.saldo > 0 ? '#b91c1c':'#16a34a',fontWeight:800}}>
                    S/ {compraDetalle.saldo?.toFixed(2) ?? '0.00'}
                  </span>
                </div>
              </div>

              {/* Tabla de productos */}
              <p style={{fontSize:'0.72rem',fontWeight:700,color:'#94a3b8',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:'0.5rem'}}>PRODUCTOS DE ESTA FACTURA</p>
              <div style={{overflowX:'auto',border:'1px solid #e2e8f0',borderRadius:'10px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.85rem'}}>
                  <thead>
                    <tr style={{background:'#f8fafc'}}>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'left',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>PRODUCTO</th>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'left',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>LOTE</th>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'left',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>VENCE</th>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'right',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>CANT.</th>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'right',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>P. COSTO</th>
                      <th style={{padding:'0.6rem 0.8rem',textAlign:'right',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>SUBTOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cargandoDetalle ? (
                      <tr><td colSpan="6" style={{textAlign:'center',padding:'2rem',color:'#94a3b8'}}>Cargando productos...</td></tr>
                    ) : itemsDetalle.length === 0 ? (
                      <tr><td colSpan="6" style={{textAlign:'center',padding:'2rem',color:'#94a3b8',fontStyle:'italic'}}>No hay detalle registrado.</td></tr>
                    ) : (
                      itemsDetalle.map((item, i) => (
                        <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                          <td style={{padding:'0.6rem 0.8rem',fontWeight:600,color:'#0f172a'}}>{item.productos?.descripcion || '—'}</td>
                          <td style={{padding:'0.6rem 0.8rem',color:'#64748b',fontSize:'0.8rem'}}>{item.nro_lote || '—'}</td>
                          <td style={{padding:'0.6rem 0.8rem',color:'#64748b',fontSize:'0.8rem'}}>{item.fecha_vencimiento ? new Date(item.fecha_vencimiento).toLocaleDateString('es-PE') : '—'}</td>
                          <td style={{padding:'0.6rem 0.8rem',textAlign:'right'}}>{item.cantidad} und</td>
                          <td style={{padding:'0.6rem 0.8rem',textAlign:'right',color:'#475569'}}>S/ {Number(item.costo_unitario).toFixed(4)}</td>
                          <td style={{padding:'0.6rem 0.8rem',textAlign:'right',fontWeight:700,color:'#0f172a'}}>S/ {Number(item.subtotal).toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                  {itemsDetalle.length > 0 && (
                    <tfoot>
                      <tr style={{borderTop:'2px solid #0f172a'}}>
                        <td colSpan="5" style={{padding:'0.6rem 0.8rem',textAlign:'right',fontWeight:700,fontSize:'0.9rem'}}>TOTAL FACTURA:</td>
                        <td style={{padding:'0.6rem 0.8rem',textAlign:'right',fontWeight:800,fontSize:'1rem',color:'#0f172a'}}>S/ {Number(compraDetalle.total_compra).toFixed(2)}</td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* ── HISTORIAL DE PAGOS ── */}
              <div style={{marginTop:'1.2rem'}}>
                <p style={{fontSize:'0.72rem',fontWeight:700,color:'#94a3b8',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:'0.6rem'}}>
                  <UiIcon name="ClipboardList" size={15} /> HISTORIAL DE ABONOS ({historialPagos.length})
                </p>
                {historialPagos.length === 0 ? (
                  <div style={{padding:'1rem',background:'#f8fafc',borderRadius:'8px',textAlign:'center',color:'#94a3b8',fontSize:'0.85rem',fontStyle:'italic'}}>
                    {cargandoDetalle ? 'Cargando historial...' : 'No hay pagos registrados aún para esta factura.'}
                  </div>
                ) : (
                  <div style={{border:'1px solid #e2e8f0',borderRadius:'10px',overflow:'hidden'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.83rem'}}>
                      <thead>
                        <tr style={{background:'#f8fafc'}}>
                          {['#','Fecha','Monto','Método','Referencia','Observación'].map(h => (
                            <th key={h} style={{padding:'0.5rem 0.7rem',textAlign:'left',fontSize:'0.65rem',fontWeight:700,color:'#94a3b8',textTransform:'uppercase',borderBottom:'1px solid #e2e8f0'}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {historialPagos.map((pago, idx) => (
                          <tr key={pago.id_pago} style={{borderBottom:'1px solid #f1f5f9',background: idx%2===0?'#fff':'#f8fafc'}}>
                            <td style={{padding:'0.5rem 0.7rem',color:'#94a3b8',fontWeight:600}}>{idx+1}</td>
                            <td style={{padding:'0.5rem 0.7rem',fontWeight:600,color:'#0f172a'}}>
                              {new Date(pago.fecha_pago + 'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'})}
                            </td>
                            <td style={{padding:'0.5rem 0.7rem',fontWeight:800,color:'#16a34a'}}>S/ {Number(pago.monto).toFixed(2)}</td>
                            <td style={{padding:'0.5rem 0.7rem'}}>
                              <span style={{background: pago.metodo_pago==='Efectivo'?'#dcfce7':pago.metodo_pago==='Yape'?'#ede9fe':pago.metodo_pago==='Transferencia'?'#dbeafe':'#f1f5f9',color: pago.metodo_pago==='Efectivo'?'#16a34a':pago.metodo_pago==='Yape'?'#7c3aed':pago.metodo_pago==='Transferencia'?'#1d4ed8':'#475569',padding:'2px 8px',borderRadius:20,fontSize:'0.72rem',fontWeight:700}}>
                                {pago.metodo_pago}
                              </span>
                            </td>
                            <td style={{padding:'0.5rem 0.7rem',color:'#64748b',fontSize:'0.8rem'}}>{pago.referencia || '—'}</td>
                            <td style={{padding:'0.5rem 0.7rem',color:'#64748b',fontSize:'0.8rem'}}>{pago.observacion || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr style={{borderTop:'2px solid #0f172a',background:'#f8fafc'}}>
                          <td colSpan="2" style={{padding:'0.5rem 0.7rem',fontWeight:700,fontSize:'0.85rem',color:'#0f172a'}}>TOTAL ABONADO</td>
                          <td style={{padding:'0.5rem 0.7rem',fontWeight:800,color:'#16a34a',fontSize:'0.95rem'}}>
                            S/ {historialPagos.reduce((s,p)=>s+Number(p.monto),0).toFixed(2)}
                          </td>
                          <td colSpan="3" style={{padding:'0.5rem 0.7rem',textAlign:'right',color: compraDetalle.saldo>0?'#b91c1c':'#16a34a',fontWeight:700,fontSize:'0.85rem'}}>
                            Saldo: S/ {compraDetalle.saldo?.toFixed(2)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Estado de pago */}
              <div style={{marginTop:'1rem',padding:'0.8rem 1rem',background: compraDetalle.estadoDinamico==='PAGADO'?'#f0fdf4':'#fef2f2',borderRadius:'8px',display:'flex',alignItems:'center',gap:'0.5rem'}}>
                <span style={{fontSize:'1rem', display:'inline-flex'}}>{compraDetalle.estadoDinamico==='PAGADO'?'': <UiIcon name="Loader" size={16} />}</span>
                <span style={{fontWeight:600,color: compraDetalle.estadoDinamico==='PAGADO'?'#16a34a':'#b91c1c',fontSize:'0.85rem'}}>
                  {compraDetalle.estadoDinamico==='PAGADO'
                    ? `Pagado completamente — ${historialPagos.length} abono${historialPagos.length!==1?'s':''} registrado${historialPagos.length!==1?'s':''}`
                    : `Saldo pendiente: S/ ${compraDetalle.saldo?.toFixed(2)} — ${historialPagos.length} abono${historialPagos.length!==1?'s':''} hasta ahora`
                  }
                </span>
              </div>
            </div>
            <div className="cxp-modal-footer">
              <button className="btn-cxp-cancel" onClick={() => setShowModalDetalle(false)}>Cerrar</button>
              {compraDetalle.estadoDinamico !== 'PAGADO' && (
                <button className="btn-cxp-pay" onClick={() => { setShowModalDetalle(false); abrirModalPago(compraDetalle); }}><UiIcon name="CreditCard" size={15} /> Pagar ahora</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TARJETAS KPI */}
      <div className="cxp-kpi-grid">
        <div className="cxp-kpi-card border-red">
          <div className="kpi-cxp-content">
            <p>DEUDA TOTAL</p>
            <h2>S/ {kpiDeudaTotal.toLocaleString('en-US',{minimumFractionDigits:2})}</h2>
            <span>{facturasActivas} facturas pendientes</span>
          </div>
          <div className="cxp-icon bg-red"><UiIcon name="AlertCircle" size={18} /></div>
        </div>
        <div className="cxp-kpi-card border-yellow">
          <div className="kpi-cxp-content">
            <p>VENCE ESTA SEMANA</p>
            <h2>S/ {kpiVenceSemana.toLocaleString('en-US',{minimumFractionDigits:2})}</h2>
            <span>{qtyVenceSemana} facturas</span>
          </div>
          <div className="cxp-icon bg-yellow"><UiIcon name="Loader" size={16} /></div>
        </div>
        <div className="cxp-kpi-card border-orange">
          <div className="kpi-cxp-content">
            <p>VENCE ESTE MES</p>
            <h2>S/ {kpiVenceMes.toLocaleString('en-US',{minimumFractionDigits:2})}</h2>
            <span>{qtyVenceMes} facturas</span>
          </div>
          <div className="cxp-icon bg-orange"><UiIcon name="Calendar" size={16} /></div>
        </div>
        <div className="cxp-kpi-card border-green">
          <div className="kpi-cxp-content">
            <p>PAGADO HOY</p>
            <h2>S/ {kpiPagadoHoy.toLocaleString('en-US',{minimumFractionDigits:2})}</h2>
            <span>{qtyPagadoHoy} facturas</span>
          </div>
          <div className="cxp-icon bg-green"><UiIcon name="Check" size={16} /></div>
        </div>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="cxp-filters-bar">
        <div className="cxp-search-box">
          <span className="icon"><UiIcon name="Search" size={16} /></span>
          <input type="text" placeholder="Buscar por N° de documento..."
            value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="cxp-date-filter">
          <label>Desde</label>
          <SmartDateInput value={filtroFechaDesde} onChange={setFiltroFechaDesde} />
        </div>
        <div className="cxp-date-filter">
          <label>Hasta</label>
          <SmartDateInput value={filtroFechaHasta} onChange={setFiltroFechaHasta} />
        </div>
        <SearchableSelect
          className="cxp-proveedor-select"
          options={dbProveedores}
          value={filtroProveedorId}
          onChange={setFiltroProveedorId}
          getOptionValue={(p) => p.id_proveedor}
          getOptionLabel={(p) => p.razon_social}
          getOptionSearchText={(p) => `${p.razon_social} ${p.ruc || ''}`}
          placeholder="Buscar proveedor..."
          emptyOptionLabel="Todos los proveedores"
        />
        <div className="cxp-pills">
          <button className={`cxp-pill ${filtroEstado==='TODOS'?'active-dark':''}`}       onClick={() => setFiltroEstado('TODOS')}>Todos</button>
          <button className={`cxp-pill ${filtroEstado==='URGENTES'?'active-red':''}`}     onClick={() => setFiltroEstado('URGENTES')}>
            <UiIcon name="Siren" size={14} /> Urgentes {qtyUrgentes > 0 && <span className="cxp-pill-badge">{qtyUrgentes}</span>}
          </button>
          <button className={`cxp-pill ${filtroEstado==='VENCIDOS'?'active-red':''}`}     onClick={() => setFiltroEstado('VENCIDOS')}><span className="dot bg-red"></span> Vencidos</button>
          <button className={`cxp-pill ${filtroEstado==='POR_VENCER'?'active-yellow':''}`} onClick={() => setFiltroEstado('POR_VENCER')}><span className="dot bg-yellow"></span> Por vencer</button>
          <button className={`cxp-pill ${filtroEstado==='PAGADOS'?'active-green':''}`}    onClick={() => setFiltroEstado('PAGADOS')}><span className="dot bg-green"></span> Pagados</button>
          <button className={`cxp-pill ${filtroEstado==='ANULADAS'?'active-dark':''}`}    onClick={() => setFiltroEstado('ANULADAS')}><span className="dot bg-gray"></span> Anuladas</button>
        </div>
        <button className="cxp-refresh-btn" onClick={cargarCuentasPorPagar} title="Actualizar"><UiIcon name="RefreshCw" size={16} /></button>
      </div>

      {/* TABLA PRINCIPAL */}
      <div className="cxp-table-container">
        <table className="cxp-table">
          <thead>
            <tr>
              <th>PROVEEDOR</th><th>FACTURA</th><th>F. COMPRA</th><th>VENCE</th>
              <th className="text-center">DÍAS REST.</th>
              <th className="text-right">TOTAL</th><th className="text-right">PAGADO</th><th className="text-right">SALDO</th>
              <th>ESTADO</th><th className="text-center">ACCIÓN</th>
            </tr>
          </thead>
          <tbody>
            {datosFiltrados.length === 0 ? (
              <tr><td colSpan="10" className="cxp-empty">No hay facturas que coincidan con el filtro.</td></tr>
            ) : (
              datosFiltrados.map(c => {
                const esUrgente = c.estadoDinamico !== 'PAGADO' && c.diasRestantes >= 0 && c.diasRestantes <= 2;
                let badgeClass = 'badge-gray', diasTexto = '---';
                if (c.esAnulada) {
                  badgeClass = 'badge-gray-text'; diasTexto = 'ANULADA';
                } else if (c.estadoDinamico !== 'PAGADO') {
                  if (c.diasRestantes < 0)        { badgeClass = 'badge-red-text';  diasTexto = `HACE ${Math.abs(c.diasRestantes)}d`; }
                  else if (esUrgente)              { badgeClass = 'badge-urgente';   diasTexto = c.diasRestantes === 0 ? '¡HOY!' : `${c.diasRestantes}d`; }
                  else if (c.diasRestantes <= 10)  { badgeClass = 'badge-yellow';    diasTexto = `${c.diasRestantes} días`; }
                  else                             { badgeClass = 'badge-green';     diasTexto = `${c.diasRestantes} días`; }
                } else {
                  badgeClass = 'badge-gray-text'; diasTexto = 'COMPLETADO';
                }
                let estadoDot = 'bg-gray';
                if (c.estadoDinamico === 'VENCIDO')    estadoDot = 'bg-red';
                if (c.estadoDinamico === 'POR VENCER') estadoDot = 'bg-yellow';
                if (c.estadoDinamico === 'PAGADO')     estadoDot = 'bg-green';

                return (
                  <tr key={c.id_compra} className={`${c.estadoDinamico==='PAGADO'?'row-pagado':''} ${esUrgente?'row-urgente':''} ${c.esAnulada?'row-anulada':''}`}>
                    <td>
                      <strong className="text-dark">{c.proveedores?.razon_social || 'Desconocido'}</strong><br/>
                      <small className="text-muted">RUC: {c.proveedores?.ruc || '---'}</small>
                    </td>
                    <td className="text-muted">{c.nro_documento}</td>
                    <td className="text-muted">{new Date(c.fecha_compra).toLocaleDateString('es-PE')}</td>
                    <td className={c.estadoDinamico==='VENCIDO'?'text-red font-bold':'text-muted'}>{new Date(c.fecha_vencimiento).toLocaleDateString('es-PE')}</td>
                    <td className="text-center"><span className={`cxp-dias-badge ${badgeClass}`}>{diasTexto}</span></td>
                    <td className="text-right font-bold text-dark">S/{Number(c.total_compra).toFixed(2)}</td>
                    <td className="text-right text-green font-bold">S/{Number(c.monto_pagado).toFixed(2)}</td>
                    <td className={`text-right font-bold ${c.saldo>0?'text-red':'text-muted'}`}>S/{c.saldo.toFixed(2)}</td>
                    <td>
                      <div className="cxp-status-cell">
                        <span className={`dot ${estadoDot}`}></span>
                        <span className={estadoDot.replace('bg-','text-')}>{c.estadoDinamico==='POR VENCER'?'CRÉDITO':c.estadoDinamico}</span>
                      </div>
                    </td>
                    <td className="text-center">
                      <div className="cxp-actions-wrap">
                        <button
                          className="btn-cxp-action"
                          style={{background:'#1e293b'}}
                          onClick={() => abrirDetalle(c)}
                          title="Ver productos de esta factura"
                        ><UiIcon name="ClipboardList" size={14} /> Detalle</button>
                        {!c.esAnulada && c.estadoDinamico !== 'PAGADO' && (
                          <button className={`btn-cxp-action ${esUrgente?'btn-cxp-urgente':''}`} onClick={() => abrirModalPago(c)}><UiIcon name="CreditCard" size={15} /> Pagar</button>
                        )}
                        {!c.esAnulada && c.estadoDinamico === 'PAGADO' && (
                          <span className="cxp-label-pagado"><UiIcon name="Check" size={15} /> Pagado</span>
                        )}
                        {c.esAnulada && (
                          <span className="cxp-label-pagado" style={{background:'#f1f5f9',color:'#64748b'}}><UiIcon name="Ban" size={15} /> Anulada</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* BARRA INFERIOR STICKY */}
      <div className="cxp-bottom-sticky">
        <div className="sticky-left">
          <p>DEUDA TOTAL PENDIENTE</p>
          <h2>S/ {kpiDeudaTotal.toLocaleString('en-US',{minimumFractionDigits:2})}</h2>
        </div>
        <div className="sticky-center">
          {qtyUrgentes > 0 && (
            <div className="sticky-urgente-pill"><UiIcon name="Siren" size={14} /> {qtyUrgentes} deuda{qtyUrgentes>1?'s':''} ≤2 días</div>
          )}
        </div>
        <div className="sticky-right">
          <p>{facturasActivas} facturas activas</p>
          <h4 className={facturasVencidas > 0 ? 'text-yellow-bright' : ''}>{facturasVencidas} requieren acción inmediata</h4>
        </div>
      </div>

    </div>
  );
}